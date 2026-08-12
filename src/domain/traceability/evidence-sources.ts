/**
 * The single source of truth for deriving a requirement's evidence from its
 * findings' supporting reviews. Used by the planning stage (to populate a
 * requirement's sourceReviewIds), by the traceability validator (to check the
 * requirement matches), and by the tests stage (to bound which reviews a test
 * may cite). Keeping one helper prevents the two sides from drifting apart and
 * triggering spurious REQUIREMENT_EVIDENCE_MISMATCH failures.
 */
export function reviewIdsForFindings(
  findingIds: string[],
  findings: { id: string; supportingReviewIds: string[] }[],
): string[] {
  const ids = new Set<string>();
  for (const f of findings) {
    if (findingIds.includes(f.id)) {
      for (const id of f.supportingReviewIds) ids.add(id);
    }
  }
  return [...ids];
}
