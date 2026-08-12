import { describe, it, expect, vi } from "vitest";
import type { Requirement } from "@/domain/contracts/analysis";
import { runTestsStage, type TestsStageContext } from "./tests";

const requirements: Requirement[] = [
  {
    id: "req-1",
    findingIds: ["finding-1"],
    title: "Add annual plan",
    description: "Offer a cheaper yearly subscription",
    sourceReviewIds: ["r1", "r2"],
    priority: "P1",
    acceptanceCriteria: ["annual plan is selectable"],
    versionId: "ver-1",
  },
];

const TESTS_RESPONSE = {
  tests: [
    {
      id: "test-1",
      requirementIds: ["req-1"],
      sourceReviewIds: ["r1"],
      testType: "manual",
      precondition: "logged in",
      steps: ["open pricing", "choose annual"],
      expectedResult: "annual plan is selectable",
    },
  ],
};

function context(overrides: Partial<TestsStageContext> = {}, testsResponse = TESTS_RESPONSE): TestsStageContext {
  const generate = vi.fn(async () => testsResponse);
  return {
    model: { generate } as never,
    requirements,
    outputLocale: "en",
    ...overrides,
  };
}

describe("runTestsStage", () => {
  it("produces tests linked to requirements and source reviews", async () => {
    const result = await runTestsStage(context());
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].requirementIds).toContain("req-1");
    expect(result.tests[0].sourceReviewIds).toEqual(["r1"]);
  });

  it("drops a test whose review ids are not in the requirement's evidence", async () => {
    const ctx = context(
      {},
      {
        tests: [
          {
            id: "test-1",
            requirementIds: ["req-1"],
            sourceReviewIds: ["ghost-review"],
            testType: "manual",
            precondition: "",
            steps: ["step"],
            expectedResult: "ok",
          },
        ],
      },
    );
    const result = await runTestsStage(ctx);
    expect(result.tests).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_TEST")).toBe(true);
  });

  it("drops a test referencing a non-existent requirement", async () => {
    const ctx = context(
      {},
      {
        tests: [
          {
            id: "test-2",
            requirementIds: ["ghost-req"],
            sourceReviewIds: ["r1"],
            testType: "manual",
            precondition: "",
            steps: ["step"],
            expectedResult: "ok",
          },
        ],
      },
    );
    const result = await runTestsStage(ctx);
    expect(result.tests).toHaveLength(0);
  });

  it("keeps the prd bundle with tests attached", async () => {
    const result = await runTestsStage(context());
    expect(result.prd.tests).toHaveLength(1);
  });
});
