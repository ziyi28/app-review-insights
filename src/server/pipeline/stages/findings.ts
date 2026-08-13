import type { Finding } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import { computeConfidence, type SourceStatus } from "@/domain/analysis/confidence";
import { FindingOutputSchema, findingsPrompt, type FindingOutput } from "@/server/model/prompts/prompts";
import { chunkByBodyBudget, mapWithConcurrency } from "../batching";
import { modelProgressRelay, type StageModelClient } from "../dependencies";

export type FindingsStageContext = {
  model: StageModelClient;
  reviews: NormalizedReview[];
  topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[] }[];
  outputLocale: string;
  goal: string;
  sourceStatus: SourceStatus;
  /** Live progress callback; invoked with a human-readable message while the
   *  model call is in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
  /** Max findings calls issued in parallel (default 3). */
  maxConcurrency?: number;
};

export type FindingsStageResult = {
  findings: Finding[];
  warnings: { code: string; message: string }[];
  insufficientEvidence: boolean;
};

export type FindingNormalizeContext = Pick<FindingsStageContext, "reviews" | "topics" | "sourceStatus">;

/**
 * Normalizes raw model findings into protocol-valid findings. Every citation
 * and excerpt is validated; sample count and confidence are always derived
 * deterministically by code, never trusted from the model. Findings without
 * valid support, or whose supporting reviews lack an exact excerpt, are
 * dropped (unsupported conclusions never survive).
 */
export function normalizeFindings(output: FindingOutput, ctx: FindingNormalizeContext): FindingsStageResult {
  const warnings: { code: string; message: string }[] = [];
  // Model output may cite either the stable reviewId or the original source id.
  const reviewMap = new Map<string, NormalizedReview>();
  for (const r of ctx.reviews) {
    reviewMap.set(r.reviewId, r);
    reviewMap.set(r.sourceReviewId, r);
  }
  const allowedTopicIds = new Set(ctx.topics.map((t) => t.id));

  const findings: Finding[] = [];
  for (const f of output.findings) {
    // Validate topic links.
    const validTopicIds = f.topicIds.filter((id) => allowedTopicIds.has(id));

    // Validate supporting citations; normalize any source-id reference to the
    // stable reviewId so the downstream ledger is consistent.
    const validSupport = f.supportingReviewIds.filter((id) => reviewMap.has(id));
    if (validSupport.length === 0) {
      warnings.push({ code: "UNSUPPORTED_FINDING", message: `dropped ${f.id} (no valid supporting reviews)` });
      continue;
    }

    // Validate excerpts: each must be an exact substring of the cited review.
    const validExcerpts = f.evidenceExcerpts.flatMap((e) => {
      const review = reviewMap.get(e.reviewId);
      if (!review) return [];
      if (!isExactExcerpt(e.excerpt, review.bodyNormalized)) return [];
      return [{ reviewId: review.reviewId, excerpt: e.excerpt }];
    });

    // Every supporting review must be backed by at least one exact excerpt.
    // A review cited only by ID (no verified excerpt) is not evidence, so it
    // is removed from the support set rather than counted toward sample size
    // and confidence. This prevents inflated evidence without valid quotes.
    const excerptedReviewIds = new Set(validExcerpts.map((e) => e.reviewId));
    const supportingReviewIds = [...new Set(validSupport.map((id) => reviewMap.get(id)!.reviewId))].filter((id) =>
      excerptedReviewIds.has(id),
    );
    if (supportingReviewIds.length === 0) {
      warnings.push({ code: "UNSUPPORTED_FINDING", message: `dropped ${f.id} (no supported reviews have an exact excerpt)` });
      continue;
    }
    const conflictingReviewIds = f.conflictingReviewIds.filter((id) => reviewMap.has(id)).map((id) => reviewMap.get(id)!.reviewId);
    const hasConflict = conflictingReviewIds.length > 0;
    const confidence = computeConfidence({
      supportCount: supportingReviewIds.length,
      sourceStatus: ctx.sourceStatus,
      hasConflict,
    });

    findings.push({
      id: f.id,
      topicIds: validTopicIds,
      title: f.title,
      summary: f.summary,
      supportingReviewIds,
      supportingSampleCount: supportingReviewIds.length,
      evidenceExcerpts: validExcerpts,
      conflictingReviewIds,
      confidence,
      uncertainties: f.uncertainties,
      limitations: f.limitations,
    });
  }

  return {
    findings,
    warnings,
    insufficientEvidence: findings.length === 0,
  };
}

