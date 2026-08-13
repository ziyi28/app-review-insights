import type { Finding } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import { computeConfidence, type SourceStatus } from "@/domain/analysis/confidence";
import { FindingOutputSchema, findingsPrompt, type FindingOutput } from "@/server/model/prompts/prompts";
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

/**
 * Generates evidence-grounded findings. The model output is passed through the
 * shared deterministic normalizer (see normalizeFindings).
 */
export async function runFindingsStage(ctx: FindingsStageContext): Promise<FindingsStageResult> {
  ctx.onProgress?.("generating evidence-grounded findings");
  const output = await ctx.model.generate({
    stage: "findings",
    promptVersion: findingsPrompt.version,
    system: findingsPrompt.system,
    user: findingsPrompt.buildUser({ reviews: ctx.reviews, topics: ctx.topics, goal: ctx.goal, outputLocale: ctx.outputLocale }),
    schema: FindingOutputSchema,
    onProgress: modelProgressRelay(ctx.onProgress),
  });

  return normalizeFindings(output, ctx);
}
