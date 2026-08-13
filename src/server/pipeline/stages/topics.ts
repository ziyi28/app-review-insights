import type { NormalizedReview } from "@/domain/contracts/review";
import { TopicConsolidationOutputSchema, TopicDiscoveryOutputSchema, topicDiscoveryPrompt, topicConsolidationPrompt } from "@/server/model/prompts/prompts";
import { isExactExcerpt } from "@/domain/analysis/evidence";
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
// Consolidation inputs can balloon to tens of KB for a large corpus (e.g. 51
// candidates ≈ 36KB), which the provider rejects with a 500. Splitting the
// candidates into fixed-size groups keeps each consolidation call small enough
// to succeed; the per-group results are then merged deterministically by code.
const CONSOLIDATION_CANDIDATE_BUDGET = 15;
const DEFAULT_CONSOLIDATION_CONCURRENCY = 2;

/** Maps items through `fn` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunkReviews(reviews: NormalizedReview[]): NormalizedReview[][] {
  const chunks: NormalizedReview[][] = [];
  let current: NormalizedReview[] = [];
  let chars = 0;
  for (const r of reviews) {
    const cost = r.bodyNormalized.length + 16;
    if (current.length > 0 && chars + cost > CHUNK_CHAR_BUDGET) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(r);
    chars += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function candidateById(candidates: { id: string }[]): Map<string, { id: string }> {
  return new Map(candidates.map((c) => [c.id, c]));
}

/** Splits an array into fixed-size groups (last group may be smaller). */
function groupBySize<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
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

  const chunks = chunkReviews(ctx.reviews);
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
    for (const c of discovery.topics) {
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
    }
  }

  if (candidates.length === 0) {
    return { topics: [], candidates, warnings };
  }

  // Consolidate in fixed-size groups so a large candidate set never produces a
  // single oversized prompt (the provider rejects it with a 500). Each group
  // runs its own consolidation call in parallel; the per-group topics are then
  // merged by code. A candidate belongs to exactly one group, so merging on the
  // candidate id never duplicates evidence across groups.
  const candidateGroups = groupBySize(candidates, CONSOLIDATION_CANDIDATE_BUDGET);
  const consolidations = await mapWithConcurrency(
    candidateGroups,
    DEFAULT_CONSOLIDATION_CONCURRENCY,
    async (group, groupIndex) => {
      ctx.onProgress?.(`consolidating topic candidates ${groupIndex * CONSOLIDATION_CANDIDATE_BUDGET + 1}-${groupIndex * CONSOLIDATION_CANDIDATE_BUDGET + group.length} of ${candidates.length}`);
      const result = await ctx.model.generate({
        stage: "topic-consolidation",
        promptVersion: topicConsolidationPrompt.version,
        system: topicConsolidationPrompt.system,
        user: topicConsolidationPrompt.buildUser({ candidates: group, outputLocale: ctx.outputLocale }),
        schema: TopicConsolidationOutputSchema,
        onProgress: modelProgressRelay(ctx.onProgress),
      });
      return { groupIndex, result };
    },
  );

  const candidateIndex = candidateById(candidates);
  const topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[] }[] = [];
  // Merge per-group topics deterministically: topics with the same normalized
  // label across groups are the same theme, so their candidateIds are joined.
  const byLabel = new Map<string, { label: string; description: string; candidateIds: string[] }>();
  for (const { result } of consolidations) {
    for (const t of result.topics) {
      const validCandidateIds = t.candidateIds.filter((id) => candidateIndex.has(id));
      if (validCandidateIds.length === 0) {
        warnings.push({ code: "EMPTY_TOPIC", message: `dropped ${t.id} (no valid candidates)` });
        continue;
      }
      const key = t.label.trim().toLowerCase();
      const existing = byLabel.get(key);
      if (existing) {
        existing.candidateIds = [...new Set([...existing.candidateIds, ...validCandidateIds])];
      } else {
        byLabel.set(key, { label: t.label, description: t.description, candidateIds: [...validCandidateIds] });
      }
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
