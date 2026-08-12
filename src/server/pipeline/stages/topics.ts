import type { NormalizedReview } from "@/domain/contracts/review";
import { TopicConsolidationOutputSchema, TopicDiscoveryOutputSchema, topicDiscoveryPrompt, topicConsolidationPrompt } from "@/server/model/prompts/prompts";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import type { StageModelClient } from "../dependencies";

export type TopicsStageContext = {
  model: StageModelClient;
  reviews: NormalizedReview[];
  outputLocale: string;
  goal: string;
  sourceStatus: "complete" | "partial" | "suspect-empty" | "failed";
};

export type TopicStageResult = {
  topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[] }[];
  candidates: { id: string; label: string; description: string; supportingReviewIds: string[]; quote: string }[];
  warnings: { code: string; message: string }[];
};

const CHUNK_CHAR_BUDGET = 12_000;

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
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const discovery = await ctx.model.generate({
      stage: "topics",
      promptVersion: topicDiscoveryPrompt.version,
      system: topicDiscoveryPrompt.system,
      user: topicDiscoveryPrompt.buildUser({ reviews: chunk, outputLocale: ctx.outputLocale }),
      schema: TopicDiscoveryOutputSchema,
    });

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

  const consolidation = await ctx.model.generate({
    stage: "topic-consolidation",
    promptVersion: topicConsolidationPrompt.version,
    system: topicConsolidationPrompt.system,
    user: topicConsolidationPrompt.buildUser({ candidates, outputLocale: ctx.outputLocale }),
    schema: TopicConsolidationOutputSchema,
  });

  const candidateIndex = candidateById(candidates);
  const topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[] }[] = [];
  for (const t of consolidation.topics) {
    const validCandidateIds = t.candidateIds.filter((id) => candidateIndex.has(id));
    if (validCandidateIds.length === 0) {
      warnings.push({ code: "EMPTY_TOPIC", message: `dropped ${t.id} (no valid candidates)` });
      continue;
    }
    const reviewIds = [
      ...new Set(
        candidates
          .filter((c) => validCandidateIds.includes(c.id))
          .flatMap((c) => c.supportingReviewIds.map((id) => reviewMap.get(id)?.reviewId).filter(Boolean) as string[]),
      ),
    ];
    topics.push({ id: t.id, label: t.label, description: t.description, candidateIds: validCandidateIds, reviewIds });
  }

  return { topics, candidates, warnings };
}
