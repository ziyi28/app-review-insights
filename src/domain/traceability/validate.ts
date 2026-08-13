import type { Prd, Requirement } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import { findingIdsForRequirements, priorityForRequirements, reviewIdsForFindings } from "./evidence-sources";

export type Violation = {
  code: string;
  message: string;
  entity?: string;
};

export type TraceabilityReport = {
  valid: boolean;
  violations: Violation[];
};

/**
 * Detects requirement ids that participate in a dependency cycle via iterative
 * DFS. Self-links are excluded (the planner already removes them), so any cycle
 * member here means two or more requirements depend on each other.
 */
function requirementsInDependencyCycles(requirements: Requirement[]): Set<string> {
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string) => {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      for (const cycleId of stack.slice(cycleStart)) cyclic.add(cycleId);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependencyId of byId.get(id)?.planningFactors?.dependencyRequirementIds ?? []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of byId.keys()) visit(id);
  return cyclic;
}

/**
 * Deterministic validation of the full review -> finding -> requirement ->
 * test traceability chain. Never invents evidence; unsupported references are
 * reported as violations.
 */
export function validateTraceability(
  prd: Prd,
  corpusReviewIds: string[],
  reviewMap?: Map<string, NormalizedReview>,
): TraceabilityReport {
  const violations: Violation[] = [];
  const corpus = new Set(corpusReviewIds);
  const findingIds = new Set(prd.findings.map((f) => f.id));
  const reqIds = new Set(prd.requirements.map((r) => r.id));
  const versionIds = new Set(prd.versions.map((v) => v.id));

  // Dependency ordering: a requirement may only depend on requirements that
  // are scheduled in the same or an earlier version, never in a later one.
  const versionOrder = new Map<string, number>();
  prd.versions.forEach((v, i) => versionOrder.set(v.id, i));

  // IDs must be unique and correctly prefixed (id convention keeps assumptions
  // out of requirements/tests).
  const allIds = [
    ...prd.findings.map((f) => f.id),
    ...prd.requirements.map((r) => r.id),
    ...prd.tests.map((t) => t.id),
    ...prd.assumptions.map((a) => a.id),
  ];
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) violations.push({ code: "DUPLICATE_ID", message: `duplicate id ${id}`, entity: id });
    seen.add(id);
  }

  // Findings: reviews exist, sample count correct, every supporting review has
  // at least one exact excerpt.
  for (const f of prd.findings) {
    if (f.supportingReviewIds.length === 0) {
      violations.push({ code: "FINDING_NO_SUPPORT", message: `${f.id} has no supporting reviews`, entity: f.id });
    }
    for (const id of f.supportingReviewIds) {
      if (!corpus.has(id)) {
        violations.push({ code: "REVIEW_NOT_FOUND", message: `${f.id} cites unknown review ${id}`, entity: f.id });
      }
    }
    if (f.supportingSampleCount !== new Set(f.supportingReviewIds).size) {
      violations.push({ code: "SAMPLE_COUNT_MISMATCH", message: `${f.id} sample count mismatch`, entity: f.id });
    }
    const excerpted = new Set(f.evidenceExcerpts.map((e) => e.reviewId));
    for (const id of f.supportingReviewIds) {
      if (!excerpted.has(id)) {
        violations.push({ code: "FINDING_MISSING_EXCERPT", message: `${f.id} supporting review ${id} has no exact excerpt`, entity: f.id });
      }
    }
    for (const e of f.evidenceExcerpts) {
      if (!corpus.has(e.reviewId)) {
        violations.push({ code: "REVIEW_NOT_FOUND", message: `${f.id} excerpt cites unknown review ${e.reviewId}`, entity: f.id });
        continue;
      }
      const review = reviewMap?.get(e.reviewId);
      if (review && !isExactExcerpt(e.excerpt, review.bodyNormalized)) {
        violations.push({ code: "EXCERPT_NOT_EXACT", message: `${f.id} excerpt not exact`, entity: f.id });
      }
    }
  }

  // Requirements: link to findings, reviews derive from findings evidence.
  const requirementChecks = (req: Requirement) => {
    if (req.findingIds.length === 0) {
      violations.push({ code: "REQUIREMENT_NO_FINDING", message: `${req.id} has no finding link`, entity: req.id });
    }
    for (const fid of req.findingIds) {
      if (!findingIds.has(fid)) {
        violations.push({ code: "REQUIREMENT_UNKNOWN_FINDING", message: `${req.id} links unknown finding ${fid}`, entity: req.id });
      }
    }
    const expected = new Set(reviewIdsForFindings(req.findingIds, prd.findings));
    const actual = new Set(req.sourceReviewIds);
    if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) {
      violations.push({ code: "REQUIREMENT_EVIDENCE_MISMATCH", message: `${req.id} sourceReviewIds must equal findings evidence`, entity: req.id });
    }
    for (const id of req.sourceReviewIds) {
      if (!corpus.has(id)) violations.push({ code: "REVIEW_NOT_FOUND", message: `${req.id} cites unknown review ${id}`, entity: req.id });
    }
    if (req.versionId && !versionIds.has(req.versionId)) {
      violations.push({ code: "REQUIREMENT_UNKNOWN_VERSION", message: `${req.id} links unknown version ${req.versionId}`, entity: req.id });
    }
  };
  prd.requirements.forEach(requirementChecks);

  // Dependencies: no cycles, no unscheduled targets, and a dependency must
  // never be scheduled later than the requirement that depends on it.
  const cyclicRequirementIds = requirementsInDependencyCycles(prd.requirements);
  for (const requirement of prd.requirements) {
    if (cyclicRequirementIds.has(requirement.id)) {
      violations.push({
        code: "REQUIREMENT_DEPENDENCY_CYCLE",
        message: `${requirement.id} is part of a dependency cycle`,
        entity: requirement.id,
      });
    }
    for (const dependencyId of requirement.planningFactors?.dependencyRequirementIds ?? []) {
      const dependency = prd.requirements.find((candidate) => candidate.id === dependencyId);
      if (!dependency) continue; // unknown/self links were removed by normalizer
      if (requirement.versionId && !dependency.versionId) {
        violations.push({
          code: "REQUIREMENT_DEPENDENCY_UNSCHEDULED",
          message: `${requirement.id} depends on unscheduled ${dependencyId}`,
          entity: requirement.id,
        });
      } else if (requirement.versionId && dependency.versionId &&
        versionOrder.get(dependency.versionId)! > versionOrder.get(requirement.versionId)!) {
        violations.push({
          code: "REQUIREMENT_DEPENDENCY_LATE",
          message: `${requirement.id} depends on later ${dependencyId}`,
          entity: requirement.id,
        });
      }
    }
  }

  // Versions reference existing requirements.
  for (const v of prd.versions) {
    for (const id of v.requirementIds) {
      if (!reqIds.has(id)) {
        violations.push({ code: "VERSION_UNKNOWN_REQUIREMENT", message: `${v.id} links unknown requirement ${id}`, entity: v.id });
      }
    }
  }

  // Tests: link requirements, reviews inside the union of the cited
  // requirements' evidence, coverage.
  const covered = new Set<string>();
  for (const t of prd.tests) {
    if (t.requirementIds.length === 0) {
      violations.push({ code: "TEST_NO_REQUIREMENT", message: `${t.id} has no requirement link`, entity: t.id });
    }
    for (const rid of t.requirementIds) {
      if (!reqIds.has(rid)) {
        violations.push({ code: "TEST_UNKNOWN_REQUIREMENT", message: `${t.id} links unknown requirement ${rid}`, entity: t.id });
      } else {
        covered.add(rid);
      }
    }
    // The allowed review set is the union of every cited requirement's
    // evidence (not just requirementIds[0]), so a test spanning several
    // requirements cannot smuggle in a review that only one of them backs.
    const allowed = new Set<string>();
    for (const rid of t.requirementIds) {
      const req = prd.requirements.find((r) => r.id === rid);
      if (req) for (const id of req.sourceReviewIds) allowed.add(id);
    }
    for (const id of t.sourceReviewIds) {
      if (!allowed.has(id)) {
        violations.push({ code: "TEST_REVIEW_OUTSIDE_EVIDENCE", message: `${t.id} cites review ${id} outside requirement evidence`, entity: t.id });
      }
      if (!corpus.has(id)) {
        violations.push({ code: "REVIEW_NOT_FOUND", message: `${t.id} cites unknown review ${id}`, entity: t.id });
      }
    }
    // Direct Finding links and priority are deterministic code fields derived
    // from the requirement graph. A test carrying different values means the
    // ledger was tampered with — never silently accepted.
    const expectedFindingIds = new Set(findingIdsForRequirements(t.requirementIds, prd.requirements));
    const actualFindingIds = new Set(t.findingIds);
    if (
      expectedFindingIds.size !== actualFindingIds.size ||
      [...expectedFindingIds].some((id) => !actualFindingIds.has(id))
    ) {
      violations.push({ code: "TEST_FINDING_MISMATCH", message: `${t.id} findingIds must equal its requirements' findings`, entity: t.id });
    }
    const expectedPriority = priorityForRequirements(t.requirementIds, prd.requirements);
    if (expectedPriority && t.priority !== expectedPriority) {
      violations.push({ code: "TEST_PRIORITY_MISMATCH", message: `${t.id} priority must be the most urgent of its requirements`, entity: t.id });
    }
  }
  for (const r of prd.requirements) {
    if (!covered.has(r.id)) {
      violations.push({ code: "REQUIREMENT_UNCOVERED", message: `${r.id} has no test coverage`, entity: r.id });
    }
  }

  return { valid: violations.length === 0, violations };
}
