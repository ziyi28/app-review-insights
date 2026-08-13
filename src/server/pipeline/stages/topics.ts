import type { NormalizedReview } from "@/domain/contracts/review";
import { TopicConsolidationOutputSchema, TopicDiscoveryOutputSchema, topicDiscoveryPrompt, topicConsolidationPrompt } from "@/server/model/prompts/prompts";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import { chunkByBodyBudget, mapWithConcurrency } from "../batching";
import { modelProgressRelay, type StageModelClient } from "../dependencies";

export type TopicsStageContext = {
  model: StageModelClient;
  reviews: NormalizedReview[];
  outputLocale: string;
  goal: string;
  sourceStatus: "complete" | "partial" | "suspect-empty" | "failed";
  /** Live progress callback; invoked with a human-readable message while the
   *  model calls are in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
  /** Max discovery calls issued in parallel. Parallel batches shrink total
   *  wall-clock time for a large corpus, but keep the value low enough that a
   *  provider doesn't reject the concurrent large prompts (default 3). */
  maxConcurrency?: number;
};

export type TopicStageResult = {
  topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[] }[];
  candidates: { id: string; label: string; description: string; supportingReviewIds: string[]; quote: string }[];
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

function candidateById(candidates: { id: string }[]): Map<string, { id: string }> {
  return new Map(candidates.map((c) => [c.id, c]));
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
  const candidates: { id: string; label: string; description: string; supportingReviewIds: string[]; quote: string }[] = [];

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
      user: topicDiscoveryPrompt.buildUser({ reviews: chunk, outputLocale: ctx.outputLocale }),
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
      // Namespace the candidate id by chunk so two chunks returning the same
      // local id cannot collide and silently merge unrelated evidence.
      candidates.push({ ...c, id: `${c.id}@c${chunkIndex}` });
      keptInChunk += 1;
    }
  }
  // Global cap: keep only the first MAX_CANDIDATES_TOTAL validated candidates
  // (in discovery-batch order, which is deterministic). Excess is dropped with
  // a warning rather than triggering a model retry.
  if (candidates.length > MAX_CANDIDATES_TOTAL) {
    warnings.push({
      code: "TOPIC_CANDIDATES_TRUNCATED",
      message: `kept first ${MAX_CANDIDATES_TOTAL} of ${candidates.length} discovered candidates; excess dropped deterministically`,
    });
    candidates.length = MAX_CANDIDATES_TOTAL;
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
  const topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[] }[] = [];
  // Merge returned topics deterministically: topics with the same normalized
  // label are the same theme, so their candidateIds are joined.
  const byLabel = new Map<string, { label: string; description: string; candidateIds: string[] }>();
  let consumed = 0;
  for (const t of consolidation.topics) {
    if (consumed >= MAX_TOPICS) {
      warnings.push({ code: "TOPICS_TRUNCATED", message: `kept first ${MAX_TOPICS} topics; excess dropped deterministically` });
      break;
    }
    const validCandidateIds = t.candidateIds.filter((id) => candidateIndex.has(id));
    if (validCandidateIds.length === 0) {
      warnings.push({ code: "EMPTY_TOPIC", message: `dropped ${t.id} (no valid candidates)` });
      continue;
    }
    consumed += 1;
    const key = t.label.trim().toLowerCase();
    const existing = byLabel.get(key);
    if (existing) {
      existing.candidateIds = [...new Set([...existing.candidateIds, ...validCandidateIds])];
    } else {
      byLabel.set(key, { label: t.label, description: t.description, candidateIds: [...validCandidateIds] });
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
    topics.push({ id: `topic-${topicSeq}`, label: t.label, description: t.description, candidateIds: t.candidateIds, reviewIds });
  }

  return { topics, candidates, warnings };
}
