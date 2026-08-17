import type {
  ConfidenceLevel,
  Finding,
  PlanningFactors,
  Priority,
} from "@/domain/contracts/analysis";

/**
 * The subset of planning factors that carry the model's semantic judgment.
 * Evidence strength, confidence and frequency are never taken from the model:
 * they are recomputed deterministically from the linked findings.
 */
export type SemanticPlanningFactors = Pick<
  PlanningFactors,
  "severity" | "userImpact" | "implementationScope" |
  "dependencyRequirementIds" | "rationale"
>;

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

/**
 * Computes evidence strength, confidence and frequency from the linked
 * findings, then merges them with the model's semantic factors.
 *
 * - supporting review count is the size of the union of the findings' evidence;
 * - corpus count is the max corpus across linked findings;
 * - confidence is the most conservative level across all linked findings;
 * - evidence strength is the most conservative confidence across the
 *   *sufficient* findings only, or "insufficient" when none are sufficient.
 */
export function derivePlanningFactors(
  findingIds: string[],
  findings: Finding[],
  semantic: SemanticPlanningFactors,
): PlanningFactors {
  const findingIndex = new Map(findings.map((f) => [f.id, f]));
  const linked = findingIds
    .map((id) => findingIndex.get(id))
    .filter((f): f is Finding => f !== undefined);

  const supportingContentGroupIds = new Set<string>();
  let corpusReviewCount = 0;
  const sufficientConfidences: ConfidenceLevel[] = [];
  const allConfidences: ConfidenceLevel[] = [];

  for (const finding of linked) {
    // Frequency counts distinct content groups, not review ids, so a finding
    // whose support includes re-synced copies of the same body is not inflated.
    // Legacy findings without group ids fall back to their review ids.
    const groupIds =
      finding.supportingContentGroupIds && finding.supportingContentGroupIds.length > 0
        ? finding.supportingContentGroupIds
        : finding.supportingReviewIds;
    for (const gid of groupIds) supportingContentGroupIds.add(gid);
    corpusReviewCount = Math.max(corpusReviewCount, finding.evidenceSufficiency.corpusReviewCount);
    allConfidences.push(finding.confidence.level);
    if (finding.evidenceSufficiency.status === "sufficient") {
      sufficientConfidences.push(finding.confidence.level);
    }
  }

  const supportingReviewCount = supportingContentGroupIds.size;
  const confidence = mostConservative(allConfidences) ?? "low";
  const evidenceStrength = sufficientConfidences.length > 0
    ? mostConservative(sufficientConfidences)!
    : "insufficient";

  return {
    ...semantic,
    evidenceStrength,
    confidence,
    frequency: {
      supportingReviewCount,
      corpusReviewCount,
      supportRatio: corpusReviewCount > 0 ? supportingReviewCount / corpusReviewCount : 0,
    },
  };
}

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * Deterministic guardrail on the model's requested priority. P0 survives only
 * when severity=critical, userImpact=high, evidenceStrength=high and
 * confidence=high all hold; insufficient evidence is always pinned to P2.
 * Returns the requested priority or the more conservative cap, whichever is
 * less urgent.
 */
export function priorityWithinFactorCap(
  requested: Priority,
  factors: PlanningFactors,
): Priority {
  if (factors.evidenceStrength === "insufficient") return "P2";
  let cap: Priority = "P0";
  if (factors.severity !== "critical" || factors.userImpact !== "high") cap = "P1";
  if (factors.evidenceStrength !== "high" || factors.confidence !== "high") {
    if (PRIORITY_RANK[cap] < PRIORITY_RANK.P1) cap = "P1";
  }
  return PRIORITY_RANK[requested] >= PRIORITY_RANK[cap] ? requested : cap;
}

function mostConservative(levels: ConfidenceLevel[]): ConfidenceLevel | undefined {
  if (levels.length === 0) return undefined;
  let min = levels[0];
  for (const level of levels) {
    if (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[min]) min = level;
  }
  return min;
}
