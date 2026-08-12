import type { Confidence, ConfidenceLevel } from "@/domain/contracts/analysis";

export type SourceStatus = "complete" | "partial" | "suspect-empty" | "failed";

/**
 * Audit-friendly confidence heuristic, not a statistical interval:
 *   1-2 distinct supporting reviews -> low, 3-7 -> medium, >=8 -> high.
 * A partial source downgrades one step; a material conflict caps at medium.
 */
export function computeConfidence(input: {
  supportCount: number;
  sourceStatus: SourceStatus;
  hasConflict: boolean;
}): Confidence {
  let level: ConfidenceLevel;
  if (input.supportCount >= 8) level = "high";
  else if (input.supportCount >= 3) level = "medium";
  else level = "low";

  if (input.sourceStatus === "partial" || input.sourceStatus === "suspect-empty") {
    level = level === "high" ? "medium" : "low";
  }
  if (input.hasConflict && level === "high") level = "medium";

  const reasons: string[] = [
    `${input.supportCount} distinct supporting review(s)`,
    `source status: ${input.sourceStatus}`,
  ];
  if (input.hasConflict) reasons.push("material conflicting evidence present");

  return { level, method: "deterministic-v1", reasons };
}
