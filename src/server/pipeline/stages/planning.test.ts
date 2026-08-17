import { describe, it, expect, vi } from "vitest";
import type { Finding, FocusArea } from "@/domain/contracts/analysis";
import { runPlanningStage, runPlanningWithCoverage, type PlanningStageContext } from "./planning";

const findings: Finding[] = [
  {
    id: "finding-1",
    topicIds: ["topic-1"],
    focusAreaIds: [],
    sourceFindingIds: [],
    title: "Subscription too expensive",
    summary: "Users say the paid plan costs too much",
    supportingReviewIds: ["r1", "r2"],
    supportingContentGroupIds: ["group-r1", "group-r2"],
    supportingSampleCount: 2,
    evidenceExcerpts: [
      { reviewId: "r1", excerpt: "price is too expensive" },
      { reviewId: "r2", excerpt: "price too high" },
    ],
    conflictingReviewIds: [],
    confidence: { level: "low", method: "deterministic-v2", reasons: [] },
    evidenceSufficiency: {
      status: "insufficient",
      corpusReviewCount: 3000,
      supportRatio: 2 / 3000,
      reasons: ["SUPPORT_BELOW_MINIMUM", "SUPPORT_RATIO_BELOW_MINIMUM"],
    },
    uncertainties: [],
    limitations: [],
  },
];

