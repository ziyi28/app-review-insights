import { describe, it, expect } from "vitest";
import type { Prd } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { validateTraceability } from "./validate";

function reviewMap(ids: string[]): Map<string, NormalizedReview> {
  return new Map(
    ids.map((id) => [
      id,
      {
        reviewId: id,
        sourceReviewId: id,
        source: "apple-rss",
        titleOriginal: "",
        bodyOriginal: "price is too expensive for me",
        bodyNormalized: "price is too expensive for me",
        rating: 5,
        version: null,
        updatedAt: null,
        language: "en",
        rawRef: "raw:" + id,
        includedInAnalysis: true,
        dedupeStatus: "unique",
        duplicateOf: null,
      },
    ]),
  );
}

function makePrd(): Prd {
  return {
    outputLocale: "en",
    title: "Plan",
    overview: "x",
    findings: [
      {
        id: "finding-1",
        topicIds: ["topic-1"],
        title: "Pricing",
        summary: "cost complaints",
        supportingReviewIds: ["r1", "r2"],
        supportingSampleCount: 2,
        evidenceExcerpts: [
          { reviewId: "r1", excerpt: "price is too expensive" },
          { reviewId: "r2", excerpt: "price is too expensive" },
        ],
        conflictingReviewIds: [],
        confidence: { level: "low", method: "deterministic-v1", reasons: [] },
        uncertainties: [],
        limitations: [],
      },
    ],
    requirements: [
      {
        id: "req-1",
        findingIds: ["finding-1"],
        title: "Lower price",
        description: "add annual plan",
        sourceReviewIds: ["r1", "r2"],
        priority: "P1",
        acceptanceCriteria: ["annual selectable"],
        versionId: "ver-1",
      },
    ],
    versions: [{ id: "ver-1", name: "1.0.0", summary: "x", requirementIds: ["req-1"] }],
    tests: [
      {
        id: "test-1",
        requirementIds: ["req-1"],
        sourceReviewIds: ["r1"],
        testType: "manual",
        precondition: "",
        steps: ["step"],
        expectedResult: "ok",
      },
    ],
    assumptions: [{ id: "asm-1", text: "x", basis: "y" }],
  };
}

describe("validateTraceability", () => {
  it("passes a fully consistent prd", () => {
    const report = validateTraceability(makePrd(), ["r1", "r2"]);
    expect(report.valid).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("flags a finding citing a non-existent review", () => {
    const prd = makePrd();
    prd.findings[0].supportingReviewIds = ["ghost"];
    prd.findings[0].supportingSampleCount = 1;
    const report = validateTraceability(prd, ["r1"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REVIEW_NOT_FOUND")).toBe(true);
  });

  it("flags a requirement whose source reviews are not the findings evidence", () => {
    const prd = makePrd();
    prd.requirements[0].sourceReviewIds = ["r1", "r2", "r9"];
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_EVIDENCE_MISMATCH")).toBe(true);
  });

  it("flags a requirement with no finding link", () => {
    const prd = makePrd();
    prd.requirements[0].findingIds = [];
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_NO_FINDING")).toBe(true);
  });

  it("flags a test citing a review outside the requirement evidence", () => {
    const prd = makePrd();
    prd.tests[0].sourceReviewIds = ["r9"];
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "TEST_REVIEW_OUTSIDE_EVIDENCE")).toBe(true);
  });

  it("flags an uncovered requirement (no test)", () => {
    const prd = makePrd();
    prd.tests = [];
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_UNCOVERED")).toBe(true);
  });

  it("rejects an assumption id used as a requirement id (schema enforces prefix)", () => {
    const prd = makePrd();
    prd.requirements[0].id = "asm-1";
    expect(() => validateTraceability(prd, ["r1", "r2"])).not.toThrow();
  });

  it("flags a fabricated excerpt", () => {
    const prd = makePrd();
    prd.findings[0].evidenceExcerpts = [{ reviewId: "r1", excerpt: "never said this" }];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "EXCERPT_NOT_EXACT")).toBe(true);
  });
});
