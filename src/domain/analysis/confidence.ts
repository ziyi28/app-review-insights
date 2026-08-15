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
 * Audit-friendly confidence heuristic, not a statistical interval:
 *   1-2 distinct supporting reviews -> low, 3-7 -> medium, >=8 -> high.
 * A partial source downgrades one step; a material conflict caps at medium.
 */
export function computeConfidence(input: {
  supportCount: number;
  sourceStatus: SourceStatus;
  conflictCount: number;
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

  const reasons: string[] = [
    `${input.supportCount} distinct supporting review(s)`,
    `source status: ${input.sourceStatus}`,
  ];
  if (materialConflict) reasons.push("material conflicting evidence present");

  return { level, method: "deterministic-v1", reasons };
}

