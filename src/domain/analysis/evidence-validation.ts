import type { Finding } from "@/domain/contracts/analysis";
import type { FindingsStageResult } from "@/server/pipeline/stages/findings";

export type EvidenceValidationReport = {
  validFindingCount: number;
  rejectedFindingCount: number;
  sufficientCount: number;
  insufficientCount: number;
  findings: {
    findingId: string;
    supportCount: number;
    corpusCount: number;
    supportRatio: number;
    conflictCount: number;
    confidence: "low" | "medium" | "high";
    sufficiency: "sufficient" | "insufficient";
    reasons: string[];
  }[];
  rejected: { code: string; message: string }[];
};

/**
 * Builds a deterministic evidence-validation report from an already-normalized
 * findings stage result. Reads only the surviving findings and their warnings;
 * never calls the model and never re-derives the sufficiency threshold.
 * Only UNSUPPORTED_FINDING warnings count as rejected findings — other stage
 * warnings stay in the event stream and are not part of this report.
 */
export function buildEvidenceValidationReport(result: FindingsStageResult): EvidenceValidationReport {
  const findings: EvidenceValidationReport["findings"] = result.findings.map((f: Finding) => ({
    findingId: f.id,
    supportCount: f.supportingReviewIds.length,
    corpusCount: f.evidenceSufficiency.corpusReviewCount,
    supportRatio: f.evidenceSufficiency.supportRatio,
    conflictCount: new Set(f.conflictingReviewIds).size,
    confidence: f.confidence.level,
    sufficiency: f.evidenceSufficiency.status,
    reasons: f.evidenceSufficiency.reasons,
  }));

  return {
    validFindingCount: result.findings.length,
    rejectedFindingCount: result.warnings.filter((w) => w.code === "UNSUPPORTED_FINDING").length,
    sufficientCount: findings.filter((f) => f.sufficiency === "sufficient").length,
    insufficientCount: findings.filter((f) => f.sufficiency === "insufficient").length,
    findings,
    rejected: result.warnings.filter((w) => w.code === "UNSUPPORTED_FINDING"),
  };
}
