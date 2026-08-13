import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { collectSocialCrawlReviews } from "../../src/server/sources/socialcrawl-collector";

const enabled = process.env.RUN_SOCIALCRAWL_SMOKE === "1" && Boolean(process.env.SOCIALCRAWL_API_KEY);

describe.skipIf(!enabled)("live SocialCrawl smoke (opt-in, consumes provider credits)", () => {
  it("collects current US App Store reviews through SocialCrawl", async () => {
    const result = await collectSocialCrawlReviews({
      fetchFn: fetch,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      now: () => new Date().toISOString(),
      baseUrl: "https://www.socialcrawl.dev",
      apiKey: process.env.SOCIALCRAWL_API_KEY!,
      appId: "839285684",
      timeoutMs: 60_000,
      idempotencyKey: `smoke-${randomUUID()}`,
    });
    // The smoke never logs request headers, the environment, or the full error
    // response; it reports only status and counts.
    console.log(`[smoke] status=${result.status} reviews=${result.reviews.length}`);
    console.log(`[smoke] limitations=${JSON.stringify(result.limitations.map((l) => l.code))}`);
    expect(["complete", "suspect-empty", "partial", "failed"]).toContain(result.status);
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.reviews.length).toBeLessThanOrEqual(500);
  }, 90_000);
});
