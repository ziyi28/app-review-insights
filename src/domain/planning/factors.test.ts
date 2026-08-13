import { describe, it, expect } from "vitest";
import type { Finding, PlanningFactors } from "@/domain/contracts/analysis";
import { derivePlanningFactors, priorityWithinFactorCap } from "./factors";

const SUFFICIENT_FINDING: Finding = {
  id: "finding-1",
  topicIds: ["topic-1"],
  focusAreaIds: [],
  sourceFindingIds: [],
  title: "Pricing complaints",
  summary: "Users dislike the subscription cost",
  supportingReviewIds: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"],
  supportingSampleCount: 8,
  evidenceExcerpts: [{ reviewId: "r1", excerpt: "too expensive" }],
  conflictingReviewIds: [],
  confidence: { level: "high", method: "deterministic-v1", reasons: [] },
  evidenceSufficiency: {
    status: "sufficient",
    corpusReviewCount: 100,
    supportRatio: 0.08,
    reasons: [],
  },
  uncertainties: [],
  limitations: [],
};

const INSUFFICIENT_FINDING: Finding = {
  ...SUFFICIENT_FINDING,
  id: "finding-2",
  supportingReviewIds: ["r9", "r10"],
  supportingSampleCount: 2,
  confidence: { level: "low", method: "deterministic-v1", reasons: [] },
  evidenceSufficiency: {
    status: "insufficient",
    corpusReviewCount: 100,
    supportRatio: 0.02,
    reasons: ["SUPPORT_BELOW_MINIMUM"],
  },
};

const semantic = {
  severity: "high" as const,
  userImpact: "high" as const,
  implementationScope: "medium" as const,
  dependencyRequirementIds: [] as string[],
  rationale: "Supported user impact and bounded implementation scope",
};

const strongFactors: PlanningFactors = {
  severity: "critical",
  evidenceStrength: "high",
  confidence: "high",
  userImpact: "high",
  frequency: { supportingReviewCount: 40, corpusReviewCount: 100, supportRatio: 0.4 },
  implementationScope: "medium",
  dependencyRequirementIds: [],
  rationale: "Critical, high-impact, high-confidence evidence",
};

const insufficientFactors: PlanningFactors = {
  ...strongFactors,
  evidenceStrength: "insufficient",
  confidence: "low",
  frequency: { supportingReviewCount: 2, corpusReviewCount: 100, supportRatio: 0.02 },
};

describe("derivePlanningFactors", () => {
  it("derives evidence, confidence and frequency from linked findings", () => {
    const factors = derivePlanningFactors(["finding-1", "finding-2"], [SUFFICIENT_FINDING, INSUFFICIENT_FINDING], semantic);
    // supporting review ids are union-deduplicated.
    expect(factors.frequency).toEqual({
      supportingReviewCount: 10,
      corpusReviewCount: 100,
      supportRatio: 0.1,
    });
    // most conservative confidence across linked findings.
    expect(factors.confidence).toBe("low");
    // evidence strength derives from the most conservative confidence of
    // *sufficient* findings only; finding-1 is the only sufficient one and it
    // is high-confidence, so evidence strength is high, not insufficient.
    expect(factors.evidenceStrength).toBe("high");
  });

  it("is insufficient when no linked finding is sufficient", () => {
    const factors = derivePlanningFactors(["finding-2"], [INSUFFICIENT_FINDING], semantic);
    expect(factors.evidenceStrength).toBe("insufficient");
    expect(factors.confidence).toBe("low");
    expect(factors.frequency.supportRatio).toBe(0.02);
  });
});

describe("priorityWithinFactorCap", () => {
  it("caps an unjustified P0 at P1", () => {
    expect(priorityWithinFactorCap("P0", {
      ...strongFactors,
      severity: "high",
    })).toBe("P1");
  });

  it("keeps P0 only for critical high-impact high-confidence evidence", () => {
    expect(priorityWithinFactorCap("P0", strongFactors)).toBe("P0");
  });

  it("keeps insufficient evidence at P2", () => {
    expect(priorityWithinFactorCap("P0", insufficientFactors)).toBe("P2");
  });

  it("never raises a requested lower priority", () => {
    expect(priorityWithinFactorCap("P2", strongFactors)).toBe("P2");
    expect(priorityWithinFactorCap("P1", strongFactors)).toBe("P1");
  });
});
