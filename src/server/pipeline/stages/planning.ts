import type { Assumption, Finding, Prd, Requirement, VersionPlanArtifact } from "@/domain/contracts/analysis";
import { planningPrompt, PlanningOutputSchema, type PlanningOutput } from "@/server/model/prompts/prompts";
import { derivePlanningFactors, priorityWithinFactorCap } from "@/domain/planning/factors";
import { modelProgressRelay, type StageModelClient } from "../dependencies";
import { reviewIdsForFindings } from "@/domain/traceability/evidence-sources";

export type PlanningStageContext = {
  model: StageModelClient;
  findings: Finding[];
  outputLocale: "en" | "zh-CN";
  goal: string;
  /** Live progress callback; invoked with a human-readable message while the
   *  model call is in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
};

export type PlanningStageResult = {
  prd: Prd;
  versionPlan: VersionPlanArtifact;
  warnings: { code: string; message: string }[];
};

/**
 * Normalizes a planning model output into a protocol-valid PRD plus a
 * version-plan artifact. Only requirements that reference an existing finding
 * survive. Each surviving requirement gets its seven planning factors: the
 * semantic ones (severity, user impact, scope, dependencies, rationale) come
 * from the model; evidence strength, confidence and frequency are recomputed
 * deterministically from the linked findings. Priority is then capped and
 * dependencies/versions pruned to valid ones.
 */
export function normalizePlanningOutput(
  output: PlanningOutput,
  findings: Finding[],
  outputLocale: "en" | "zh-CN",
): PlanningStageResult {
  const warnings: { code: string; message: string }[] = [];
  const findingIndex = new Map(findings.map((f) => [f.id, f]));

  // First pass: collect the requirement ids that have valid finding links so
  // dependencies can only ever point at surviving requirements.
  const supportedRequirementIds = new Set<string>();
  for (const req of output.requirements) {
    if (req.findingIds.some((id) => findingIndex.has(id))) {
      supportedRequirementIds.add(req.id);
    }
  }

  const requirements: Requirement[] = [];
  const versionIndex = new Set(output.versions.map((v) => v.id));

  for (const req of output.requirements) {
    const validFindingIds = req.findingIds.filter((id) => findingIndex.has(id));
    if (validFindingIds.length === 0) {
      warnings.push({ code: "UNSUPPORTED_REQUIREMENT", message: `dropped ${req.id} (no valid finding links)` });
      continue;
    }
    // Dependencies may only reference surviving requirements and never
    // themselves; anything else is dropped and surfaced as a warning.
    const dependencyRequirementIds = [...new Set(
      (req.planningFactors?.dependencyRequirementIds ?? []).filter(
        (id) => supportedRequirementIds.has(id) && id !== req.id,
      ),
    )];
    if (req.planningFactors && dependencyRequirementIds.length !== new Set(req.planningFactors.dependencyRequirementIds).size) {
      warnings.push({ code: "PLANNING_DEPENDENCY_DROPPED", message: `${req.id} had unknown or self dependencies removed` });
    }
    const planningFactors = derivePlanningFactors(validFindingIds, findings, {
      severity: req.planningFactors?.severity ?? "medium",
      userImpact: req.planningFactors?.userImpact ?? "medium",
      implementationScope: req.planningFactors?.implementationScope ?? "medium",
      dependencyRequirementIds,
      rationale: req.planningFactors?.rationale ?? "Model did not provide a rationale",
    });

    // Priority guardrail: the P0 evidence guard stays, and P0 additionally
    // requires the four strong factors. Insufficient-only evidence is P2.
    const priority = priorityWithinFactorCap(req.priority, planningFactors);
    const versionId = planningFactors.evidenceStrength === "insufficient"
      ? null
      : req.versionId && versionIndex.has(req.versionId)
        ? req.versionId
        : null;
    if (priority !== req.priority) {
      warnings.push({
        code: priority === "P2" && req.priority !== "P2"
          ? "INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED"
          : "PLANNING_PRIORITY_CAPPED",
        message: `${req.id} priority capped from ${req.priority} to ${priority}`,
      });
    }
    if (versionId !== req.versionId && req.versionId) {
      warnings.push({ code: "PLANNING_VERSION_DROPPED", message: `${req.id} removed from target version ${req.versionId}` });
    }
    requirements.push({
      id: req.id,
      findingIds: validFindingIds,
      title: req.title,
      description: req.description,
      sourceReviewIds: reviewIdsForFindings(validFindingIds, findings),
      priority,
      acceptanceCriteria: req.acceptanceCriteria,
      versionId,
      planningFactors,
    });
  }

  // Second pass over dependencies: a scheduled requirement may only depend on
  // requirements that are themselves scheduled. A dependency on an unscheduled
  // requirement would fail traceability later, so it is pruned here (with a
  // warning) instead of being fixed by a revision.
  const scheduledRequirementIds = new Set(
    requirements.filter((r) => r.versionId !== null).map((r) => r.id),
  );
  for (const req of requirements) {
    if (req.versionId === null) continue; // unscheduled reqs may depend on anything
    const deps = req.planningFactors!.dependencyRequirementIds;
    const kept = deps.filter((id) => scheduledRequirementIds.has(id));
    if (kept.length !== deps.length) {
      req.planningFactors!.dependencyRequirementIds = kept;
      warnings.push({
        code: "PLANNING_DEPENDENCY_UNSCHEDULED",
        message: `${req.id} dependency on unscheduled requirement removed`,
      });
    }
  }

  const assumptions: Assumption[] = output.assumptions.map((a) => ({
    id: a.id,
    text: a.text,
    basis: a.basis,
  }));

  // Second pass: only requirements that actually target a version may be
  // listed in it, and versions left with no requirements are deleted so the
  // model can never force a fixed V1/V2/V3 sequence.
  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  const versions = output.versions
    .map((v) => ({
      id: v.id,
      name: v.name,
      summary: v.summary,
      rationale: v.rationale,
      requirementIds: v.requirementIds.filter((id) => {
        const requirement = requirementById.get(id);
        return requirement !== undefined && requirement.versionId === v.id;
      }),
    }))
    .filter((v) => v.requirementIds.length > 0);

  const prd: Prd = {
    outputLocale,
    title: output.title,
    overview: output.overview,
    findings,
    requirements,
    versions,
    tests: [],
    assumptions,
  };

  const versionPlan: VersionPlanArtifact = {
    versions,
    decisions: requirements.map((requirement) => ({
      requirementId: requirement.id,
      priority: requirement.priority,
      versionId: requirement.versionId,
      planningFactors: requirement.planningFactors!,
    })),
  };

  return { prd, versionPlan, warnings };
}

/**
 * Turns grounded findings into a version plan and PRD via the model.
 */
export async function runPlanningStage(ctx: PlanningStageContext): Promise<PlanningStageResult> {
  ctx.onProgress?.("planning versions and writing the PRD");
  const output = await ctx.model.generate({
    stage: "planning",
    promptVersion: planningPrompt.version,
    system: planningPrompt.system,
    user: planningPrompt.buildUser({ findings: ctx.findings, goal: ctx.goal, outputLocale: ctx.outputLocale }),
    schema: PlanningOutputSchema,
    onProgress: modelProgressRelay(ctx.onProgress),
  });

  return normalizePlanningOutput(output, ctx.findings, ctx.outputLocale);
}
