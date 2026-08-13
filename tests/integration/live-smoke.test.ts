import { describe, it, expect } from "vitest";
import { collectSerpApiReviews } from "../../src/server/sources/serpapi-collector";

const enabled = process.env.RUN_SERPAPI_SMOKE === "1" && Boolean(process.env.SERPAPI_API_KEY);

describe.skipIf(!enabled)("live SerpApi smoke (opt-in, consumes one paid search)", () => {
  it("collects current US App Store reviews through SerpApi", async () => {
    const result = await collectSerpApiReviews({
      fetchFn: fetch,
      now: () => new Date().toISOString(),
      baseUrl: "https://serpapi.com",
      apiKey: process.env.SERPAPI_API_KEY!,
      appId: "839285684",
      timeoutMs: 60_000,
      maxPages: 1,
    });
    // The smoke never logs the API key, the request URL, or review bodies; it
    // reports only status and counts.
    console.log(`[smoke] status=${result.status} reviews=${result.reviews.length}`);
    console.log(`[smoke] limitations=${JSON.stringify(result.limitations.map((l) => l.code))}`);
    expect(["complete", "suspect-empty", "partial", "failed"]).toContain(result.status);
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.reviews.length).toBeLessThanOrEqual(500);
  }, 90_000);
});