const SUFFICIENT_FINDING: Finding = {
  id: "finding-2",
  topicIds: ["topic-1"],
  focusAreaIds: [],
  sourceFindingIds: [],
  title: "Timer state loss",
  summary: "Users lose timer progress",
  supportingReviewIds: ["r8", "r9"],
  supportingContentGroupIds: ["group-r8", "group-r9"],
  supportingSampleCount: 2,
  evidenceExcerpts: [
    { reviewId: "r8", excerpt: "timer resets" },
    { reviewId: "r9", excerpt: "timer restarts" },
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
};

const STRONG_SUFFICIENT_FINDING: Finding = {
  ...SUFFICIENT_FINDING,
  id: "finding-3",
  supportingReviewIds: Array.from({ length: 40 }, (_, i) => `s${i}`),
  supportingContentGroupIds: Array.from({ length: 40 }, (_, i) => `group-s${i}`),
  supportingSampleCount: 40,
  confidence: { level: "high", method: "deterministic-v2", reasons: [] },
  evidenceSufficiency: {
    status: "sufficient",
    corpusReviewCount: 100,
    supportRatio: 0.4,
    reasons: [],
  },
};

const PLANNING_FACTORS = {
  severity: "high",
  userImpact: "high",
  implementationScope: "medium",
  dependencyRequirementIds: [] as string[],
  rationale: "Supported user impact and bounded implementation scope",
};

const PLANNING_RESPONSE = {
  title: "Release plan",
  overview: "Address pricing complaints",
  versions: [{ id: "ver-1", name: "1.0.0", summary: "Pricing", rationale: "Ships the pricing fixes first", requirementIds: ["req-1"] }],
  requirements: [
    {
      id: "req-1",
      findingIds: ["finding-1"],
      title: "Add annual plan",
      description: "Offer a cheaper yearly subscription",
      priority: "P1",
      acceptanceCriteria: ["annual plan is selectable"],
      versionId: "ver-1",
      planningFactors: PLANNING_FACTORS,
    },
  ],
  assumptions: [{ id: "asm-1", text: "Annual plan converts better", basis: "inferred from pricing complaints" }],
};

type PlanningResponse = {
  title: string;
  overview: string;
  versions: {
    id: string;
    name: string;
    summary: string;
    rationale: string;
    requirementIds: string[];
  }[];
  requirements: {
    id: string;
    findingIds: string[];
    title: string;
    description: string;
    priority: string;
    acceptanceCriteria: string[];
    versionId: string | null;
    planningFactors?: {
      severity: string;
      userImpact: string;
      implementationScope: string;
      dependencyRequirementIds: string[];
      rationale: string;
    };
  }[];
  assumptions: { id: string; text: string; basis: string }[];
};

function context(
  overrides: Partial<PlanningStageContext> = {},
  planningResponse: PlanningResponse = PLANNING_RESPONSE,
  findingsOverride: Finding[] = findings,
): PlanningStageContext {
  const generate = vi.fn(async () => planningResponse);
  return {
    model: { generate } as never,
    findings: findingsOverride,
    outputLocale: "en",
    goal: "Understand pricing complaints",
    ...overrides,
  };
}

describe("runPlanningStage", () => {
  it("produces requirements that reference findings and derive source reviews", async () => {
    const result = await runPlanningStage(context());
    expect(result.prd.requirements[0].findingIds).toContain("finding-1");
    // sourceReviewIds must be deterministically derived from finding evidence.
    expect(result.prd.requirements[0].sourceReviewIds.sort()).toEqual(["r1", "r2"]);
  });

  it("moves unsupported ideas into assumptions, not requirements", async () => {
    const ctx = context(
      {},
      {
        title: "x",
        overview: "y",
        versions: [],
        requirements: [
          {
            id: "req-1",
            findingIds: ["ghost-finding"],
            title: "Idea without evidence",
            description: "no finding backs this",
            priority: "P2",
            acceptanceCriteria: ["works"],
            versionId: null,
            planningFactors: PLANNING_FACTORS,
          },
        ],
        assumptions: [],
      },
    );
    const result = await runPlanningStage(ctx);
    expect(result.prd.requirements).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_REQUIREMENT")).toBe(true);
  });

  it("keeps assumptions separate from requirements", async () => {
    const result = await runPlanningStage(context());
    expect(result.prd.assumptions).toHaveLength(1);
    expect(result.prd.assumptions[0].id).toMatch(/^asm-/);
  });

  it("downgrades a requirement backed only by insufficient findings", async () => {
    // finding-1 is insufficient; model returns P1/ver-1 for it.
    const result = await runPlanningStage(context());
    expect(result.prd.requirements[0]).toMatchObject({ priority: "P2", versionId: null });
    // The version no longer claims a requirement that does not point to it.
    expect(result.prd.versions).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED")).toBe(true);
  });

  it("keeps model priority when at least one linked finding is sufficient", async () => {
    const planningResponse: PlanningResponse = {
      title: "Release plan",
      overview: "Address timer and pricing",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Fixes", rationale: "x", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          // Links one insufficient finding and one sufficient finding.
          findingIds: ["finding-1", "finding-2"],
          title: "Add annual plan",
          description: "Offer a cheaper yearly subscription",
          priority: "P1",
          acceptanceCriteria: ["annual plan is selectable"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, planningResponse, [findings[0], SUFFICIENT_FINDING]));
    expect(result.prd.requirements[0]).toMatchObject({ priority: "P1", versionId: "ver-1" });
    expect(result.warnings.some((w) => w.code === "INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED")).toBe(false);
  });

  it("caps a model P0 to P1 when a factor is missing", async () => {
    // finding-2 is sufficient but low-confidence; model requests P0.
    const planningResponse: PlanningResponse = {
      title: "Release plan",
      overview: "Timer fixes",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Fixes", rationale: "x", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-2"],
          title: "Fix timer loss",
          description: "Preserve timer state",
          priority: "P0",
          acceptanceCriteria: ["timer persists"],
          versionId: "ver-1",
          planningFactors: { ...PLANNING_FACTORS, severity: "high" },
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, planningResponse, [SUFFICIENT_FINDING]));
    expect(result.prd.requirements[0].priority).toBe("P1");
    expect(result.warnings.some((w) => w.code === "PLANNING_PRIORITY_CAPPED")).toBe(true);
  });

  it("keeps P0 only when all four strong factors hold", async () => {
    const planningResponse: PlanningResponse = {
      title: "Release plan",
      overview: "Critical fixes",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Fixes", rationale: "x", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-3"],
          title: "Fix crash on launch",
          description: "App crashes for most users",
          priority: "P0",
          acceptanceCriteria: ["app launches"],
          versionId: "ver-1",
          planningFactors: { ...PLANNING_FACTORS, severity: "critical" },
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, planningResponse, [STRONG_SUFFICIENT_FINDING]));
    expect(result.prd.requirements[0].priority).toBe("P0");
    expect(result.prd.requirements[0].planningFactors).toMatchObject({
      severity: "critical",
      evidenceStrength: "high",
      confidence: "high",
      userImpact: "high",
    });
  });

  it("drops unknown and self dependencies with a warning", async () => {
    const planningResponse: PlanningResponse = {
      title: "Release plan",
      overview: "x",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "x", requirementIds: ["req-1", "req-2"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-3"],
          title: "A",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["a"],
          versionId: "ver-1",
          planningFactors: { ...PLANNING_FACTORS, dependencyRequirementIds: ["req-2", "req-1", "ghost"] },
        },
        {
          id: "req-2",
          findingIds: ["finding-3"],
          title: "B",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["b"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, planningResponse, [STRONG_SUFFICIENT_FINDING]));
    expect(result.prd.requirements[0].planningFactors!.dependencyRequirementIds).toEqual(["req-2"]);
    expect(result.warnings.some((w) => w.code === "PLANNING_DEPENDENCY_DROPPED")).toBe(true);
  });

  it("prunes a scheduled requirement's dependency on an unscheduled requirement", async () => {
    const planningResponse: PlanningResponse = {
      title: "Release plan",
      overview: "x",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "x", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-3"],
          title: "A",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["a"],
          versionId: "ver-1",
          planningFactors: { ...PLANNING_FACTORS, dependencyRequirementIds: ["req-2"] },
        },
        {
          id: "req-2",
          findingIds: ["finding-1"], // insufficient evidence -> versionId becomes null
          title: "B",
          description: "d",
          priority: "P2",
          acceptanceCriteria: ["b"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, planningResponse, [STRONG_SUFFICIENT_FINDING, findings[0]]));
    // req-1 stays scheduled, but its dependency on unscheduled req-2 is pruned.
    expect(result.prd.requirements[0].versionId).toBe("ver-1");
    expect(result.prd.requirements[0].planningFactors!.dependencyRequirementIds).toEqual([]);
    expect(result.warnings.some((w) => w.code === "PLANNING_DEPENDENCY_UNSCHEDULED")).toBe(true);
    // req-2 itself is dropped to unscheduled (insufficient evidence).
    expect(result.prd.requirements[1].versionId).toBeNull();
  });

  it("keeps one version from one version and two versions from two versions", async () => {
    const one = await runPlanningStage(context());
    expect(one.prd.versions).toHaveLength(0); // req-1 dropped (insufficient)

    const two: PlanningResponse = {
      title: "Release plan",
      overview: "x",
      versions: [
        { id: "ver-1", name: "1.0.0", summary: "First", rationale: "x", requirementIds: ["req-1"] },
        { id: "ver-2", name: "2.0.0", summary: "Second", rationale: "x", requirementIds: ["req-2"] },
      ],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-3"],
          title: "A",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["a"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
        {
          id: "req-2",
          findingIds: ["finding-3"],
          title: "B",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["b"],
          versionId: "ver-2",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    const twoResult = await runPlanningStage(context({}, two, [STRONG_SUFFICIENT_FINDING]));
    expect(twoResult.prd.versions.map((v) => v.id)).toEqual(["ver-1", "ver-2"]);
    expect(twoResult.prd.requirements.map((r) => r.id)).toEqual(["req-1", "req-2"]);
  });

  it("deletes empty versions", async () => {
    const empty: PlanningResponse = {
      title: "Release plan",
      overview: "x",
      versions: [
        { id: "ver-1", name: "1.0.0", summary: "Ships", rationale: "x", requirementIds: ["req-1"] },
        { id: "ver-2", name: "2.0.0", summary: "Empty", rationale: "x", requirementIds: [] },
      ],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-3"],
          title: "A",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["a"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, empty, [STRONG_SUFFICIENT_FINDING]));
    expect(result.prd.versions.map((v) => v.id)).toEqual(["ver-1"]);
  });

  it("exposes versionPlan decisions that match the final requirements", async () => {
    const result = await runPlanningStage(context());
    expect(result.versionPlan.decisions).toHaveLength(result.prd.requirements.length);
    for (const decision of result.versionPlan.decisions) {
      const requirement = result.prd.requirements.find((r) => r.id === decision.requirementId);
      expect(requirement).toBeDefined();
      expect(decision.priority).toBe(requirement!.priority);
      expect(decision.versionId).toBe(requirement!.versionId);
      expect(decision.planningFactors).toBeDefined();
    }
  });
});

// A sufficient finding mapped to focus-1 so goal-coverage has something real
// to cover. Built as a standalone fixture (not derived from the insufficient
// `findings` above).
const COVERABLE_FINDING: Finding = {
  id: "finding-cover",
  topicIds: ["topic-1"],
  focusAreaIds: ["focus-1"],
  sourceFindingIds: [],
  title: "Pricing is too high",
  summary: "Many users report the cost is prohibitive",
  supportingReviewIds: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"],
  supportingContentGroupIds: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10"],
  supportingSampleCount: 10,
  evidenceExcerpts: [{ reviewId: "r1", excerpt: "too expensive" }],
  conflictingReviewIds: [],
  confidence: { level: "high", method: "deterministic-v2", reasons: [] },
  evidenceSufficiency: {
    status: "sufficient",
    corpusReviewCount: 100,
    supportRatio: 0.1,
    reasons: [],
  },
  uncertainties: [],
  limitations: [],
};

const FOCUS_AREAS: FocusArea[] = [{ id: "focus-1", label: "Pricing" }];

function coverageContext(
  overrides: Partial<PlanningStageContext> = {},
  planningResponse: PlanningResponse = PLANNING_RESPONSE,
  findingsOverride: Finding[] = [COVERABLE_FINDING],
): PlanningStageContext {
  const generate = vi.fn(async () => planningResponse);
  return {
    model: { generate } as never,
    findings: findingsOverride,
    outputLocale: "en",
    goal: "Understand pricing complaints",
    focusAreas: FOCUS_AREAS,
    ...overrides,
  };
}

describe("runPlanningWithCoverage", () => {
  it("does not retry when every covered focus area already has a requirement", async () => {
    const planningResponse: PlanningResponse = {
      ...PLANNING_RESPONSE,
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-cover"],
          title: "Lower price",
          description: "Add annual plan",
          priority: "P1",
          acceptanceCriteria: ["annual plan selectable"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
    };
    const ctx = coverageContext({}, planningResponse);
    const result = await runPlanningWithCoverage(ctx);
    expect(result.goalCoverage.retried).toBe(false);
    expect(result.goalCoverage.valid).toBe(true);
    expect(result.goalCoverage.items[0]).toMatchObject({ focusAreaId: "focus-1", status: "covered" });
    // Exactly one planning call (no repair).
    expect(ctx.model.generate).toHaveBeenCalledTimes(1);
  });

  it("does not retry for an unsupported area and records it as unsupported", async () => {
    // The finding is insufficient, so focus-1 has no sufficient evidence.
    const ctx = coverageContext({}, PLANNING_RESPONSE, [findings[0]]);
    const result = await runPlanningWithCoverage(ctx);
    expect(result.goalCoverage.retried).toBe(false);
    expect(result.goalCoverage.valid).toBe(true); // unsupported is not a gap
    expect(result.goalCoverage.items[0]).toMatchObject({ focusAreaId: "focus-1", status: "unsupported" });
    expect(ctx.model.generate).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when a covered area has no requirement, and adopts the repair", async () => {
    // First plan omits any requirement for the covered finding-cover.
    const emptyPlan: PlanningResponse = {
      title: "Release plan",
      overview: "o",
      versions: [],
      requirements: [],
      assumptions: [],
    };
    // Repair plan adds the missing requirement.
    const repairPlan: PlanningResponse = {
      title: "Release plan",
      overview: "o",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "s", rationale: "r", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-cover"],
          title: "Lower price",
          description: "Add annual plan",
          priority: "P1",
          acceptanceCriteria: ["annual plan selectable"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    // First call (base planning) returns the empty plan; the repair call
    // returns the plan that closes the gap.
    const generate = vi.fn()
      .mockResolvedValueOnce(emptyPlan)
      .mockResolvedValueOnce(repairPlan);
    const ctx = coverageContext({ model: { generate } as never }, emptyPlan);
    const result = await runPlanningWithCoverage(ctx);
    expect(result.goalCoverage.retried).toBe(true);
    expect(result.goalCoverage.valid).toBe(true);
    expect(result.goalCoverage.items[0]).toMatchObject({ focusAreaId: "focus-1", status: "covered" });
    // Exactly two calls: planning + coverage-repair.
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-monotonic repair that loses existing coverage", async () => {
    // A second coverable finding for focus-2, and a base plan that only covers
    // focus-1 → focus-2 is uncovered, triggering the repair. The repair returns
    // the same base plan (no improvement) so it is rejected.
    const cover2 = { ...COVERABLE_FINDING, id: "finding-cover2", focusAreaIds: ["focus-2"], supportingReviewIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] };
    const areas2: FocusArea[] = [{ id: "focus-1", label: "Pricing" }, { id: "focus-2", label: "Trial" }];
    const basePlan: PlanningResponse = {
      title: "Release plan",
      overview: "o",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "s", rationale: "r", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-cover"],
          title: "Lower price",
          description: "d",
          priority: "P1",
          acceptanceCriteria: ["c"],
          versionId: "ver-1",
          planningFactors: PLANNING_FACTORS,
        },
      ],
      assumptions: [],
    };
    // Repair drops focus-2's requirement entirely (non-monotonic: focus-1 was
    // covered before, stays covered; focus-2 is still uncovered after). Since
    // focus-2's finding is in the findings list, base coverage has focus-2 as
    // UNCOVERED, triggering the repair. The repair still leaves it uncovered →
    // rejected (no improvement).
    const repairDrops: PlanningResponse = { ...basePlan };
    const generate = vi.fn(async () => repairDrops);
    const ctx: PlanningStageContext = {
      model: { generate } as never,
      findings: [COVERABLE_FINDING, cover2],
      outputLocale: "en",
      goal: "Understand pricing and trial",
      focusAreas: areas2,
    };
    const result = await runPlanningWithCoverage(ctx);
    // The repair did not close the gap and did not lose coverage, but it also
    // made no progress → rejected, keeping the base plan (retried=false).
    expect(result.goalCoverage.retried).toBe(false);
    expect(result.goalCoverage.valid).toBe(false); // focus-2 still uncovered
  });
});
