import { describe, it, expect } from "vitest";
import type { Prd, Requirement } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { validateTraceability, deriveClosureStatus } from "./validate";
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
        contentGroupId: `group-${id}`,
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
        supportingContentGroupIds: ["group-r1", "group-r2"],
        supportingSampleCount: 2,
        evidenceExcerpts: [
          { reviewId: "r1", excerpt: "price is too expensive" },
          { reviewId: "r2", excerpt: "price is too expensive" },
        ],
        conflictingReviewIds: [],
        confidence: { level: "low", method: "deterministic-v2", reasons: [] },
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
    assumptions: [{ id: "asm-1", text: "x", basis: "y", origin: "model", sourceFindingIds: [], sourceReviewIds: [] }],
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
    const report = validateTraceability(makePrd(), ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("counts support by content group: two review ids of the same body are one sample", () => {
    const prd = makePrd();
    // r1 and r2 share one content group; the finding cites both review ids but
    // only one distinct group, and the sample count follows the group count.
    const sameGroupMap = reviewMap(["r1", "r2"]);
    sameGroupMap.get("r1")!.contentGroupId = "group-same";
    sameGroupMap.get("r2")!.contentGroupId = "group-same";
    prd.findings[0].supportingContentGroupIds = ["group-same"];
    prd.findings[0].supportingSampleCount = 1;
    prd.findings[0].evidenceExcerpts = [
      { reviewId: "r1", excerpt: "price is too expensive" },
      { reviewId: "r2", excerpt: "price is too expensive" },
    ];
    prd.requirements[0].sourceReviewIds = ["r1", "r2"];
    const report = validateTraceability(prd, ["r1", "r2"], sameGroupMap);
    expect(report.valid).toBe(true);
  });

  it("flags a sample count that does not match the distinct content groups", () => {
    const prd = makePrd();
    prd.findings[0].supportingContentGroupIds = ["group-r1", "group-r2"];
    prd.findings[0].supportingSampleCount = 1; // two distinct groups, count 1
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "SAMPLE_COUNT_MISMATCH")).toBe(true);
  });

  it("flags a finding citing a non-existent review", () => {
    const prd = makePrd();
    prd.findings[0].supportingReviewIds = ["ghost"];
    prd.findings[0].supportingSampleCount = 1;
    const report = validateTraceability(prd, ["r1"], reviewMap(["r1"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REVIEW_NOT_FOUND")).toBe(true);
  });

  it("flags a requirement whose source reviews are not the findings evidence", () => {
    const prd = makePrd();
    prd.requirements[0].sourceReviewIds = ["r1", "r2", "r9"];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_EVIDENCE_MISMATCH")).toBe(true);
  });

  it("flags a requirement with no finding link", () => {
    const prd = makePrd();
    prd.requirements[0].findingIds = [];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_NO_FINDING")).toBe(true);
  });

  it("flags a test citing a review outside the requirement evidence", () => {
    const prd = makePrd();
    prd.tests[0].sourceReviewIds = ["r9"];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "TEST_REVIEW_OUTSIDE_EVIDENCE")).toBe(true);
  });

  it("flags an uncovered requirement (no test)", () => {
    const prd = makePrd();
    prd.tests = [];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_UNCOVERED")).toBe(true);
  });

  it("rejects an assumption id used as a requirement id (schema enforces prefix)", () => {
    const prd = makePrd();
    prd.requirements[0].id = "asm-1";
    expect(() => validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]))).not.toThrow();
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
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "TEST_FINDING_MISMATCH")).toBe(true);
  });

  it("flags a test whose priority is not derived from its requirements", () => {
    const prd = makePrd();
    prd.tests[0].priority = "P2";
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "TEST_PRIORITY_MISMATCH")).toBe(true);
  });

  it("passes a test whose finding ids and priority match its requirements", () => {
    const report = validateTraceability(makePrd(), ["r1", "r2"], reviewMap(["r1", "r2"]));
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
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
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
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_DEPENDENCY_CYCLE")).toBe(true);
  });

  it("flags a dependency on an unknown requirement id instead of skipping it", () => {
    const prd = makePrd();
    prd.requirements[0].planningFactors = {
      severity: "high",
      evidenceStrength: "high",
      confidence: "high",
      userImpact: "high",
      frequency: { supportingReviewCount: 8, corpusReviewCount: 100, supportRatio: 0.08 },
      implementationScope: "medium",
      dependencyRequirementIds: ["req-ghost"],
      rationale: "depends on a requirement that does not exist",
    };
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations).toContainEqual({
      code: "REQUIREMENT_UNKNOWN_DEPENDENCY",
      message: "req-1 depends on unknown requirement req-ghost",
      entity: "req-1",
    });
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
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
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
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === "REQUIREMENT_DEPENDENCY_LATE")).toBe(true);
  });

  it("flags a finding citing the same review as both supporting and conflicting", () => {
    const prd = makePrd();
    prd.findings[0].conflictingReviewIds = ["r1"];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations).toContainEqual({
      code: "FINDING_CONFLICT_OVERLAP",
      message: "finding-1 cites r1 as both supporting and conflicting",
      entity: "finding-1",
    });
  });

  it("reports closed status for fully covered sufficient findings without insufficient findings", () => {
    const prd = makePrd();
    prd.assumptions = [];
    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(true);
    expect(report.closureStatus).toBe("closed");
  });

  it("reports partial status for mixed evidence when insufficient finding has tracking assumption", () => {
    const prd = makePrd();
    prd.findings.push({
      id: "finding-2",
      topicIds: ["topic-1"],
      focusAreaIds: [],
      sourceFindingIds: [],
      title: "Sync issue",
      summary: "Sync fails rarely",
      supportingReviewIds: ["r1"],
      supportingContentGroupIds: ["group-r1"],
      supportingSampleCount: 1,
      evidenceExcerpts: [{ reviewId: "r1", excerpt: "price is too expensive" }],
      conflictingReviewIds: [],
      confidence: { level: "low", method: "deterministic-v2", reasons: [] },
      evidenceSufficiency: {
        status: "insufficient",
        corpusReviewCount: 100,
        supportRatio: 0.01,
        reasons: ["SUPPORT_BELOW_MINIMUM"],
      },
      uncertainties: [],
      limitations: [],
    });
    prd.assumptions.push({
      id: "asm-insufficient-finding-2",
      text: "Sync fails rarely",
      basis: "Evidence insufficient",
      origin: "insufficient-finding",
      sourceFindingIds: ["finding-2"],
      sourceReviewIds: ["r1"],
    });

    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(true);
    expect(report.closureStatus).toBe("partial");
  });

  it("reports assumption-only status when all findings are insufficient and requirements are empty", () => {
    const prd: Prd = {
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
          supportingContentGroupIds: ["group-r1", "group-r2"],
          supportingSampleCount: 2,
          evidenceExcerpts: [
            { reviewId: "r1", excerpt: "price is too expensive" },
            { reviewId: "r2", excerpt: "price is too expensive" },
          ],
          conflictingReviewIds: [],
          confidence: { level: "low", method: "deterministic-v2", reasons: [] },
          evidenceSufficiency: {
            status: "insufficient",
            corpusReviewCount: 100,
            supportRatio: 0.02,
            reasons: ["SUPPORT_BELOW_MINIMUM"],
          },
          uncertainties: [],
          limitations: [],
        },
      ],
      requirements: [],
      versions: [],
      tests: [],
      assumptions: [
        {
          id: "asm-insufficient-finding-1",
          text: "Pricing",
          basis: "Insufficient",
          origin: "insufficient-finding",
          sourceFindingIds: ["finding-1"],
          sourceReviewIds: ["r1", "r2"],
        },
      ],
    };

    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(true);
    expect(report.closureStatus).toBe("assumption-only");
  });

  it("flags REQUIREMENT_INSUFFICIENT_EVIDENCE when requirement cites an insufficient finding", () => {
    const prd = makePrd();
    prd.findings[0].evidenceSufficiency.status = "insufficient";
    prd.assumptions.push({
      id: "asm-insufficient-finding-1",
      text: "Pricing",
      basis: "Insufficient",
      origin: "insufficient-finding",
      sourceFindingIds: ["finding-1"],
      sourceReviewIds: ["r1", "r2"],
    });

    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.closureStatus).toBe("invalid");
    expect(report.violations).toContainEqual({
      code: "REQUIREMENT_INSUFFICIENT_EVIDENCE",
      message: "req-1 references finding finding-1 which has insufficient evidence",
      entity: "req-1",
    });
  });

  it("flags INSUFFICIENT_FINDING_UNTRACKED when an insufficient finding has no tracking assumption", () => {
    const prd = makePrd();
    prd.findings.push({
      id: "finding-2",
      topicIds: ["topic-1"],
      focusAreaIds: [],
      sourceFindingIds: [],
      title: "Sync issue",
      summary: "Sync fails rarely",
      supportingReviewIds: ["r1"],
      supportingContentGroupIds: ["group-r1"],
      supportingSampleCount: 1,
      evidenceExcerpts: [{ reviewId: "r1", excerpt: "price is too expensive" }],
      conflictingReviewIds: [],
      confidence: { level: "low", method: "deterministic-v2", reasons: [] },
      evidenceSufficiency: {
        status: "insufficient",
        corpusReviewCount: 100,
        supportRatio: 0.01,
        reasons: ["SUPPORT_BELOW_MINIMUM"],
      },
      uncertainties: [],
      limitations: [],
    });

    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations).toContainEqual({
      code: "INSUFFICIENT_FINDING_UNTRACKED",
      message: "finding-2 has insufficient evidence but has no tracking assumption",
      entity: "finding-2",
    });
  });

  it("flags SUFFICIENT_FINDING_UNCOVERED when a sufficient finding is not cited by any requirement", () => {
    const prd = makePrd();
    prd.findings.push({
      id: "finding-2",
      topicIds: ["topic-1"],
      focusAreaIds: [],
      sourceFindingIds: [],
      title: "Timer reset",
      summary: "Timer resets on lock",
      supportingReviewIds: ["r1", "r2"],
      supportingContentGroupIds: ["group-r1", "group-r2"],
      supportingSampleCount: 2,
      evidenceExcerpts: [
        { reviewId: "r1", excerpt: "price is too expensive" },
        { reviewId: "r2", excerpt: "price is too expensive" },
      ],
      conflictingReviewIds: [],
      confidence: { level: "high", method: "deterministic-v2", reasons: [] },
      evidenceSufficiency: {
        status: "sufficient",
        corpusReviewCount: 100,
        supportRatio: 0.05,
        reasons: [],
      },
      uncertainties: [],
      limitations: [],
    });

    const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
    expect(report.valid).toBe(false);
    expect(report.violations).toContainEqual({
      code: "SUFFICIENT_FINDING_UNCOVERED",
      message: "finding-2 has sufficient evidence but is not covered by any requirement",
      entity: "finding-2",
    });
  });

  describe("deriveClosureStatus", () => {
    it("returns invalid if prd has no findings", () => {
      const prd = { ...makePrd(), findings: [], requirements: [], versions: [], tests: [], assumptions: [] };
      expect(deriveClosureStatus(prd, [])).toBe("invalid");
    });

    it("returns invalid if prd has no findings and no requirements even with model assumption", () => {
      const prd = {
        ...makePrd(),
        findings: [],
        requirements: [],
        versions: [],
        tests: [],
        assumptions: [{ id: "asm-1", text: "x", basis: "y", origin: "model" as const, sourceFindingIds: [], sourceReviewIds: [] }],
      };
      expect(deriveClosureStatus(prd, [])).toBe("invalid");
    });

    it("returns partial if requirements exist and assumptions are non-empty", () => {
      const prd = makePrd();
      expect(deriveClosureStatus(prd, [])).toBe("partial");
    });

    it("returns closed if requirements exist and assumptions are empty", () => {
      const prd = makePrd();
      prd.assumptions = [];
      expect(deriveClosureStatus(prd, [])).toBe("closed");
    });
  });

  describe("Task 1: Revision & Assumption validation rules", () => {
    it("rejects an empty PRD instead of calling it assumption-only", () => {
      const prd = { ...makePrd(), findings: [], requirements: [], versions: [], tests: [], assumptions: [] };
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
      expect(report.valid).toBe(false);
      expect(report.closureStatus).toBe("invalid");
      expect(report.violations.map((v) => v.code)).toContain("PRD_NO_FINDINGS");
    });

    it("rejects removal of a pre-revision sufficient finding", () => {
      const prd = { ...makePrd(), findings: [], requirements: [], versions: [], tests: [], assumptions: [] };
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]), {
        requiredSufficientFindingIds: ["finding-1"],
      });
      expect(report.violations.map((v) => v.code)).toContain(
        "REVISION_SUFFICIENT_FINDING_NOT_PRESERVED",
      );
    });

    it("rejects degradation of a pre-revision sufficient finding to insufficient", () => {
      const prd = makePrd();
      prd.findings[0].evidenceSufficiency.status = "insufficient";
      prd.assumptions.push({
        id: "asm-insufficient-finding-1",
        text: "cost",
        basis: "insufficient",
        origin: "insufficient-finding",
        sourceFindingIds: ["finding-1"],
        sourceReviewIds: ["r1", "r2"],
      });
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]), {
        requiredSufficientFindingIds: ["finding-1"],
      });
      expect(report.violations.map((v) => v.code)).toContain(
        "REVISION_SUFFICIENT_FINDING_NOT_PRESERVED",
      );
    });

    it("flags ASSUMPTION_ORIGIN_SOURCE_MISMATCH when origin is model but specifies sources", () => {
      const prd = makePrd();
      prd.assumptions = [
        {
          id: "asm-1",
          text: "x",
          basis: "y",
          origin: "model",
          sourceFindingIds: ["finding-1"],
          sourceReviewIds: [],
        },
      ];
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
      expect(report.valid).toBe(false);
      expect(report.violations.map((v) => v.code)).toContain("ASSUMPTION_ORIGIN_SOURCE_MISMATCH");
    });

    it("flags ASSUMPTION_SOURCE_FINDING_INVALID when insufficient-finding assumption points to unknown or sufficient finding", () => {
      const prd = makePrd();
      prd.assumptions = [
        {
          id: "asm-insufficient-finding-1",
          text: "x",
          basis: "y",
          origin: "insufficient-finding",
          sourceFindingIds: ["finding-1"], // finding-1 is sufficient
          sourceReviewIds: ["r1", "r2"],
        },
      ];
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
      expect(report.valid).toBe(false);
      expect(report.violations.map((v) => v.code)).toContain("ASSUMPTION_SOURCE_FINDING_INVALID");
    });

    it("flags ASSUMPTION_SOURCE_FINDING_INVALID when insufficient-finding assumption points to multiple findings", () => {
      const prd = makePrd();
      prd.findings[0].evidenceSufficiency.status = "insufficient";
      prd.assumptions = [
        {
          id: "asm-insufficient-multi",
          text: "x",
          basis: "y",
          origin: "insufficient-finding",
          sourceFindingIds: ["finding-1", "finding-2"],
          sourceReviewIds: ["r1", "r2"],
        },
      ];
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
      expect(report.valid).toBe(false);
      expect(report.violations.map((v) => v.code)).toContain("ASSUMPTION_SOURCE_FINDING_INVALID");
    });

    it("flags ASSUMPTION_SOURCE_REVIEW_MISMATCH when evidence-derived assumption cites mismatched reviews", () => {
      const prd = makePrd();
      prd.findings[0].evidenceSufficiency.status = "insufficient";
      prd.assumptions = [
        {
          id: "asm-insufficient-finding-1",
          text: "x",
          basis: "y",
          origin: "insufficient-finding",
          sourceFindingIds: ["finding-1"],
          sourceReviewIds: ["r1"], // missing r2
        },
      ];
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
      expect(report.valid).toBe(false);
      expect(report.violations.map((v) => v.code)).toContain("ASSUMPTION_SOURCE_REVIEW_MISMATCH");
    });

    it.each([
      { name: "empty", actual: [] },
      { name: "missing", actual: ["r1", "r2"] },
      { name: "extra", actual: ["r1", "r2", "r3", "r4", "r-extra"] },
    ])("rejects $name rejected-requirement evidence", ({ actual }) => {
      const prd = makePrd();
      const firstFinding = prd.findings[0];
      firstFinding.evidenceSufficiency.status = "insufficient";
      firstFinding.conflictingReviewIds = ["r3"];
      const secondFinding = {
        ...firstFinding,
        id: "finding-2",
        supportingReviewIds: ["r3"],
        supportingContentGroupIds: ["group-r3"],
        supportingSampleCount: 1,
        evidenceExcerpts: [{ reviewId: "r3", excerpt: "price is too expensive for me" }],
        conflictingReviewIds: ["r4"],
      };
      prd.findings = [firstFinding, secondFinding];
      prd.requirements = [];
      prd.versions = [];
      prd.tests = [];
      prd.assumptions = [{
        id: "asm-rejected-req-1",
        text: "defer requirement",
        basis: "insufficient evidence",
        origin: "rejected-requirement",
        sourceFindingIds: ["finding-1", "finding-2"],
        sourceReviewIds: actual,
      }];

      const report = validateTraceability(prd, ["r1", "r2", "r3", "r4"], reviewMap(["r1", "r2", "r3", "r4"]));
      expect(report.violations.map((v) => v.code)).toContain(
        "ASSUMPTION_SOURCE_REVIEW_MISMATCH",
      );
    });

    it("accepts rejected-requirement evidence as an order-independent set", () => {
      const prd = makePrd();
      const firstFinding = prd.findings[0];
      firstFinding.evidenceSufficiency.status = "insufficient";
      firstFinding.conflictingReviewIds = ["r3"];
      const secondFinding = {
        ...firstFinding,
        id: "finding-2",
        supportingReviewIds: ["r3"],
        supportingContentGroupIds: ["group-r3"],
        supportingSampleCount: 1,
        evidenceExcerpts: [{ reviewId: "r3", excerpt: "price is too expensive for me" }],
        conflictingReviewIds: ["r4"],
      };
      prd.findings = [firstFinding, secondFinding];
      prd.requirements = [];
      prd.versions = [];
      prd.tests = [];
      prd.assumptions = [{
        id: "asm-rejected-req-1",
        text: "defer requirement",
        basis: "insufficient evidence",
        origin: "rejected-requirement",
        sourceFindingIds: ["finding-1", "finding-2"],
        sourceReviewIds: ["r4", "r2", "r1", "r3", "r3"],
      }];

      const report = validateTraceability(prd, ["r1", "r2", "r3", "r4"], reviewMap(["r1", "r2", "r3", "r4"]));
      expect(report.violations.map((v) => v.code)).not.toContain(
        "ASSUMPTION_SOURCE_REVIEW_MISMATCH",
      );
    });

    it("flags INSUFFICIENT_FINDING_UNTRACKED when assumption has matching name but invalid origin or sourceFindingIds", () => {
      const prd = makePrd();
      prd.findings[0].evidenceSufficiency.status = "insufficient";
      prd.assumptions = [
        {
          id: "asm-insufficient-finding-1",
          text: "x",
          basis: "y",
          origin: "model",
          sourceFindingIds: [],
          sourceReviewIds: [],
        },
      ];
      const report = validateTraceability(prd, ["r1", "r2"], reviewMap(["r1", "r2"]));
      expect(report.valid).toBe(false);
      expect(report.violations.map((v) => v.code)).toContain("INSUFFICIENT_FINDING_UNTRACKED");
    });
  });
});

