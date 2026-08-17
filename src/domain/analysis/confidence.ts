import type { Confidence, ConfidenceLevel } from "@/domain/contracts/analysis";

export type SourceStatus = "complete" | "partial" | "suspect-empty" | "failed";

/**
 * Material conflict threshold ratio:
 * When conflicting reviews reach or exceed 25% of the supporting count,
 * confidence is capped at medium. Weak conflicting noise (<25%) does not penalize
 * high-frequency findings.
 */
export const MIN_MATERIAL_CONFLICT_RATIO = 0.25;

/**
 * A high support count over a tiny fraction of the corpus is a narrow claim,
 * not a confident one. Below this share of the corpus, confidence is capped at
 * medium. (Distinct from the sufficiency floor MIN_SUPPORT_RATIO = 0.01: that
 * gates "can this support a broad/critical claim", this gates the level label.)
 */
export const MIN_CONFIDENCE_SUPPORT_RATIO = 0.01;

/** Short supporting reviews carry little signal; below this mean length the
 *  level is capped at medium. Calibrated to weed out one-word/one-sentence
 *  spam while leaving normal reviews untouched. */
export const MIN_CONFIDENCE_MEAN_BODY_LENGTH = 20;

/** All supporting reviews sharing one rating is a homogeneity signal, not a
 *  distribution. A mean rating variance below this keeps the level at medium. */
export const MIN_CONFIDENCE_RATING_VARIANCE = 0.05;

/**
 * Audit-friendly confidence heuristic, not a statistical interval. Level is
 * driven by the count of distinct content groups (v2), downgraded by an
 * incomplete source, material conflict, a support ratio that is negligible
 * relative to the corpus, uniformly short bodies, or a homogeneous rating. Every
 * downgrade is recorded in `reasons` so the label is auditable.
 */
export function computeConfidence(input: {
  supportCount: number;
  supportRatio: number;
  sourceStatus: SourceStatus;
  conflictCount: number;
  meanBodyLength: number;
  ratingVariance: number;
}): Confidence {
  let level: ConfidenceLevel;
  if (input.supportCount >= 8) level = "high";
  else if (input.supportCount >= 3) level = "medium";
  else level = "low";

  if (input.sourceStatus === "partial" || input.sourceStatus === "suspect-empty") {
    level = level === "high" ? "medium" : "low";
  }

  const materialConflict =
    input.conflictCount >= Math.ceil(input.supportCount * MIN_MATERIAL_CONFLICT_RATIO);

  if (materialConflict && level === "high") level = "medium";

  const narrowCoverage = input.supportRatio > 0 && input.supportRatio < MIN_CONFIDENCE_SUPPORT_RATIO;
  if (narrowCoverage && level === "high") level = "medium";

  const shortBodies = input.meanBodyLength < MIN_CONFIDENCE_MEAN_BODY_LENGTH;
  if (shortBodies && level === "high") level = "medium";

  const homogeneousRatings = input.ratingVariance < MIN_CONFIDENCE_RATING_VARIANCE;
  if (homogeneousRatings && level === "high") level = "medium";

  const reasons: string[] = [
    `${input.supportCount} distinct supporting content group(s)`,
    `source status: ${input.sourceStatus}`,
  ];
  if (materialConflict) reasons.push("material conflicting evidence present");
  if (narrowCoverage) reasons.push("support covers a negligible share of the corpus");
  if (shortBodies) reasons.push("supporting reviews are uniformly short");
  if (homogeneousRatings) reasons.push("supporting reviews share a homogeneous rating");

  return { level, method: "deterministic-v2", reasons };
}

