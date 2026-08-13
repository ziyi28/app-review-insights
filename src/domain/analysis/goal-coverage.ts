import type { FocusArea, GoalCoverageReport } from "@/domain/contracts/analysis";
import type { Finding } from "@/domain/contracts/analysis";

export type CoverageStatus = "covered" | "unsupported" | "uncovered";

/**
 * Computes the deterministic goal-coverage report for a planning result.
 *
 * For each focus area:
 * - `covered`: the area has at least one finding with sufficient evidence AND
 *   at least one requirement references one of those findings.
 * - `unsupported`: the area has NO finding with sufficient evidence — there is
 *   nothing to plan, so a missing requirement is legitimate.
 * - `uncovered`: the area has a sufficient finding but NO requirement
 *   references it — a genuine coverage gap the plan must close (or be limited
 *   for).
 *
 * `valid` is true only when no area is `uncovered`. The report is a pure
 * function of the plan; it never calls the model.
 */
export function computeGoalCoverage(
  focusAreas: FocusArea[],
  findings: Finding[],
  requirements: { id: string; findingIds: string[] }[],
  retried = false,
): GoalCoverageReport {
  const sufficientById = new Map<string, Finding>();
  for (const f of findings) {
    if (f.evidenceSufficiency.status === "sufficient") sufficientById.set(f.id, f);
  }

  // finding -> requirements that reference it
  const requirementsByFinding = new Map<string, string[]>();
  for (const r of requirements) {
    for (const fid of r.findingIds) {
      const list = requirementsByFinding.get(fid) ?? [];
      list.push(r.id);
      requirementsByFinding.set(fid, list);
    }
  }

  const items = focusAreas.map((area) => {
    // Findings mapped to this area that are sufficient.
    const sufficient = findings.filter(
      (f) => f.evidenceSufficiency.status === "sufficient" && f.focusAreaIds.includes(area.id),
    );
    const findingIds = sufficient.map((f) => f.id);
    if (findingIds.length === 0) {
      return { focusAreaId: area.id, label: area.label, status: "unsupported" as CoverageStatus, findingIds: [], requirementIds: [] };
    }
    // Requirements referencing any of those sufficient findings.
    const requirementIds = [...new Set(findingIds.flatMap((fid) => requirementsByFinding.get(fid) ?? []))];
    return {
      focusAreaId: area.id,
      label: area.label,
      status: (requirementIds.length > 0 ? "covered" : "uncovered") as CoverageStatus,
      findingIds,
      requirementIds,
    };
  });

  return {
    valid: items.every((i) => i.status !== "uncovered"),
    retried,
    items,
  };
}

/** Ids of the focus areas that have sufficient evidence but no requirement. */
export function uncoveredFocusAreaIds(report: GoalCoverageReport): string[] {
  return report.items.filter((i) => i.status === "uncovered").map((i) => i.focusAreaId);
}

/**
 * True when adopting a repair plan is monotonic w.r.t. goal coverage: the
 * repair must not lose any currently-covered area and must close at least one
 * uncovered area. Non-monotonic repairs are rejected so a retry can never make
 * coverage worse than the first attempt.
 */
export function repairIsMonotonic(before: GoalCoverageReport, after: GoalCoverageReport): boolean {
  const status = (report: GoalCoverageReport, id: string): CoverageStatus =>
    report.items.find((i) => i.focusAreaId === id)?.status ?? "unsupported";
  const coveredBefore = new Set(before.items.filter((i) => i.status === "covered").map((i) => i.focusAreaId));
  for (const id of coveredBefore) {
    if (status(after, id) !== "covered") return false;
  }
  const uncoveredBefore = new Set(before.items.filter((i) => i.status === "uncovered").map((i) => i.focusAreaId));
  const uncoveredAfter = after.items.filter((i) => i.status === "uncovered").map((i) => i.focusAreaId);
  for (const id of uncoveredBefore) {
    if (!uncoveredAfter.includes(id)) return true; // closed at least one gap
  }
  return false;
}
