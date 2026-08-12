import { describe, it, expect, vi } from "vitest";
import { runScopeStage, type ScopeStageContext } from "./scope";

function context(overrides: Partial<ScopeStageContext> = {}): ScopeStageContext {
  const generate = vi.fn(async () => ({
    interpretation: "Focus on pricing complaints",
    filters: { rating: [1], versions: [], languages: [], minDate: null, maxDate: null },
    explicitLimitations: ["no date filter supported"],
  }));
  return {
    model: { generate } as never,
    goal: "Understand why users churn",
    stats: { ratingDistribution: { 1: 10, 5: 20 } },
    sourceLimitations: [{ code: "RSS_PARTIAL", message: "partial", stage: "source" }],
    outputLocale: "en",
    ...overrides,
  };
}

describe("runScopeStage", () => {
  it("produces a scope with filters and interpretation", async () => {
    const result = await runScopeStage(context());
    expect(result.filters.rating).toContain(1);
    expect(result.interpretation.length).toBeGreaterThan(0);
  });

  it("records limitations when the goal asks for unsupported filters", async () => {
    const result = await runScopeStage(context());
    expect(result.explicitLimitations.length).toBeGreaterThan(0);
  });
});
