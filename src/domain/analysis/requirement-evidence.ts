import type { EvidenceVerdict, Finding, Requirement } from "@/domain/contracts/analysis";
import { reviewIdsForFindings } from "@/domain/traceability/evidence-sources";

/**
 * Per-requirement audit of the requirement-evidence selection step. `keptCount`
 * is the number of reviews that survived into `sourceReviewIds`; the
 * direct/partial/none counts sum to `candidateCount` (every candidate review
 * receives exactly one verdict, so the audit is exhaustive).
 */
export type RequirementEvidenceReport = {
  items: {
    requirementId: string;
    candidateCount: number;
    directCount: number;
    partialCount: number;
    noneCount: number;
    keptCount: number;
  }[];
  warnings: { code: string; message: string }[];
};

/**
 * The set of reviews a requirement may draw on: the union of every linked
 * finding's supporting reviews. This is the *candidate* set — before semantic
 * filtering — and is what the planning stage inherited wholesale (the root of
 * the evidence-mismatch bug).
 */
export function candidateReviewIdsFor(requirement: Requirement, findings: Finding[]): string[] {
  return [...new Set(reviewIdsForFindings(requirement.findingIds, findings))];
}

/**
 * Applies per-(requirement, review) semantic verdicts produced by the model and
 * narrows each requirement's `sourceReviewIds` to reviews that directly support
 * it. Deterministic and pure: it only ever keeps or drops candidates the
 * requirement already inherits from its findings — never invents a review.
 *
 * Keeping policy:
 * - "direct" reviews enter `sourceReviewIds` as formal support.
 * - If a requirement has no "direct" review, "partial" reviews are used instead
 *   (a weak-but-real link beats an empty evidence set).
 * - Only when the model returned no direct AND no partial verdict (all "none",
 *   or no verdicts at all) is the full candidate set retained, with a warning,
 *   so a requirement is never silently stripped of all evidence.
 * - "none" verdicts are recorded in `evidenceVerdicts` for the audit but are
 *   never cited as formal support while any direct/partial review exists.
 */
export function applyRequirementEvidence(
  requirements: Requirement[],
  findings: Finding[],
  verdictsByRequirement: Map<string, EvidenceVerdict[]>,
): { requirements: Requirement[]; report: RequirementEvidenceReport } {
  const warnings: RequirementEvidenceReport["warnings"] = [];
  const items: RequirementEvidenceReport["items"] = [];
  const next: Requirement[] = [];

  for (const req of requirements) {
    const candidates = candidateReviewIdsFor(req, findings);
    const verdictByReview = new Map<string, EvidenceVerdict>();
    for (const v of verdictsByRequirement.get(req.id) ?? []) {
      // Ignore verdicts for reviews that are not actually candidates (the model
      // is never trusted to widen a requirement's evidence).
      if (candidates.includes(v.reviewId) && !verdictByReview.has(v.reviewId)) {
        verdictByReview.set(v.reviewId, v);
      }
    }

    // One verdict per candidate; a candidate the model skipped is recorded as an
    // unverified "none" so the audit stays exhaustive.
    const evidenceVerdicts: EvidenceVerdict[] = candidates.map((id) =>
      verdictByReview.get(id) ?? { reviewId: id, relation: "none", confidence: 0, reason: "Model returned no verdict for this candidate review" },
    );
    const directIds = evidenceVerdicts.filter((v) => v.relation === "direct").map((v) => v.reviewId);
    const partialIds = evidenceVerdicts.filter((v) => v.relation === "partial").map((v) => v.reviewId);

    let kept: string[];
    if (directIds.length > 0) {
      kept = directIds;
    } else if (partialIds.length > 0) {
      kept = partialIds;
    } else if (verdictByReview.size > 0) {
      // The model explicitly judged every candidate "none": honor it — the
      // requirement has no direct support and is emptied rather than re-inflated.
      kept = [];
      warnings.push({
        code: "REQUIREMENT_EVIDENCE_EMPTY",
        message: `${req.id} had no direct/partial support among ${candidates.length} candidate review(s); sourceReviewIds emptied`,
      });
    } else {
      // No verdicts at all (a failed/empty model call): keep the candidate set
      // rather than strip the requirement silently.
      kept = candidates;
      warnings.push({
        code: "REQUIREMENT_EVIDENCE_MISSING",
        message: `${req.id} had no verdicts; kept ${candidates.length} candidate review(s)`,
      });
    }

    next.push({ ...req, sourceReviewIds: kept, evidenceVerdicts });
    items.push({
      requirementId: req.id,
      candidateCount: candidates.length,
      directCount: directIds.length,
      partialCount: partialIds.length,
      noneCount: evidenceVerdicts.length - directIds.length - partialIds.length,
      keptCount: kept.length,
    });
  }

  return { requirements: next, report: { items, warnings } };
}
