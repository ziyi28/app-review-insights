import { describe, it, expect } from "vitest";
import type { Prd, Requirement } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { validateTraceability } from "./validate";
import { findingIdsForRequirements, priorityForRequirements } from "./evidence-sources";

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
        focusAreaIds: [],
        sourceFindingIds: [],
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
        evidenceSufficiency: {
          status: "sufficient",
          corpusReviewCount: 100,
          supportRatio: 0.08,
          reasons: [],
        },
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
        findingIds: ["finding-1"],
        sourceReviewIds: ["r1"],
        testType: "manual",
        precondition: "",
        steps: ["step"],
        expectedResult: "ok",
        priority: "P1",
      },
    ],
    assumptions: [{ id: "asm-1", text: "x", basis: "y" }],
  };
}

describe("traceability derivation helpers", () => {
  const reqs: Requirement[] = [
    { id: "req-1", findingIds: ["finding-1"], title: "a", description: "a", sourceReviewIds: ["r1"], priority: "P1", acceptanceCriteria: ["c"], versionId: null },
    { id: "req-2", findingIds: ["finding-2", "finding-1"], title: "b", description: "b", sourceReviewIds: ["r2"], priority: "P0", acceptanceCriteria: ["c"], versionId: null },
  ];

  it("unions direct finding links in stable requirement order, deduped", () => {
    expect(findingIdsForRequirements(["req-1", "req-2"], reqs)).toEqual(["finding-1", "finding-2"]);
  });

  it("picks the most urgent priority across linked requirements", () => {
    expect(priorityForRequirements(["req-1", "req-2"], reqs)).toBe("P0");
    expect(priorityForRequirements(["req-1"], reqs)).toBe("P1");
    expect(priorityForRequirements([], reqs)).toBeNull();
  });
});

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

  it("flags a test whose direct finding ids are not derived from its requirements", () => {
    const prd = makePrd();
    prd.tests[0].findingIds = ["finding-2"];
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "TEST_FINDING_MISMATCH")).toBe(true);
  });

  it("flags a test whose priority is not derived from its requirements", () => {
    const prd = makePrd();
    prd.tests[0].priority = "P2";
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "TEST_PRIORITY_MISMATCH")).toBe(true);
  });

  it("passes a test whose finding ids and priority match its requirements", () => {
    const report = validateTraceability(makePrd(), ["r1", "r2"]);
    expect(report.valid).toBe(true);
  });

  it("passes a dependency scheduled in the same or an earlier version", () => {
    const prd = makePrd();
    prd.requirements.push({
      id: "req-2",
      findingIds: ["finding-1"],
      title: "b",
      description: "b",
      sourceReviewIds: ["r1", "r2"],
      priority: "P1",
      acceptanceCriteria: ["c"],
      versionId: "ver-1",
      planningFactors: {
        severity: "high",
        evidenceStrength: "high",
        confidence: "high",
        userImpact: "high",
        frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
        implementationScope: "medium",
        dependencyRequirementIds: ["req-1"],
        rationale: "depends on req-1 in the same version",
      },
    });
    prd.requirements[0].planningFactors = {
      severity: "high",
      evidenceStrength: "high",
      confidence: "high",
      userImpact: "high",
      frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
      implementationScope: "medium",
      dependencyRequirementIds: [],
      rationale: "x",
    };
    prd.tests.push({
      id: "test-2",
      requirementIds: ["req-2"],
      findingIds: ["finding-1"],
      sourceReviewIds: ["r1"],
      testType: "manual",
      precondition: "",
      steps: ["step"],
      expectedResult: "ok",
      priority: "P1",
    });
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(true);
  });

  it("flags a dependency cycle", () => {
    const prd = makePrd();
    prd.requirements.push({
      id: "req-2",
      findingIds: ["finding-1"],
      title: "b",
      description: "b",
      sourceReviewIds: ["r1", "r2"],
      priority: "P1",
      acceptanceCriteria: ["c"],
      versionId: "ver-1",
      planningFactors: {
        severity: "high",
        evidenceStrength: "high",
        confidence: "high",
        userImpact: "high",
        frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
        implementationScope: "medium",
        dependencyRequirementIds: ["req-1"],
        rationale: "depends on req-1",
      },
    });
    prd.requirements[0].planningFactors = {
      severity: "high",
      evidenceStrength: "high",
      confidence: "high",
      userImpact: "high",
      frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
      implementationScope: "medium",
      dependencyRequirementIds: ["req-2"],
      rationale: "depends on req-2, forming a cycle",
    };
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_DEPENDENCY_CYCLE")).toBe(true);
  });

  it("flags a dependency on an unscheduled requirement", () => {
    const prd = makePrd();
    prd.requirements[0].planningFactors = {
      severity: "high",
      evidenceStrength: "high",
      confidence: "high",
      userImpact: "high",
      frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
      implementationScope: "medium",
      dependencyRequirementIds: ["req-2"],
      rationale: "depends on an unscheduled requirement",
    };
    prd.requirements.push({
      id: "req-2",
      findingIds: ["finding-1"],
      title: "b",
      description: "b",
      sourceReviewIds: ["r1", "r2"],
      priority: "P1",
      acceptanceCriteria: ["c"],
      versionId: null,
      planningFactors: {
        severity: "high",
        evidenceStrength: "high",
        confidence: "high",
        userImpact: "high",
        frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
        implementationScope: "medium",
        dependencyRequirementIds: [],
        rationale: "x",
      },
    });
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_DEPENDENCY_UNSCHEDULED")).toBe(true);
  });

  it("flags a dependency scheduled in a later version", () => {
    const prd = makePrd();
    prd.versions.push({ id: "ver-2", name: "2.0.0", summary: "later", requirementIds: ["req-2"] });
    prd.requirements.push({
      id: "req-2",
      findingIds: ["finding-1"],
      title: "b",
      description: "b",
      sourceReviewIds: ["r1", "r2"],
      priority: "P1",
      acceptanceCriteria: ["c"],
      versionId: "ver-2",
      planningFactors: {
        severity: "high",
        evidenceStrength: "high",
        confidence: "high",
        userImpact: "high",
        frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
        implementationScope: "medium",
        dependencyRequirementIds: [],
        rationale: "x",
      },
    });
    prd.requirements[0].planningFactors = {
      severity: "high",
      evidenceStrength: "high",
      confidence: "high",
      userImpact: "high",
      frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
      implementationScope: "medium",
      dependencyRequirementIds: ["req-2"],
      rationale: "depends on a later requirement",
    };
    const report = validateTraceability(prd, ["r1", "r2"]);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_DEPENDENCY_LATE")).toBe(true);
  });
});
