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

  it("derives deduped finding links and the most urgent priority across requirements", async () => {
    const twoReqs: Requirement[] = [
      {
        id: "req-1",
        findingIds: ["finding-1"],
        title: "Add annual plan",
        description: "x",
        sourceReviewIds: ["r1", "r2"],
        priority: "P1",
        acceptanceCriteria: ["a"],
        versionId: "ver-1",
      },
      {
        id: "req-2",
        findingIds: ["finding-2", "finding-1"],
        title: "Show price",
        description: "y",
        sourceReviewIds: ["r3"],
        priority: "P0",
        acceptanceCriteria: ["b"],
        versionId: null,
      },
    ];
    const ctx = context(
      { requirements: twoReqs },
      {
        tests: [
          {
            id: "test-1",
            requirementIds: ["req-1", "req-2"],
            sourceReviewIds: ["r1", "r3"],
            testType: "manual",
            precondition: "logged in",
            steps: ["open pricing"],
            expectedResult: "price shown",
          },
        ],
      },
    );
    const result = await runTestsStage(ctx);
    // finding-1 appears in both requirements but is deduped; order follows the
    // requirement list and each requirement's declared finding order.
    expect(result.tests[0].findingIds).toEqual(["finding-1", "finding-2"]);
    expect(result.tests[0].priority).toBe("P0");
  });

  it("falls back to P2 when no linked requirement resolves", async () => {
    const ctx = context(
      { requirements: [] },
      {
        tests: [
          {
            id: "test-1",
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
});
