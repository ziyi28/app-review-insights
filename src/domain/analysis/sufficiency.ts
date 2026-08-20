import type { Assumption, EvidenceSufficiency, Finding } from "@/domain/contracts/analysis";
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

/**
 * Creates a deterministic assumption entity for an insufficient finding so that
 * the claim is preserved for verification without entering formal requirements.
 */
export function createAssumptionFromInsufficientFinding(finding: Finding): Assumption {
  const reasonText = finding.evidenceSufficiency.reasons.length > 0
    ? finding.evidenceSufficiency.reasons.join(", ")
    : "INSUFFICIENT_EVIDENCE";
  const uncertaintiesText = finding.uncertainties.length > 0
    ? ` Uncertainties: ${finding.uncertainties.join("; ")}.`
    : "";
  const basis = `Evidence insufficient for broad claim (${reasonText}). Supporting: ${finding.supportingReviewIds.length}, Conflicting: ${finding.conflictingReviewIds.length}.${uncertaintiesText}`.slice(0, 2000);
  const text = (finding.summary || finding.title).slice(0, 2000);
  const sourceReviewIds = [...new Set([...finding.supportingReviewIds, ...finding.conflictingReviewIds])];

  return {
    id: `asm-insufficient-${finding.id}`,
    text,
    basis,
    origin: "insufficient-finding",
    sourceFindingIds: [finding.id],
    sourceReviewIds,
  };
}

