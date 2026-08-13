import type { NormalizedReview } from "@/domain/contracts/review";
import type { FocusArea } from "@/domain/contracts/analysis";
import { TopicConsolidationOutputSchema, TopicDiscoveryOutputSchema, topicDiscoveryPrompt, topicConsolidationPrompt } from "@/server/model/prompts/prompts";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import { chunkByBodyBudget, mapWithConcurrency } from "../batching";
import { modelProgressRelay, type StageModelClient } from "../dependencies";

export type TopicsStageContext = {
  model: StageModelClient;
  reviews: NormalizedReview[];
  outputLocale: string;
  goal: string;
  /** Structured goal dimensions from the scope stage. */
  focusAreas?: FocusArea[];
  sourceStatus: "complete" | "partial" | "suspect-empty" | "failed";
  /** Live progress callback; invoked with a human-readable message while the
   *  model calls are in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
  /** Max discovery calls issued in parallel. Parallel batches shrink total
   *  wall-clock time for a large corpus, but keep the value low enough that a
   *  provider doesn't reject the concurrent large prompts (default 3). */
  maxConcurrency?: number;
};

export type TopicCandidateT = {
  id: string;
  label: string;
  description: string;
  supportingReviewIds: string[];
  quote: string;
  focusAreaIds: string[];
};

export type TopicT = {
  id: string;
  label: string;
  description: string;
  candidateIds: string[];
  reviewIds: string[];
  focusAreaIds: string[];
};

export type TopicStageResult = {
  topics: TopicT[];
  candidates: TopicCandidateT[];
  warnings: { code: string; message: string }[];
};

// Smaller batches mean each discovery call is faster and less likely to be
// rejected by the provider for an oversized prompt; combined with parallel
// execution this keeps a large corpus moving without one call stalling or
// failing the whole stage.
const CHUNK_CHAR_BUDGET = 8_000;
const DEFAULT_MAX_CONCURRENCY = 3;
// Model work is bounded so a large corpus never produces unbounded prompts or
// candidates: each discovery call returns at most 6 validated candidates, at
// most 36 candidates reach consolidation globally, and the (now single)
// consolidation call returns at most 20 canonical topics. Excess model output
// is truncated deterministically with a warning — never retried.
const MAX_CANDIDATES_PER_DISCOVERY_CALL = 6;
const MAX_CANDIDATES_TOTAL = 36;
const MAX_TOPICS = 20;

function candidateById(candidates: TopicCandidateT[]): Map<string, TopicCandidateT> {
  return new Map(candidates.map((c) => [c.id, c]));
}

/**
 * Deterministic selection when validated topic candidates exceed the global
 * cap. Priority (highest first):
 *   1. at least one candidate per focus area with none yet;
 *   2. at least one candidate per topic theme with none yet;
 *   3. evidence signal (support count desc, then quote length desc);
 *   4. remaining seats round-robin across discovery batches so the tail of the
 *      corpus is not silently dropped just because it was analyzed last.
 */
