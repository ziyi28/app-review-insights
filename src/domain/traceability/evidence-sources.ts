import type { Priority, Requirement } from "@/domain/contracts/analysis";

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

/**
 * Derives a test's direct Finding links from its requirements. The union is
 * built in requirement input order, and within each requirement in the finding
 * order the requirement declared, then deduped — so the output is stable for
 * any input order the caller passes.
 */
export function findingIdsForRequirements(
  requirementIds: string[],
  requirements: Requirement[],
): string[] {
  const ids = new Set<string>();
  const result: string[] = [];
  for (const id of requirementIds) {
    const req = requirements.find((r) => r.id === id);
    if (!req) continue;
    for (const fid of req.findingIds) {
      if (!ids.has(fid)) {
        ids.add(fid);
        result.push(fid);
      }
    }
  }
  return result;
}

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * Derives a test's priority from its requirements: the most urgent of the
 * linked requirements' priorities. Returns null when no requirement resolves
 * (callers then fall back to "P2").
 */
export function priorityForRequirements(
  requirementIds: string[],
  requirements: Requirement[],
): Priority | null {
  let mostUrgent: Priority | null = null;
  for (const id of requirementIds) {
    const req = requirements.find((r) => r.id === id);
    if (!req) continue;
    if (mostUrgent === null || PRIORITY_RANK[req.priority] < PRIORITY_RANK[mostUrgent]) {
      mostUrgent = req.priority;
    }
  }
  return mostUrgent;
}
