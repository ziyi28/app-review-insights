import type { Limitation } from "@/server/sources/apple-rss-collector";
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
};

/**
 * Interprets the user's goal into a concrete analysis scope. Only generic
 * filters (rating/version/language/date) are allowed; anything the goal seems
 * to want that the data cannot support is recorded as an explicit limitation.
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
  };
}
