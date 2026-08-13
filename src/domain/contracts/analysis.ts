import { z } from "zod";

export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const PrioritySchema = z.enum(["P0", "P1", "P2"]);
export type Priority = z.infer<typeof PrioritySchema>;

/** A single verbatim excerpt anchored to a specific review. */
export const EvidenceExcerptSchema = z.object({
  reviewId: z.string().min(1),
  excerpt: z.string().min(1).max(5_000),
});
export type EvidenceExcerpt = z.infer<typeof EvidenceExcerptSchema>;

export const ConfidenceSchema = z.object({
  level: ConfidenceLevelSchema,
  method: z.string().min(1),
  reasons: z.array(z.string()).default([]),
});
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Deterministic verdict on whether the evidence supports a broad or critical claim. */
export const EvidenceSufficiencySchema = z.object({
  status: z.enum(["sufficient", "insufficient"]),
  corpusReviewCount: z.number().int().min(0),
  supportRatio: z.number().min(0).max(1),
  reasons: z.array(z.enum([
    "SUPPORT_BELOW_MINIMUM",
    "SUPPORT_RATIO_BELOW_MINIMUM",
    "SOURCE_NOT_COMPLETE",
    "CONFLICT_NOT_MINOR",
  ])).default([]),
});
export type EvidenceSufficiency = z.infer<typeof EvidenceSufficiencySchema>;

/** A model-generated, evidence-grounded finding. */
export const FindingSchema = z
  .object({
    id: z.string().regex(/^finding-/).min(1),
    topicIds: z.array(z.string()).default([]),
    title: z.string().min(1).max(500),
    summary: z.string().min(1).max(5_000),
    supportingReviewIds: z.array(z.string()).min(1),
    supportingSampleCount: z.number().int().min(0),
    evidenceExcerpts: z.array(EvidenceExcerptSchema).default([]),
    conflictingReviewIds: z.array(z.string()).default([]),
    confidence: ConfidenceSchema,
    evidenceSufficiency: EvidenceSufficiencySchema,
    uncertainties: z.array(z.string()).default([]),
    limitations: z.array(z.string()).default([]),
  })
  .superRefine((f, ctx) => {
    if (f.supportingSampleCount !== f.supportingReviewIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportingSampleCount"],
        message: "supportingSampleCount must equal the number of distinct supportingReviewIds",
      });
    }
    const seen = new Set<string>();
    for (const e of f.evidenceExcerpts) {
      if (seen.has(e.reviewId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceExcerpts"],
          message: "duplicate excerpt for review " + e.reviewId,
        });
      }
      seen.add(e.reviewId);
    }
  });
export type Finding = z.infer<typeof FindingSchema>;

/** A product requirement traceable to one or more findings. */
export const RequirementSchema = z.object({
  id: z.string().regex(/^req-/).min(1),
  findingIds: z.array(z.string()).min(1),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5_000),
  sourceReviewIds: z.array(z.string()).default([]),
  priority: PrioritySchema.default("P2"),
  acceptanceCriteria: z.array(z.string()).min(1),
  versionId: z.string().nullable().default(null),
});
export type Requirement = z.infer<typeof RequirementSchema>;

/** An explicit assumption that is NOT evidence-backed. */
export const AssumptionSchema = z.object({
  id: z.string().regex(/^asm-/).min(1),
  text: z.string().min(1).max(2_000),
  basis: z.string().min(1).max(2_000),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const VersionPlanSchema = z.object({
  id: z.string().regex(/^ver-/).min(1),
  name: z.string().min(1).max(128),
  summary: z.string().min(1).max(2_000),
  requirementIds: z.array(z.string()).default([]),
});
export type VersionPlan = z.infer<typeof VersionPlanSchema>;

/** A test case linked to requirements, their findings, and source reviews. */
export const TestCaseSchema = z.object({
  id: z.string().regex(/^test-/).min(1),
  requirementIds: z.array(z.string()).min(1),
  // Direct Finding links and a priority are deterministic application-code
  // fields (see traceability/evidence-sources), never trusted from the model.
  findingIds: z.array(z.string()).min(1),
  sourceReviewIds: z.array(z.string()).min(1),
  testType: z.enum(["manual", "automated"]).default("manual"),
  precondition: z.string().max(2_000).default(""),
  steps: z.array(z.string()).min(1),
  expectedResult: z.string().min(1).max(2_000),
  priority: PrioritySchema,
});
export type TestCase = z.infer<typeof TestCaseSchema>;

/** The full PRD bundle produced by the planning stage. */
export const PrdSchema = z.object({
  outputLocale: z.enum(["en", "zh-CN"]),
  title: z.string().min(1),
  overview: z.string().min(1),
  findings: z.array(FindingSchema),
  requirements: z.array(RequirementSchema),
  versions: z.array(VersionPlanSchema),
  tests: z.array(TestCaseSchema),
  assumptions: z.array(AssumptionSchema).default([]),
});
export type Prd = z.infer<typeof PrdSchema>;
