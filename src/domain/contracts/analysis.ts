import { z } from "zod";

export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const PrioritySchema = z.enum(["P0", "P1", "P2"]);
export type Priority = z.infer<typeof PrioritySchema>;

/**
 * The seven decision factors behind a version planning decision. Severity,
 * User Impact, Implementation Scope, Dependency and rationale are the model's
 * semantic judgment; evidenceStrength, confidence and frequency are always
 * recomputed deterministically from the linked findings.
 */
export const PlanningFactorsSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  evidenceStrength: z.enum(["insufficient", "low", "medium", "high"]),
  confidence: ConfidenceLevelSchema,
  userImpact: z.enum(["high", "medium", "low"]),
  frequency: z.object({
    supportingReviewCount: z.number().int().min(0),
    corpusReviewCount: z.number().int().min(0),
    supportRatio: z.number().min(0).max(1),
  }),
  implementationScope: z.enum(["small", "medium", "large"]),
  dependencyRequirementIds: z.array(z.string()).default([]),
  rationale: z.string().min(1).max(2_000),
});
export type PlanningFactors = z.infer<typeof PlanningFactorsSchema>;

/** A single verbatim excerpt anchored to a specific review. */
export const EvidenceExcerptSchema = z.object({
  reviewId: z.string().min(1),
  excerpt: z.string().min(1).max(5_000),
});
export type EvidenceExcerpt = z.infer<typeof EvidenceExcerptSchema>;

export const ConfidenceSchema = z.object({
  level: ConfidenceLevelSchema,
  // Deterministic code output, never model output. `deterministic-v1` is kept
  // only so old cached runs/fixtures still parse; new code always emits v2.
  method: z.enum(["deterministic-v1", "deterministic-v2"]),
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

/** A structured focus dimension split out of the user's analysis goal by the
 *  scope stage (scope@2). Each area is a concrete dimension the goal asked to
 *  be covered; downstream stages map findings/requirements back to it so the
 *  plan demonstrably covers the requested goal. */
export const FocusAreaSchema = z.object({
  id: z.string().regex(/^focus-/).min(1),
  label: z.string().min(1).max(200),
});
export type FocusArea = z.infer<typeof FocusAreaSchema>;

/** Coverage status of one goal dimension after planning. */
export const GoalCoverageStatusSchema = z.enum(["covered", "unsupported", "uncovered"]);
export type GoalCoverageStatus = z.infer<typeof GoalCoverageStatusSchema>;

/** Per-dimension coverage detail. `findingIds` is the set of sufficient
 *  findings mapped to the dimension; `requirementIds` is the set of
 *  requirements that reference those findings. `covered` = the dimension has a
 *  sufficient finding AND at least one requirement; `unsupported` = no
 *  sufficient finding (nothing to plan); `uncovered` = sufficient findings
 *  exist but no requirement was produced for them. */
export const GoalCoverageItemSchema = z.object({
  focusAreaId: z.string().min(1),
  label: z.string().min(1).max(200),
  status: GoalCoverageStatusSchema,
  findingIds: z.array(z.string()).default([]),
  requirementIds: z.array(z.string()).default([]),
});
export type GoalCoverageItem = z.infer<typeof GoalCoverageItemSchema>;

/** Deterministic audit of goal coverage across the plan. `valid` is true when
 *  no dimension with sufficient evidence is left without a requirement;
 *  `retried` records whether a coverage-repair planning call ran. */
export const GoalCoverageReportSchema = z.object({
  valid: z.boolean(),
  retried: z.boolean(),
  items: z.array(GoalCoverageItemSchema),
});
export type GoalCoverageReport = z.infer<typeof GoalCoverageReportSchema>;

/** A model-generated, evidence-grounded finding. */
export const FindingSchema = z
  .object({
    id: z.string().regex(/^finding-/).min(1),
    topicIds: z.array(z.string()).default([]),
    // The goal dimensions this finding maps to. Missing on old cached runs,
    // where it parses to an empty array (legacy-compatible).
    focusAreaIds: z.array(z.string()).default([]),
    // Candidate ids merged into this finding by the semantic consolidation
    // stage. Empty for findings that were never consolidated.
    sourceFindingIds: z.array(z.string()).default([]),
    title: z.string().min(1).max(500),
    summary: z.string().min(1).max(5_000),
    supportingReviewIds: z.array(z.string()).min(1),
    // Distinct content-group ids of the supporting reviews (see
    // deriveContentGroupId). A re-synced/adversarial copy of the same body
    // shares a group, so support counts are not inflated by duplicated text.
    // Optional: legacy artifacts carry no field.
    supportingContentGroupIds: z.array(z.string()).default([]).optional(),
    supportingSampleCount: z.number().int().min(0),
    evidenceExcerpts: z.array(EvidenceExcerptSchema).default([]),
    conflictingReviewIds: z.array(z.string()).default([]),
    confidence: ConfidenceSchema,
    evidenceSufficiency: EvidenceSufficiencySchema,
    uncertainties: z.array(z.string()).default([]),
    limitations: z.array(z.string()).default([]),
  })
  .superRefine((f, ctx) => {
    // New artifacts carry content-group ids and count support in distinct
    // groups; legacy artifacts (empty ids) keep the old reviewId-count rule so
    // cached runs and fixtures still parse.
    const groupCount = new Set(f.supportingContentGroupIds ?? []).size;
    const expected = groupCount > 0 ? groupCount : f.supportingReviewIds.length;
    if (f.supportingSampleCount !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportingSampleCount"],
        message: "supportingSampleCount must equal the number of distinct supporting content groups",
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

/**
 * A per-(requirement, review) semantic verdict from the requirement-evidence
 * selection step. Only reviews judged "direct" (or, as a fallback, "partial")
 * enter `sourceReviewIds`; "none" is recorded for audit but never cited as
 * formal support.
 */
export const EvidenceVerdictSchema = z.object({
  reviewId: z.string().min(1),
  relation: z.enum(["direct", "partial", "none"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(1_000),
});
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;

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
  // Optional only for old cached runs; the planning normalizer always writes it.
  planningFactors: PlanningFactorsSchema.optional(),
  // Optional for old cached runs and the planning stage's pre-selection output;
  // the requirement-evidence stage writes it with the full audit verdicts.
  evidenceVerdicts: z.array(EvidenceVerdictSchema).optional(),
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
  // Optional only for old cached runs; the planning normalizer always writes it.
  rationale: z.string().min(1).max(2_000).optional(),
});
export type VersionPlan = z.infer<typeof VersionPlanSchema>;

/** A persisted snapshot of the version planning decision for every requirement. */
export const VersionPlanArtifactSchema = z.object({
  versions: z.array(VersionPlanSchema),
  decisions: z.array(z.object({
    requirementId: z.string().regex(/^req-/),
    priority: PrioritySchema,
    versionId: z.string().nullable(),
    planningFactors: PlanningFactorsSchema,
  })),
});
export type VersionPlanArtifact = z.infer<typeof VersionPlanArtifactSchema>;

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
  // Optional so old cached runs without goal coverage stay readable.
  goalCoverage: GoalCoverageReportSchema.optional(),
});
export type Prd = z.infer<typeof PrdSchema>;
