import { describe, it, expect, vi } from "vitest";
import type { Finding } from "@/domain/contracts/analysis";
import { runPlanningStage, type PlanningStageContext } from "./planning";

const findings: Finding[] = [
  {
    id: "finding-1",
    topicIds: ["topic-1"],
    title: "Subscription too expensive",
    summary: "Users say the paid plan costs too much",
    supportingReviewIds: ["r1", "r2"],
    supportingSampleCount: 2,
    evidenceExcerpts: [
      { reviewId: "r1", excerpt: "price is too expensive" },
      { reviewId: "r2", excerpt: "price too high" },
    ],
    conflictingReviewIds: [],
    confidence: { level: "low", method: "deterministic-v1", reasons: [] },
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
  title: "Timer state loss",
  summary: "Users lose timer progress",
  supportingReviewIds: ["r8", "r9"],
  supportingSampleCount: 2,
  evidenceExcerpts: [
    { reviewId: "r8", excerpt: "timer resets" },
    { reviewId: "r9", excerpt: "timer restarts" },
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
};

const STRONG_SUFFICIENT_FINDING: Finding = {
  ...SUFFICIENT_FINDING,
  id: "finding-3",
  supportingReviewIds: Array.from({ length: 40 }, (_, i) => `s${i}`),
  supportingSampleCount: 40,
  confidence: { level: "high", method: "deterministic-v1", reasons: [] },
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
