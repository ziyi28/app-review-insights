import type { EvidenceVerdict, Finding, Requirement } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { requirementEvidencePrompt, RequirementEvidenceOutputSchema } from "@/server/model/prompts/prompts";
import { applyRequirementEvidence, candidateReviewIdsFor, type RequirementEvidenceReport } from "@/domain/analysis/requirement-evidence";
import { chunkByBodyBudget, mapWithConcurrency } from "../batching";
import { modelProgressRelay, type StageModelClient } from "../dependencies";

export type RequirementEvidenceStageContext = {
  model: StageModelClient;
  requirements: Requirement[];
  findings: Finding[];
  reviews: NormalizedReview[];
  outputLocale: "en" | "zh-CN";
  /** Live progress callback; invoked with a human-readable message while model
   *  calls are in flight. */
  onProgress?: (message: string) => void;
  /** Max evidence-judgment calls issued in parallel (default 3). */
  maxConcurrency?: number;
};

export type RequirementEvidenceStageResult = {
  requirements: Requirement[];
  report: RequirementEvidenceReport;
};

// Same char budget as findings: a single requirement's candidate reviews may be
// large (a finding group can carry dozens of reviews), so each requirement is
// split into size-bounded chunks and judged in parallel to keep every model
// call small enough to return complete, valid JSON.
const REQUIREMENT_EVIDENCE_CHUNK_CHAR_BUDGET = 8_000;
const DEFAULT_CONCURRENCY = 3;

type SlimReview = { reviewId: string; bodyNormalized: string };

/**
 * Judges every candidate review of every requirement independently (direct /
 * partial / none) and narrows each requirement's sourceReviewIds to reviews
 * that directly support it. This closes the gap where the planning stage
 * inherited a finding's whole review set as a requirement's formal evidence.
 */
export async function runRequirementEvidenceStage(
  ctx: RequirementEvidenceStageContext,
): Promise<RequirementEvidenceStageResult> {
  const reviewById = new Map<string, NormalizedReview>();
  for (const r of ctx.reviews) {
    reviewById.set(r.reviewId, r);
    reviewById.set(r.sourceReviewId, r);
  }

  // Candidate reviews per requirement, resolved to slim (id + normalized body)
  // shapes and deduped by stable review id, order-stable.
  type Job = { requirementId: string; requirement: { id: string; title: string; description: string }; reviews: SlimReview[] };
  const jobs: Job[] = [];
  for (const req of ctx.requirements) {
    const candidates = candidateReviewIdsFor(req, ctx.findings);
    const slim: SlimReview[] = [];
    const seen = new Set<string>();
    for (const id of candidates) {
      const review = reviewById.get(id);
      if (!review || seen.has(review.reviewId)) continue;
      seen.add(review.reviewId);
      slim.push({ reviewId: review.reviewId, bodyNormalized: review.bodyNormalized });
    }
    for (const chunk of chunkByBodyBudget(slim, REQUIREMENT_EVIDENCE_CHUNK_CHAR_BUDGET)) {
      jobs.push({
        requirementId: req.id,
        requirement: { id: req.id, title: req.title, description: req.description },
        reviews: chunk,
      });
    }
  }

  const verdictsByRequirement = new Map<string, EvidenceVerdict[]>();
  const outputs = await mapWithConcurrency(jobs, ctx.maxConcurrency ?? DEFAULT_CONCURRENCY, async (job, index) => {
    ctx.onProgress?.(`judging requirement evidence (${index + 1}/${jobs.length})`);
    return ctx.model.generate({
      stage: "requirement-evidence",
      promptVersion: requirementEvidencePrompt.version,
      system: requirementEvidencePrompt.system,
      user: requirementEvidencePrompt.buildUser({
        requirement: job.requirement,
        candidateReviews: job.reviews,
        outputLocale: ctx.outputLocale,
      }),
      schema: RequirementEvidenceOutputSchema,
      onProgress: modelProgressRelay(ctx.onProgress),
    });
  });

  // Group verdicts by the requirement the job was issued for (the model's echoed
  // requirementId is untrusted bookkeeping).
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const output = outputs[i];
    const list = verdictsByRequirement.get(job.requirementId) ?? [];
    list.push(...output.verdicts);
    verdictsByRequirement.set(job.requirementId, list);
  }

  return applyRequirementEvidence(ctx.requirements, ctx.findings, verdictsByRequirement);
}
