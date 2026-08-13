import { describe, it, expect } from "vitest";
import { collectAppleReviews } from "../../src/server/sources/apple-rss-collector";

const enabled = process.env.LIVE_SMOKE === "1";

describe.skipIf(!enabled)("live Apple RSS smoke (non-blocking)", () => {
  it("collects or marks suspect-empty against the real feed", async () => {
    const result = await collectAppleReviews({
      fetchFn: fetch,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      now: () => new Date().toISOString(),
      baseUrl: "https://itunes.apple.com/us/rss/customerreviews",
      appId: "839285684",
      maxPages: 3,
      pageDelayMs: 500,
      timeoutMs: 10_000,
      emptyPageRetryDelaysMs: [300, 300],
    });
    expect(["complete", "suspect-empty", "partial", "failed"]).toContain(result.status);
    if (result.status === "complete") expect(result.reviews.length).toBeGreaterThan(0);
    console.log(`[smoke] status=${result.status} reviews=${result.reviews.length}`);
    console.log(`[smoke] pages=${JSON.stringify(result.pages.map((p) => ({ page: p.page, attempt: p.attempt, reviews: p.reviewCount, status: p.httpStatus })))}`);
    console.log(`[smoke] limitations=${JSON.stringify(result.limitations.map((l) => l.code))}`);
  }, 60_000);
});
