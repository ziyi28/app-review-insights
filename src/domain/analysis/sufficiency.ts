import type { EvidenceSufficiency } from "@/domain/contracts/analysis";
import type { SourceStatus } from "./confidence";

/**
 * Deterministic v1 policy: a finding can only support a broad or critical
 * claim when it clears the absolute-support floor, a minimum share of the
 * reviewed corpus, a complete data source, and a minor-conflict bar. These
 * named constants are the single tuning point; callers never re-derive the
 * thresholds.
 */
export const MIN_SUPPORT_COUNT = 3;
export const MIN_SUPPORT_RATIO = 0.01;

export function assessEvidenceSufficiency(input: {
  supportCount: number;
  corpusCount: number;
  conflictCount: number;
  sourceStatus: SourceStatus;
}): EvidenceSufficiency {
  const supportRatio = input.corpusCount === 0 ? 0 : input.supportCount / input.corpusCount;
  const reasons: EvidenceSufficiency["reasons"] = [];
  if (input.supportCount < MIN_SUPPORT_COUNT) reasons.push("SUPPORT_BELOW_MINIMUM");
  if (supportRatio < MIN_SUPPORT_RATIO) reasons.push("SUPPORT_RATIO_BELOW_MINIMUM");
  if (input.sourceStatus !== "complete") reasons.push("SOURCE_NOT_COMPLETE");
  if (input.conflictCount >= input.supportCount) reasons.push("CONFLICT_NOT_MINOR");
  return {
    status: reasons.length === 0 ? "sufficient" : "insufficient",
    corpusReviewCount: input.corpusCount,
    supportRatio,
    reasons,
  };
}
