import type { Prd, Requirement, TestCase } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { testsPrompt, TestsOutputSchema, type TestsOutput } from "@/server/model/prompts/prompts";
import { modelProgressRelay, type StageModelClient } from "../dependencies";
import { findingIdsForRequirements, priorityForRequirements } from "@/domain/traceability/evidence-sources";

export type TestsStageContext = {
  model: StageModelClient;
  requirements: Requirement[];
  outputLocale: "en" | "zh-CN";
  prd?: Prd;
  reviews?: NormalizedReview[];
  /** Live progress callback; invoked with a human-readable message while the
   *  model call is in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
};

export type TestsStageResult = {
  tests: TestCase[];
  prd: Prd;
  warnings: { code: string; message: string }[];
};

function allowedReviewsFor(requirementIds: string[], requirements: Requirement[], reviews: NormalizedReview[]): Set<string> {
  const allowed = new Set<string>();
  for (const req of requirements) {
    if (requirementIds.includes(req.id)) {
      for (const id of req.sourceReviewIds) allowed.add(id);
    }
  }
  // Also accept the original source id for any allowed review (models often
  // echo the source id they saw in the input corpus).
  const reviewIdToSource = new Map(reviews.map((r) => [r.reviewId, r.sourceReviewId]));
  for (const allowedId of [...allowed]) {
    const src = reviewIdToSource.get(allowedId);
    if (src) allowed.add(src);
  }
  return allowed;
}

/**
 * Normalizes raw model tests into protocol-valid tests. Every test must
 * reference at least one existing requirement and only review IDs inside that
 * requirement's evidence; source-id references are normalized to the stable
 * reviewId.
 */
export function normalizeTestsOutput(
  output: TestsOutput,
  requirements: Requirement[],
  reviews: NormalizedReview[],
  prd?: Prd,
): TestsStageResult {
  const warnings: { code: string; message: string }[] = [];
  const reqIndex = new Set(requirements.map((r) => r.id));

  const tests: TestCase[] = [];
  for (const t of output.tests) {
    const validReqs = t.requirementIds.filter((id) => reqIndex.has(id));
    if (validReqs.length === 0) {
      warnings.push({ code: "UNSUPPORTED_TEST", message: `dropped ${t.id} (no valid requirement links)` });
      continue;
    }
    const allowed = allowedReviewsFor(validReqs, requirements, reviews);
    const validReviews = t.sourceReviewIds.filter((id) => allowed.has(id));
    if (validReviews.length === 0) {
      warnings.push({ code: "UNSUPPORTED_TEST", message: `dropped ${t.id} (no valid source reviews)` });
      continue;
    }
    // Normalize any source-id reference to the stable reviewId so the
    // downstream traceability ledger stays consistent.
    const toReviewId = (id: string) => reviews.find((r) => r.reviewId === id || r.sourceReviewId === id)?.reviewId ?? id;
    tests.push({
      id: t.id,
      requirementIds: validReqs,
      // Direct Finding links and priority are deterministic application-code
      // fields derived from the requirement graph, never trusted from the
      // model (the tests prompt output contract does not carry them).
      findingIds: findingIdsForRequirements(validReqs, requirements),
      sourceReviewIds: [...new Set(validReviews.map(toReviewId))],
      testType: t.testType,
      precondition: t.precondition,
      steps: t.steps,
      expectedResult: t.expectedResult,
      priority: priorityForRequirements(validReqs, requirements) ?? "P2",
    });
  }

  const resultPrd: Prd = prd
    ? { ...prd, tests }
    : {
        outputLocale: "en",
        title: "Draft PRD",
        overview: "Requirements and tests",
        findings: [],
        requirements,
        versions: [],
        tests,
        assumptions: [],
      };

  return { tests, prd: resultPrd, warnings };
}

/**
 * Generates test cases against the PRD. Every test must reference at least one
 * existing requirement and only review IDs inside that requirement's evidence.
 * The result also merges the tests into the prd bundle.
 */
export async function runTestsStage(ctx: TestsStageContext): Promise<TestsStageResult> {
  ctx.onProgress?.("generating test cases from the PRD");
  const output = await ctx.model.generate({
    stage: "tests",
    promptVersion: testsPrompt.version,
    system: testsPrompt.system,
    user: testsPrompt.buildUser({ requirements: ctx.requirements, outputLocale: ctx.outputLocale }),
    schema: TestsOutputSchema,
    onProgress: modelProgressRelay(ctx.onProgress),
  });

  return normalizeTestsOutput(output, ctx.requirements, ctx.reviews ?? [], ctx.prd);
}
