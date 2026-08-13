import type { Limitation } from "@/server/sources/apple-rss-collector";
import type { FocusArea } from "@/domain/contracts/analysis";
import { ScopeOutputSchema, scopePrompt } from "@/server/model/prompts/prompts";
import { modelProgressRelay, type StageModelClient } from "../dependencies";

export type ScopeStageContext = {
  model: StageModelClient;
  goal: string;
  stats: unknown;
  sourceLimitations: Limitation[];
  outputLocale: "en" | "zh-CN";
  /** Live progress callback; invoked with a human-readable message while the
   *  model call is in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
};

export type ScopeStageResult = {
  interpretation: string;
  filters: { rating: number[]; versions: string[]; languages: string[]; minDate: string | null; maxDate: string | null };
  explicitLimitations: string[];
  /** Structured goal dimensions split out of the user's goal. */
  focusAreas: FocusArea[];
};

// Model output is bounded: at most 8 focus areas survive. Excess output is
// truncated deterministically with a warning — never retried.
const MAX_FOCUS_AREAS = 8;

/**
 * Interprets the user's goal into a concrete analysis scope. Only generic
 * filters (rating/version/language/date) are allowed; anything the goal seems
 * to want that the data cannot support is recorded as an explicit limitation.
 * The goal is also split into structured focusAreas that downstream stages map
 * findings/requirements back to, so the plan demonstrably covers the goal.
 */
export async function runScopeStage(ctx: ScopeStageContext): Promise<ScopeStageResult> {
  ctx.onProgress?.("interpreting the analysis scope");
  const output = await ctx.model.generate({
    stage: "scope",
    promptVersion: scopePrompt.version,
    system: scopePrompt.system,
    user: scopePrompt.buildUser({
      goal: ctx.goal,
      stats: ctx.stats,
      sourceLimitations: ctx.sourceLimitations,
    }),
    schema: ScopeOutputSchema,
    onProgress: modelProgressRelay(ctx.onProgress),
  });

  const filters = output.filters ?? {};
  // Cap focus areas deterministically and re-id them (focus-1..n) so ids are
  // always contiguous regardless of what the model emitted. `?? []` guards
  // direct-object stubs that bypass schema defaults.
  const focusAreas: FocusArea[] = (output.focusAreas ?? []).slice(0, MAX_FOCUS_AREAS).map((area, i) => ({
    id: `focus-${i + 1}`,
    label: area.label,
  }));

  return {
    interpretation: output.interpretation,
    filters: {
      rating: filters.rating ?? [],
      versions: filters.versions ?? [],
      languages: filters.languages ?? [],
      minDate: filters.minDate ?? null,
      maxDate: filters.maxDate ?? null,
    },
    explicitLimitations: output.explicitLimitations,
    focusAreas,
  };
}
