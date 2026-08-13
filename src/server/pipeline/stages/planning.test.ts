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

const PLANNING_RESPONSE = {
  title: "Release plan",
  overview: "Address pricing complaints",
  versions: [{ id: "ver-1", name: "1.0.0", summary: "Pricing", requirementIds: ["req-1"] }],
  requirements: [
    {
      id: "req-1",
      findingIds: ["finding-1"],
      title: "Add annual plan",
      description: "Offer a cheaper yearly subscription",
      priority: "P1",
      acceptanceCriteria: ["annual plan is selectable"],
      versionId: "ver-1",
    },
  ],
  assumptions: [{ id: "asm-1", text: "Annual plan converts better", basis: "inferred from pricing complaints" }],
};

type PlanningResponse = {
  title: string;
  overview: string;
  versions: { id: string; name: string; summary: string; requirementIds: string[] }[];
  requirements: {
    id: string;
    findingIds: string[];
    title: string;
    description: string;
    priority: string;
    acceptanceCriteria: string[];
    versionId: string | null;
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
    expect(result.prd.versions[0].requirementIds).not.toContain("req-1");
    expect(result.warnings.some((w) => w.code === "INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED")).toBe(true);
  });

  it("keeps model priority when at least one linked finding is sufficient", async () => {
    const planningResponse: PlanningResponse = {
      title: "Release plan",
      overview: "Address timer and pricing",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Fixes", requirementIds: ["req-1"] }],
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
        },
      ],
      assumptions: [],
    };
    const result = await runPlanningStage(context({}, planningResponse, [findings[0], SUFFICIENT_FINDING]));
    expect(result.prd.requirements[0]).toMatchObject({ priority: "P1", versionId: "ver-1" });
    expect(result.warnings.some((w) => w.code === "INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED")).toBe(false);
  });

  it("keeps dropping a requirement with no valid finding links rather than downgrading it", async () => {
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
          },
        ],
        assumptions: [],
      },
    );
    const result = await runPlanningStage(ctx);
    expect(result.prd.requirements).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_REQUIREMENT")).toBe(true);
  });
});
