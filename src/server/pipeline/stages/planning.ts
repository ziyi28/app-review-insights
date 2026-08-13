import type { Assumption, Finding, Prd, Requirement } from "@/domain/contracts/analysis";
import { planningPrompt, PlanningOutputSchema, type PlanningOutput } from "@/server/model/prompts/prompts";
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
  warnings: { code: string; message: string }[];
};

/**
 * Normalizes a planning model output into a protocol-valid PRD. Only
 * requirements that reference an existing finding survive; their
 * sourceReviewIds are derived deterministically from the findings' evidence.
 * Ideas without evidence go to the separate assumptions list, never into
 * requirements.
 */
export function normalizePlanningOutput(
  output: PlanningOutput,
  findings: Finding[],
  outputLocale: "en" | "zh-CN",
): PlanningStageResult {
  const warnings: { code: string; message: string }[] = [];
  const findingIndex = new Map(findings.map((f) => [f.id, f]));

  const requirements: Requirement[] = [];
  const versionIndex = new Set(output.versions.map((v) => v.id));

  for (const req of output.requirements) {
    const validFindingIds = req.findingIds.filter((id) => findingIndex.has(id));
    if (validFindingIds.length === 0) {
      warnings.push({ code: "UNSUPPORTED_REQUIREMENT", message: `dropped ${req.id} (no valid finding links)` });
      continue;
    }
    requirements.push({
      id: req.id,
      findingIds: validFindingIds,
      title: req.title,
      description: req.description,
      sourceReviewIds: reviewIdsForFindings(validFindingIds, findings),
      priority: req.priority,
      acceptanceCriteria: req.acceptanceCriteria,
      versionId: req.versionId && versionIndex.has(req.versionId) ? req.versionId : null,
    });
  }

  const assumptions: Assumption[] = output.assumptions.map((a) => ({
    id: a.id,
    text: a.text,
    basis: a.basis,
  }));

  const versions = output.versions.map((v) => ({
    id: v.id,
    name: v.name,
    summary: v.summary,
    requirementIds: v.requirementIds.filter((id) => requirements.some((r) => r.id === id)),
  }));

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

  return { prd, warnings };
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
