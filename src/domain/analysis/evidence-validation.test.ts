import { describe, it, expect } from "vitest";
import type { Finding } from "@/domain/contracts/analysis";
import type { FindingsStageResult } from "@/server/pipeline/stages/findings";
import { buildEvidenceValidationReport } from "./evidence-validation";

const SUFFICIENT: Finding = {
  id: "finding-1",
  topicIds: ["topic-1"],
  title: "Pricing complaints",
  summary: "Users dislike the subscription cost",
  supportingReviewIds: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"],
  supportingSampleCount: 8,
  evidenceExcerpts: [{ reviewId: "r1", excerpt: "too expensive" }],
  conflictingReviewIds: ["r9"],
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

const INSUFFICIENT: Finding = {
  ...SUFFICIENT,
  id: "finding-2",
  supportingReviewIds: ["r10", "r11"],
  supportingSampleCount: 2,
  conflictingReviewIds: [],
  confidence: { level: "low", method: "deterministic-v1", reasons: [] },
  evidenceSufficiency: {
    status: "insufficient",
    corpusReviewCount: 100,
    supportRatio: 0.02,
    reasons: ["SUPPORT_BELOW_MINIMUM"],
  },
};

const result: FindingsStageResult = {
  findings: [SUFFICIENT, INSUFFICIENT],
  warnings: [
    { code: "UNSUPPORTED_FINDING", message: "dropped finding-3 (no valid supporting reviews)" },
    { code: "OTHER_WARNING", message: "not part of the report" },
  ],
  insufficientEvidence: false,
};

describe("buildEvidenceValidationReport", () => {
  it("counts valid, rejected, sufficient and insufficient findings", () => {
    const report = buildEvidenceValidationReport(result);
    expect(report.validFindingCount).toBe(2);
    expect(report.rejectedFindingCount).toBe(1);
    expect(report.sufficientCount).toBe(1);
    expect(report.insufficientCount).toBe(1);
  });

  it("exposes deterministic per-finding fields", () => {
    const report = buildEvidenceValidationReport(result);
    const byId = new Map(report.findings.map((f) => [f.findingId, f]));
    const sufficient = byId.get("finding-1")!;
    expect(sufficient).toMatchObject({
      supportCount: 8,
      corpusCount: 100,
      supportRatio: 0.08,
      conflictCount: 1,
      confidence: "high",
      sufficiency: "sufficient",
    });
    expect(sufficient.reasons).toEqual([]);
    const insufficient = byId.get("finding-2")!;
    expect(insufficient).toMatchObject({
      supportCount: 2,
      corpusCount: 100,
      supportRatio: 0.02,
      conflictCount: 0,
      confidence: "low",
      sufficiency: "insufficient",
    });
    expect(insufficient.reasons).toEqual(["SUPPORT_BELOW_MINIMUM"]);
  });

  it("lists rejected findings from UNSUPPORTED_FINDING warnings only", () => {
    const report = buildEvidenceValidationReport(result);
    expect(report.rejected).toEqual([
      { code: "UNSUPPORTED_FINDING", message: "dropped finding-3 (no valid supporting reviews)" },
    ]);
  });
});
