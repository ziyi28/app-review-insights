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
    uncertainties: [],
    limitations: [],
  },
];

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

function context(overrides: Partial<PlanningStageContext> = {}, planningResponse: PlanningResponse = PLANNING_RESPONSE): PlanningStageContext {
  const generate = vi.fn(async () => planningResponse);
  return {
    model: { generate } as never,
    findings,
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
});
