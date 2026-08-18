import { describe, it, expect } from "vitest";
import type { EvidenceVerdict, Finding, Requirement } from "@/domain/contracts/analysis";
import { applyRequirementEvidence, candidateReviewIdsFor } from "./requirement-evidence";

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

function requirement(id: string, findingIds: string[], sourceReviewIds: string[] = []): Requirement {
  return {
    id,
    findingIds,
    title: `requirement ${id}`,
    description: "description",
    sourceReviewIds,
    priority: "P2",
    acceptanceCriteria: ["criterion"],
    versionId: null,
  };
}

function verdict(reviewId: string, relation: EvidenceVerdict["relation"]): EvidenceVerdict {
  return { reviewId, relation, confidence: 0.9, reason: "test verdict" };
}

describe("candidateReviewIdsFor", () => {
  it("unions the linked findings' supporting reviews, deduped", () => {
    const findings = [finding("finding-1", ["r1", "r2"]), finding("finding-2", ["r2", "r3"])];
    expect(candidateReviewIdsFor(requirement("req-1", ["finding-1", "finding-2"]), findings)).toEqual(["r1", "r2", "r3"]);
  });
});

describe("applyRequirementEvidence", () => {
  it("Case B — a review that directly supports the requirement is kept", () => {
    // Requirement: reduce crash/freeze/lag. Review: "app freezes after half an hour".
    const findings = [finding("finding-1", ["freeze-review"])];
    const req = requirement("req-stability", ["finding-1"]);
    const result = applyRequirementEvidence(
      [req],
      findings,
      new Map([["req-stability", [verdict("freeze-review", "direct")]]]),
    );
    expect(result.requirements[0].sourceReviewIds).toEqual(["freeze-review"]);
    expect(result.report.items[0]).toMatchObject({ directCount: 1, partialCount: 0, noneCount: 0, keptCount: 1 });
  });

  it("Case A — an unrelated review judged none is excluded from a stability requirement", () => {
    // Requirement: reduce crash/freeze/lag. Candidates include a genuine
    // freeze report (direct) and a purchase complaint (none, inherited from the
    // finding's broader evidence). The purchase review must not survive.
    const findings = [finding("finding-1", ["freeze-review", "purchase-review"])];
    const req = requirement("req-stability", ["finding-1"]);
    const result = applyRequirementEvidence(
      [req],
      findings,
      new Map([["req-stability", [verdict("freeze-review", "direct"), verdict("purchase-review", "none")]]]),
    );
    expect(result.requirements[0].sourceReviewIds).toEqual(["freeze-review"]);
    expect(result.requirements[0].sourceReviewIds).not.toContain("purchase-review");
    // The none verdict is still recorded in the audit, not silently dropped.
    expect(result.requirements[0].evidenceVerdicts!.find((v) => v.reviewId === "purchase-review")!.relation).toBe("none");
    expect(result.report.items[0]).toMatchObject({ candidateCount: 2, directCount: 1, noneCount: 1, keptCount: 1 });
  });

  it("Case C — one multi-topic review may support several requirements, each judged independently", () => {
    // Review: "one time purchase changed + update made files read-only".
    const multiReview = "multi-review";
    const findings = [finding("finding-1", [multiReview]), finding("finding-2", [multiReview]), finding("finding-3", [multiReview])];
    const reqSubscription = requirement("req-subscription", ["finding-1"]);
    const reqUpdate = requirement("req-update-regression", ["finding-2"]);
    const reqStability = requirement("req-performance-stability", ["finding-3"]);
    const result = applyRequirementEvidence(
      [reqSubscription, reqUpdate, reqStability],
      findings,
      new Map([
        ["req-subscription", [verdict(multiReview, "direct")]],
        ["req-update-regression", [verdict(multiReview, "direct")]],
        ["req-performance-stability", [verdict(multiReview, "none")]],
      ]),
    );
    const byId = new Map(result.requirements.map((r) => [r.id, r]));
    // The same review supports both subscription and update-regression…
    expect(byId.get("req-subscription")!.sourceReviewIds).toEqual([multiReview]);
    expect(byId.get("req-update-regression")!.sourceReviewIds).toEqual([multiReview]);
    // …but not stability, even though it is a candidate there.
    expect(byId.get("req-performance-stability")!.sourceReviewIds).toEqual([]);
  });

  it("falls back to partial evidence when a requirement has no direct review", () => {
    const findings = [finding("finding-1", ["weak-review"])];
    const req = requirement("req-1", ["finding-1"]);
    const result = applyRequirementEvidence(
      [req],
      findings,
      new Map([["req-1", [verdict("weak-review", "partial")]]]),
    );
    expect(result.requirements[0].sourceReviewIds).toEqual(["weak-review"]);
  });

  it("empties evidence when every candidate is judged none", () => {
    const findings = [finding("finding-1", ["r1"])];
    const req = requirement("req-1", ["finding-1"]);
    // The model explicitly judged the only candidate "none": it must not enter
    // formal evidence, even if that leaves the requirement empty.
    const result = applyRequirementEvidence([req], findings, new Map([["req-1", [verdict("r1", "none")]]]));
    expect(result.requirements[0].sourceReviewIds).toEqual([]);
    expect(result.report.warnings.some((w) => w.code === "REQUIREMENT_EVIDENCE_EMPTY")).toBe(true);
  });

  it("keeps the candidate set when no verdicts are returned at all (model failure)", () => {
    const findings = [finding("finding-1", ["r1"])];
    const req = requirement("req-1", ["finding-1"]);
    const result = applyRequirementEvidence([req], findings, new Map());
    expect(result.requirements[0].sourceReviewIds).toEqual(["r1"]);
    expect(result.report.warnings.some((w) => w.code === "REQUIREMENT_EVIDENCE_MISSING")).toBe(true);
  });

  it("ignores a verdict for a review that is not a candidate (never widens evidence)", () => {
    const findings = [finding("finding-1", ["r1"])];
    const req = requirement("req-1", ["finding-1"]);
    // "ghost" is not a candidate; it must not enter sourceReviewIds even if the
    // model (maliciously or by error) marks it direct.
    const result = applyRequirementEvidence(
      [req],
      findings,
      new Map([["req-1", [verdict("r1", "direct"), verdict("ghost", "direct")]]]),
    );
    expect(result.requirements[0].sourceReviewIds).toEqual(["r1"]);
  });
});
