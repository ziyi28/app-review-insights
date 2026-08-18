import { describe, it, expect, vi } from "vitest";
import type { Finding, Requirement } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { runRequirementEvidenceStage, type RequirementEvidenceStageContext } from "./requirement-evidence";

function review(id: string, body: string): NormalizedReview {
  return {
    reviewId: id,
    sourceReviewId: id,
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: body,
    bodyNormalized: body,
    contentGroupId: `group-${id}`,
    rating: 1,
    version: null,
    updatedAt: null,
    language: "en",
    rawRef: "raw:" + id,
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
  };
}

function finding(id: string, supportingReviewIds: string[]): Finding {
  return {
    id,
    topicIds: [],
    focusAreaIds: [],
    sourceFindingIds: [],
    title: `finding ${id}`,
    summary: "summary",
    supportingReviewIds,
    supportingContentGroupIds: supportingReviewIds.map((r) => `group-${r}`),
    supportingSampleCount: supportingReviewIds.length,
    evidenceExcerpts: supportingReviewIds.map((r) => ({ reviewId: r, excerpt: "excerpt" })),
    conflictingReviewIds: [],
    confidence: { level: "low", method: "deterministic-v2", reasons: [] },
    evidenceSufficiency: { status: "sufficient", corpusReviewCount: 100, supportRatio: 0.1, reasons: [] },
    uncertainties: [],
    limitations: [],
  };
}

function requirement(id: string, findingIds: string[]): Requirement {
  return {
    id,
    findingIds,
    title: `requirement ${id}`,
    description: "description",
    sourceReviewIds: [],
    priority: "P2",
    acceptanceCriteria: ["criterion"],
    versionId: null,
  };
}

function context(
  requirements: Requirement[],
  findings: Finding[],
  reviews: NormalizedReview[],
  generate: ReturnType<typeof vi.fn>,
): RequirementEvidenceStageContext {
  return {
    model: { generate } as never,
    requirements,
    findings,
    reviews,
    outputLocale: "en",
  };
}

describe("runRequirementEvidenceStage", () => {
  it("judges each candidate review and narrows sourceReviewIds to direct support", async () => {
    const findings = [finding("finding-1", ["r1", "r2", "r3"])];
    const req = requirement("req-stability", ["finding-1"]);
    const reviews = [
      review("r1", "the app freezes after half an hour of taking notes"),
      review("r2", "i had the one time purchase which has now changed"),
      review("r3", "it crashes whenever i open a large document"),
    ];
    const generate = vi.fn(async () => ({
      requirementId: "req-stability",
      verdicts: [
        { reviewId: "r1", relation: "direct", confidence: 0.9, reason: "reports a freeze" },
        { reviewId: "r2", relation: "none", confidence: 0.95, reason: "complaint about purchase, not stability" },
        { reviewId: "r3", relation: "direct", confidence: 0.9, reason: "reports a crash" },
      ],
    }));

    const result = await runRequirementEvidenceStage(context([req], findings, reviews, generate));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.requirements[0].sourceReviewIds).toEqual(["r1", "r3"]);
    expect(result.requirements[0].sourceReviewIds).not.toContain("r2");
    expect(result.requirements[0].evidenceVerdicts).toHaveLength(3);
  });

  it("supports one review backing several requirements with independent verdicts", async () => {
    const findings = [
      finding("finding-1", ["multi"]),
      finding("finding-2", ["multi"]),
      finding("finding-3", ["multi"]),
    ];
    const reqSub = requirement("req-subscription", ["finding-1"]);
    const reqUpdate = requirement("req-update-regression", ["finding-2"]);
    const reqStability = requirement("req-performance-stability", ["finding-3"]);
    const reviews = [review("multi", "i had the one time purchase which has now changed. after the update my files became read-only")];
    // Each requirement is a separate model call.
    const generate = vi.fn()
      .mockResolvedValueOnce({ requirementId: "req-subscription", verdicts: [{ reviewId: "multi", relation: "direct", confidence: 0.9, reason: "purchase change" }] })
      .mockResolvedValueOnce({ requirementId: "req-update-regression", verdicts: [{ reviewId: "multi", relation: "direct", confidence: 0.9, reason: "update broke files" }] })
      .mockResolvedValueOnce({ requirementId: "req-performance-stability", verdicts: [{ reviewId: "multi", relation: "none", confidence: 0.9, reason: "not a stability symptom" }] });

    const result = await runRequirementEvidenceStage(context([reqSub, reqUpdate, reqStability], findings, reviews, generate));

    const byId = new Map(result.requirements.map((r) => [r.id, r]));
    expect(byId.get("req-subscription")!.sourceReviewIds).toEqual(["multi"]);
    expect(byId.get("req-update-regression")!.sourceReviewIds).toEqual(["multi"]);
    expect(byId.get("req-performance-stability")!.sourceReviewIds).toEqual([]);
  });
});
