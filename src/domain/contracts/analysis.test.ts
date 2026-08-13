import { describe, it, expect } from "vitest";
import {
  FindingSchema,
  RequirementSchema,
  PrdSchema,
  TestCaseSchema,
  AssumptionSchema,
} from "./analysis";

describe("analysis contracts", () => {
  const validFinding = {
    id: "finding-1",
    topicIds: ["topic-1"],
    title: "Pricing complaints",
    summary: "Users dislike the subscription cost",
    supportingReviewIds: ["review-1", "review-2"],
    supportingSampleCount: 2,
    evidenceExcerpts: [{ reviewId: "review-1", excerpt: "too expensive" }],
    conflictingReviewIds: [],
    confidence: { level: "low", method: "deterministic-v1", reasons: ["small sample"] },
    evidenceSufficiency: {
      status: "insufficient",
      corpusReviewCount: 3000,
      supportRatio: 2 / 3000,
      reasons: ["SUPPORT_BELOW_MINIMUM"],
    },
    uncertainties: [],
    limitations: [],
  };

  it("accepts a finding with supporting evidence", () => {
    expect(FindingSchema.parse(validFinding).supportingSampleCount).toBe(2);
  });

  it("rejects a finding with a bad sufficiency status", () => {
    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        evidenceSufficiency: { status: "enough", corpusReviewCount: 100, supportRatio: 0.5, reasons: [] },
      }),
    ).toThrow();
  });

  it("rejects a finding with an out-of-range support ratio", () => {
    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        evidenceSufficiency: { status: "sufficient", corpusReviewCount: 100, supportRatio: 1.5, reasons: [] },
      }),
    ).toThrow();
  });

  it("rejects a finding with an unknown sufficiency reason", () => {
    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        evidenceSufficiency: {
          status: "insufficient",
          corpusReviewCount: 100,
          supportRatio: 0.01,
          reasons: ["UNKNOWN_REASON"],
        },
      }),
    ).toThrow();
  });

  it("rejects a finding without supporting reviews", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, supportingReviewIds: [], supportingSampleCount: 0 }),
    ).toThrow();
  });

  it("rejects a finding with a bad confidence level", () => {
    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        confidence: { level: "certain", method: "deterministic-v1", reasons: [] },
      }),
    ).toThrow();
  });

  it("requires a requirement to reference a finding", () => {
    expect(() =>
      RequirementSchema.parse({
        id: "req-1",
        findingIds: [],
        title: "Lower price",
        description: "Add annual plan",
        sourceReviewIds: ["review-1"],
        priority: "P1",
        acceptanceCriteria: ["annual plan selectable"],
        versionId: null,
      }),
    ).toThrow();
  });

  it("accepts an assumption independently of requirements", () => {
    const assumption = AssumptionSchema.parse({
      id: "asm-1",
      text: "Free tier would increase conversion",
      basis: "inferred from low ratings",
    });
    expect(assumption.id).toBe("asm-1");
  });

  it("rejects a test case without a requirement link", () => {
    expect(() =>
      TestCaseSchema.parse({
        id: "test-1",
        requirementIds: [],
        sourceReviewIds: ["review-1"],
        testType: "manual",
        precondition: "",
        steps: ["step"],
        expectedResult: "ok",
      }),
    ).toThrow();
  });

  it("rejects a test case without source review ids", () => {
    expect(() =>
      TestCaseSchema.parse({
        id: "test-1",
        requirementIds: ["req-1"],
        sourceReviewIds: [],
        testType: "manual",
        precondition: "",
        steps: ["step"],
        expectedResult: "ok",
      }),
    ).toThrow();
  });

  it("round-trips a full prd bundle", () => {
    const prd = PrdSchema.parse({
      outputLocale: "en",
      title: "Release plan",
      overview: "What we ship",
      findings: [validFinding],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-1"],
          title: "Lower price",
          description: "Add annual plan",
          sourceReviewIds: ["review-1"],
          priority: "P1",
          acceptanceCriteria: ["annual plan selectable"],
          versionId: "ver-1",
        },
      ],
      versions: [
        { id: "ver-1", name: "1.0.0", summary: "Monetization", requirementIds: ["req-1"] },
      ],
      tests: [
        {
          id: "test-1",
          requirementIds: ["req-1"],
          sourceReviewIds: ["review-1"],
          testType: "manual",
          precondition: "",
          steps: ["step"],
          expectedResult: "ok",
        },
      ],
      assumptions: [AssumptionSchema.parse({ id: "asm-1", text: "x", basis: "y" })],
    });
    expect(prd.versions).toHaveLength(1);
  });
});