// Findings is the one stage that historically fed the entire review corpus into
// a single model call. For a large corpus that input ballooned to hundreds of
// KB and the provider returned truncated, non-JSON output. Splitting into
// size-bounded chunks (same budget as topic discovery) keeps each call small
// enough to succeed; results are then merged deterministically by code.
const FINDINGS_CHUNK_CHAR_BUDGET = 8_000;
const DEFAULT_FINDINGS_CONCURRENCY = 3;

// The model only needs the review id (stable + source) and the normalized body
// it must quote exactly. Stripping the original body/title/rawRef (and the rest)
// removes ~300KB of redundant input on a 500-review corpus while keeping the
// exact-excerpt validation in normalizeFindings intact (it runs against the
// full ctx.reviews, not the slim copy).
type SlimReview = { reviewId: string; sourceReviewId: string; rating: number; bodyNormalized: string };

/**
 * Generates evidence-grounded findings. Reviews are slimmed down, split into
 * size-bounded chunks, and analyzed per-chunk in parallel; each chunk's output
 * is passed through the shared deterministic normalizer (see normalizeFindings)
 * against the full review set, then findings are id-namespaced per chunk to
 * avoid cross-chunk collisions and merged.
 */
export async function runFindingsStage(ctx: FindingsStageContext): Promise<FindingsStageResult> {
  const warnings: { code: string; message: string }[] = [];
  const slimReviews: SlimReview[] = ctx.reviews.map((r) => ({
    reviewId: r.reviewId,
    sourceReviewId: r.sourceReviewId,
    rating: r.rating,
    bodyNormalized: r.bodyNormalized,
  }));

  const chunks = chunkByBodyBudget(slimReviews, FINDINGS_CHUNK_CHAR_BUDGET);
  const perChunk = await mapWithConcurrency(chunks, ctx.maxConcurrency ?? DEFAULT_FINDINGS_CONCURRENCY, async (chunk, chunkIndex) => {
    ctx.onProgress?.(`generating findings for review batch ${chunkIndex + 1} of ${chunks.length} (${chunk.length} reviews)`);
    const output = await ctx.model.generate({
      stage: "findings",
      promptVersion: findingsPrompt.version,
      system: findingsPrompt.system,
      user: findingsPrompt.buildUser({ reviews: chunk, topics: ctx.topics, goal: ctx.goal, outputLocale: ctx.outputLocale }),
      schema: FindingOutputSchema,
      onProgress: modelProgressRelay(ctx.onProgress),
    });
    // Normalize against the full review set: the model saw only this chunk, so
    // any review it cites resolves here and its excerpt is still verified as an
    // exact substring of the normalized body.
    const result = normalizeFindings(output, { reviews: ctx.reviews, topics: ctx.topics, sourceStatus: ctx.sourceStatus });
    return { chunkIndex, result };
  });

  // Namespacing is only needed when the corpus actually split: two chunks can
  // both emit `finding-1` and collide. For a single chunk the ids pass through
  // unchanged so the small-corpus path is identical to before chunking.
  const namespaceIds = chunks.length > 1;
  const findings: Finding[] = [];
  for (const { chunkIndex, result } of perChunk) {
    warnings.push(...result.warnings);
    for (const f of result.findings) findings.push(namespaceIds ? { ...f, id: `${f.id}@c${chunkIndex}` } : f);
  }

  return { findings, warnings, insufficientEvidence: findings.length === 0 };
}