export function selectTopicCandidates(
  candidates: TopicCandidateT[],
  focusAreaIds: string[],
  cap: number,
): { selected: TopicCandidateT[]; dropped: TopicCandidateT[] } {
  const focusAreas = new Set(focusAreaIds);
  const selected: TopicCandidateT[] = [];
  const remaining = [...candidates];
  const take = (predicate: (c: TopicCandidateT) => boolean) => {
    const idx = remaining.findIndex(predicate);
    if (idx >= 0 && selected.length < cap) {
      selected.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
  };

  if (focusAreas.size > 0) {
    // 1. One candidate per focus area with none selected yet.
    for (const areaId of focusAreas) {
      take((c) => c.focusAreaIds.includes(areaId) && !selected.some((s) => s.focusAreaIds.includes(areaId)));
    }
    // 2. One candidate per focus area already having a seat (fill the rest of
    //    each area's evidence).
    for (const areaId of focusAreas) {
      take((c) => c.focusAreaIds.includes(areaId));
    }
  }
  // 3. One per distinct "theme" — approximated by the candidate label, since a
  //    consolidated label is not yet known. Then evidence-sorted fill.
  const seenLabels = new Set<string>();
  for (const c of [...remaining]) {
    const labelKey = c.label.trim().toLowerCase();
    if (!seenLabels.has(labelKey) && selected.length < cap) {
      seenLabels.add(labelKey);
      selected.push(c);
      remaining.splice(remaining.indexOf(c), 1);
    }
  }
  // 4. Remaining seats by evidence signal, then round-robin by discovery batch.
  const byChunk = new Map<string, TopicCandidateT[]>();
  for (const c of remaining) {
    const chunk = c.id.split("@c").at(-1) ?? "0";
    const list = byChunk.get(chunk) ?? [];
    list.push(c);
    byChunk.set(chunk, list);
  }
  const rank = (c: TopicCandidateT) => c.supportingReviewIds.length;
  const sorted = [...remaining].sort((a, b) => rank(b) - rank(a) || b.quote.length - a.quote.length);
  // The round-robin drains the same `remaining` array it reads: candidates that
  // are dropped out of the quota fill are removed from `remaining` so the
  // returned dropped list reflects exactly what was not selected.
  const rr: TopicCandidateT[] = [];
  const chunkKeys = [...byChunk.keys()];
  let cursor = 0;
  for (let i = 0; i < Math.max(1, sorted.length); i++) {
    const key = chunkKeys[cursor % chunkKeys.length];
    const list = byChunk.get(key) ?? [];
    const next = list.shift();
    if (next) {
      rr.push(next);
      const idx = remaining.findIndex((c) => c.id === next.id);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    cursor += 1;
    if (byChunk.get(key)?.length === 0) {
      byChunk.delete(key);
      chunkKeys.splice(chunkKeys.indexOf(key), 1);
      if (chunkKeys.length === 0) break;
    }
  }
  while (selected.length < cap && rr.length > 0) {
    const next = rr.shift()!;
    selected.push(next);
  }
  // Any round-robin candidate that did not fit in the cap is dropped too.
  while (rr.length > 0) remaining.push(rr.shift()!);

  return { selected, dropped: remaining };
}

/**
 * Discovers topics dynamically (no fixed taxonomy) by chunking reviews and
 * calling the model per chunk, then validating each candidate quote is an
 * exact substring before consolidation. Consolidation may only merge validated
 * candidates; it cannot add new evidence.
 */
export async function runTopicsStage(ctx: TopicsStageContext): Promise<TopicStageResult> {
  const warnings: { code: string; message: string }[] = [];
  // Model output may cite either the stable reviewId or the original source id.
  const reviewMap = new Map<string, NormalizedReview>();
  for (const r of ctx.reviews) {
    reviewMap.set(r.reviewId, r);
    reviewMap.set(r.sourceReviewId, r);
  }
  const candidates: TopicCandidateT[] = [];
  const allowedFocusAreaIds = new Set(ctx.focusAreas?.map((a) => a.id) ?? []);
  const focusAreas = ctx.focusAreas ?? [];

  // The model only needs the review id (stable + source), rating and normalized
  // body it must quote exactly. Stripping the original body/title/rawRef (and
  // the rest) removes redundant input while keeping exact-excerpt validation
  // intact (it runs against the full ctx.reviews, not the slim copy).
  const slimReviews: { reviewId: string; sourceReviewId: string; rating: number; bodyNormalized: string }[] = ctx.reviews.map((r) => ({
    reviewId: r.reviewId,
    sourceReviewId: r.sourceReviewId,
    rating: r.rating,
    bodyNormalized: r.bodyNormalized,
  }));

  const chunks = chunkByBodyBudget(slimReviews, CHUNK_CHAR_BUDGET);
  // Discovery batches run in parallel (bounded by maxConcurrency) because a
  // large corpus would otherwise spend one batch's full model latency per
  // chunk sequentially. Results are validated after all calls settle so the
  // evidence rules are identical to a sequential run.
  const discovered = await mapWithConcurrency(chunks, ctx.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY, async (chunk, chunkIndex) => {
    ctx.onProgress?.(`analyzing review batch ${chunkIndex + 1} of ${chunks.length} in parallel (${chunk.length} reviews)`);
    const discovery = await ctx.model.generate({
      stage: "topics",
      promptVersion: topicDiscoveryPrompt.version,
      system: topicDiscoveryPrompt.system,
      user: topicDiscoveryPrompt.buildUser({ reviews: chunk, goal: ctx.goal, focusAreas, outputLocale: ctx.outputLocale }),
      schema: TopicDiscoveryOutputSchema,
      onProgress: modelProgressRelay(ctx.onProgress),
    });
    return { chunkIndex, discovery };
  });

  for (const { chunkIndex, discovery } of discovered) {
    let keptInChunk = 0;
    for (const c of discovery.topics) {
      if (keptInChunk >= MAX_CANDIDATES_PER_DISCOVERY_CALL) {
        warnings.push({ code: "TOPIC_CANDIDATES_TRUNCATED", message: `discovery batch ${chunkIndex + 1} exceeded ${MAX_CANDIDATES_PER_DISCOVERY_CALL} candidates; extra dropped deterministically` });
        break;
      }
      // Validate: every cited review exists and the quote is an exact substring.
      const cited = c.supportingReviewIds.every((id) => reviewMap.has(id));
      const quoted = c.quote && c.supportingReviewIds.some((id) => {
        const r = reviewMap.get(id);
        return r && isExactExcerpt(c.quote, r.bodyNormalized);
      });
      if (!cited || !quoted) {
        warnings.push({ code: "INVALID_TOPIC_EVIDENCE", message: `dropped ${c.id} (bad citation or quote)` });
        continue;
      }
      // Unknown focus area ids are stripped by code — never trusted from the
      // model. `?? []` guards direct-object stubs that bypass schema defaults.
      const validFocusAreaIds = (c.focusAreaIds ?? []).filter((id) => allowedFocusAreaIds.has(id));
      // Namespace the candidate id by chunk so two chunks returning the same
      // local id cannot collide and silently merge unrelated evidence.
      candidates.push({ ...c, focusAreaIds: validFocusAreaIds, id: `${c.id}@c${chunkIndex}` });
      keptInChunk += 1;
    }
  }
  // Global cap with goal-aware selection: at least one candidate per focus
  // area and per theme survives, the rest is evidence-sorted then filled
  // round-robin across batches. Excess is dropped with a warning rather than
  // triggering a model retry.
  if (candidates.length > MAX_CANDIDATES_TOTAL) {
    const { selected, dropped } = selectTopicCandidates(candidates, focusAreas.map((a) => a.id), MAX_CANDIDATES_TOTAL);
    warnings.push({
      code: "TOPIC_CANDIDATES_TRUNCATED",
      message: `kept ${selected.length} of ${candidates.length} discovered candidates (goal-aware selection); ${dropped.length} excess dropped deterministically`,
    });
    candidates.length = 0;
    candidates.push(...selected);
  }

  if (candidates.length === 0) {
    return { topics: [], candidates, warnings };
  }

  // A single consolidation call over the (bounded) candidate set keeps the
  // prompt small and is one call instead of several — the per-call budget that
  // once split candidates across groups is now enforced by the caps above.
  ctx.onProgress?.(`consolidating ${candidates.length} topic candidates`);
  const consolidation = await ctx.model.generate({
    stage: "topic-consolidation",
    promptVersion: topicConsolidationPrompt.version,
    system: topicConsolidationPrompt.system,
    user: topicConsolidationPrompt.buildUser({ candidates, outputLocale: ctx.outputLocale }),
    schema: TopicConsolidationOutputSchema,
    onProgress: modelProgressRelay(ctx.onProgress),
  });

  const candidateIndex = candidateById(candidates);
  const topics: TopicT[] = [];
  // Merge returned topics deterministically: topics with the same normalized
  // label are the same theme, so their candidateIds are joined.
  const byLabel = new Map<string, { label: string; description: string; candidateIds: string[]; focusAreaIds: string[] }>();
  let consumed = 0;
  for (const t of consolidation.topics) {
    if (consumed >= MAX_TOPICS) {
      warnings.push({ code: "TOPICS_TRUNCATED", message: `kept first ${MAX_TOPICS} topics; excess dropped deterministically` });
      break;
    }
    const validCandidateIds = (t.candidateIds ?? []).filter((id) => candidateIndex.has(id));
    if (validCandidateIds.length === 0) {
      warnings.push({ code: "EMPTY_TOPIC", message: `dropped ${t.id} (no valid candidates)` });
      continue;
    }
    consumed += 1;
    const key = t.label.trim().toLowerCase();
    const existing = byLabel.get(key);
    // The focus area ids are the union of the merged candidates' ids — code
    // derives it deterministically rather than trusting the model's own list.
    const mergedFocusAreaIds = [
      ...new Set(
        validCandidateIds.flatMap((cid) => candidateIndex.get(cid)?.focusAreaIds ?? []),
      ),
    ];
    if (existing) {
      existing.candidateIds = [...new Set([...existing.candidateIds, ...validCandidateIds])];
      existing.focusAreaIds = [...new Set([...existing.focusAreaIds, ...mergedFocusAreaIds])];
    } else {
      byLabel.set(key, { label: t.label, description: t.description, candidateIds: [...validCandidateIds], focusAreaIds: mergedFocusAreaIds });
    }
  }
  let topicSeq = 0;
  for (const t of byLabel.values()) {
    topicSeq += 1;
    const reviewIds = [
      ...new Set(
        candidates
          .filter((c) => t.candidateIds.includes(c.id))
          .flatMap((c) => c.supportingReviewIds.map((id) => reviewMap.get(id)?.reviewId).filter(Boolean) as string[]),
      ),
    ];
    topics.push({ id: `topic-${topicSeq}`, label: t.label, description: t.description, candidateIds: t.candidateIds, reviewIds, focusAreaIds: t.focusAreaIds });
  }

  return { topics, candidates, warnings };
}
