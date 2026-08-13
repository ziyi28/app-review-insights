import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import { collectAppleReviews, type CollectorDeps, type SourceResult } from "./apple-rss-collector";
import { collectSocialCrawlReviews, type SocialCrawlCollectorDeps, type SocialCrawlCollectionResult, type SocialCrawlEvidence } from "./socialcrawl-collector";
import { AppleReviewCacheStore } from "./apple-review-cache";
import { runPreviewImpl, type PreviewInput } from "./source-preview";
import { readPreview, isPreviewExpired, pruneExpiredPreviews, PREVIEW_TTL_MS } from "./source-preview";

// The real collectors are exercised by their own tests; here we stub them to
// return deterministic live results and observe the preview dispatch.
vi.mock("./apple-rss-collector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apple-rss-collector")>();
  return {
    ...actual,
    collectAppleReviews: vi.fn(),
  };
});
vi.mock("./socialcrawl-collector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./socialcrawl-collector")>();
  return {
    ...actual,
    collectSocialCrawlReviews: vi.fn(),
  };
});

const mockedCollect = vi.mocked(collectAppleReviews);
const mockedSocialCrawl = vi.mocked(collectSocialCrawlReviews);

function liveResult(overrides: Partial<SourceResult>): SourceResult {
  return {
    status: "complete",
    reviews: [],
    rawRefs: [],
    limitations: [],
    pages: [],
    ...overrides,
  };
}

function rssResult(overrides: Partial<SourceResult>): SourceResult {
  return liveResult(overrides);
}

function rssRaw(id: string, updatedAt: string | null = "2026-08-01T00:00:00Z"): RawReview {
  return { sourceReviewId: id, source: "apple-rss", title: `t ${id}`, body: `body ${id}`, rating: 5, version: "1.0", updatedAt };
}

function socialRaw(id: string): RawReview {
  return { sourceReviewId: id, source: "socialcrawl-app-store", title: `t ${id}`, body: `body ${id}`, rating: 5, version: "8.2.0", updatedAt: "2026-08-12T00:00:00.000Z" };
}

function limit(code: string) {
  return { code, message: code, stage: "source" };
}

function socialResult(overrides: Partial<SocialCrawlCollectionResult>): SocialCrawlCollectionResult {
  const evidence: SocialCrawlEvidence = {
    provider: "socialcrawl",
    endpoint: "/v1/app_store/app-reviews",
    country: "US",
    language: "en",
    requestedDepth: 500,
    sortBy: "most_recent",
    forcedRefresh: true,
    cached: false,
    requestId: "req_test",
    creditsUsed: 5,
    startedAt: "2026-08-12T00:00:00.000Z",
    finishedAt: "2026-08-12T00:00:00.100Z",
    httpStatus: 200,
    attemptCount: 1,
    providerDropped: 0,
    parserDropped: 0,
  };
  return {
    status: "complete",
    reviews: [],
    rawRefs: [],
    limitations: [],
    evidence,
    ...overrides,
  };
}

function socialDeps(): SocialCrawlCollectorDeps {
  return {
    fetchFn: vi.fn() as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => "2026-08-12T00:00:00.000Z",
    baseUrl: "https://www.socialcrawl.dev",
    apiKey: "sc_test_only",
    appId: "839285684",
    timeoutMs: 10_000,
    idempotencyKey: "preview-1",
  };
}

let baseDir: string;
let previewsDir: string;
let cacheDir: string;
let runsDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "preview-"));
  previewsDir = path.join(baseDir, "previews");
  cacheDir = path.join(baseDir, "cache");
  runsDir = path.join(baseDir, "runs");
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function makeInput(overrides: Partial<PreviewInput> = {}): PreviewInput {
  return {
    previewId: "preview-1",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/x/id839285684",
    now: "2026-08-12T00:00:00.000Z",
    socialCrawlCollector: null,
    rssCollector: {} as CollectorDeps,
    previewsDir,
    cacheDir,
    historyRoots: [],
    runsDir,
    ...overrides,
  };
}

describe("source preview dispatch", () => {
  it("uses SocialCrawl only when it returns valid reviews", async () => {
    mockedSocialCrawl.mockResolvedValue(socialResult({ reviews: [socialRaw("s1")] }));
    const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
    expect(mockedSocialCrawl).toHaveBeenCalledTimes(1);
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(preview.live.provider).toBe("socialcrawl");
    expect(preview.live.forcedRefresh).toBe(true);
    expect(preview.live.cached).toBe(false);
  });

  it("falls back to RSS when SocialCrawl is not configured", async () => {
    mockedCollect.mockResolvedValue(rssResult({ reviews: [rssRaw("r1")] }));
    const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: null }));
    expect(mockedSocialCrawl).not.toHaveBeenCalled();
    expect(mockedCollect).toHaveBeenCalledTimes(1);
    expect(preview.live.provider).toBe("apple-rss");
    expect(preview.live.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_NOT_CONFIGURED" }));
  });

  it("uses RSS after SocialCrawl deterministic failure and preserves the reason", async () => {
    mockedSocialCrawl.mockResolvedValue(socialResult({ status: "failed", limitations: [limit("SOCIALCRAWL_CREDITS_EXHAUSTED")] }));
    mockedCollect.mockResolvedValue(rssResult({ reviews: [rssRaw("rss-only")] }));
    const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
    expect(preview.live.provider).toBe("apple-rss");
    expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["rss-only"]);
    expect(preview.live.limitations.map((l) => l.code)).toContain("SOCIALCRAWL_CREDITS_EXHAUSTED");
  });

  it("does not mix RSS into a partial SocialCrawl result", async () => {
    mockedSocialCrawl.mockResolvedValue(socialResult({ status: "partial", reviews: [socialRaw("valid")], limitations: [limit("SOCIALCRAWL_ITEMS_DROPPED")] }));
    const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["valid"]);
    expect(preview.live.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_ITEMS_DROPPED" }));
  });

  it("falls back to RSS when SocialCrawl returns an empty success", async () => {
    mockedSocialCrawl.mockResolvedValue(socialResult({ status: "suspect-empty", reviews: [], limitations: [limit("SOCIALCRAWL_EMPTY")] }));
    mockedCollect.mockResolvedValue(rssResult({ reviews: [rssRaw("rss-after-empty")] }));
    const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
    expect(preview.live.provider).toBe("apple-rss");
    expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["rss-after-empty"]);
    expect(preview.live.limitations.map((l) => l.code)).toContain("SOCIALCRAWL_EMPTY");
  });
});

describe("source preview", () => {
  it("writes a snapshot and reports recommendedSelection=stable when stable has more reviews", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [rssRaw("a", "2026-08-01T00:00:00Z")] }));
    // Pre-seed a stable cache with more reviews.
    const cacheStore = new AppleReviewCacheStore(cacheDir);
    await cacheStore.mergeLive("us", "839285684", [rssRaw("a", "2026-08-01T00:00:00Z"), rssRaw("b", "2026-08-02T00:00:00Z")]);

    const preview = await runPreviewImpl(makeInput());
    expect(preview.recommendedSelection).toBe("stable");
    expect(preview.live.reviewCount).toBe(1);
    expect(preview.stable.reviewCount).toBe(2);
  });

  it("recommends live when live is non-empty and not smaller than stable", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [rssRaw("a", "2026-08-01T00:00:00Z"), rssRaw("b", "2026-08-02T00:00:00Z")] }));
    const preview = await runPreviewImpl(makeInput());
    expect(preview.recommendedSelection).toBe("live");
    expect(preview.live.reviewCount).toBe(2);
    // The live reviews are merged into the cache, so stable echoes them back;
    // live (2) is still not smaller than stable (2), so live wins.
    expect(preview.stable.reviewCount).toBe(2);
  });

  it("recommends stable when live is empty and stable is available", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "suspect-empty", reviews: [] }));
    const cacheStore = new AppleReviewCacheStore(cacheDir);
    await cacheStore.mergeLive("us", "839285684", [rssRaw("a", "2026-08-01T00:00:00Z")]);

    const preview = await runPreviewImpl(makeInput());
    expect(preview.recommendedSelection).toBe("stable");
    expect(preview.live.status).toBe("suspect-empty");
  });

  it("recommends null when both live and stable are empty", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "suspect-empty", reviews: [] }));
    const preview = await runPreviewImpl(makeInput());
    expect(preview.recommendedSelection).toBeNull();
  });

  it("merges live reviews into the cache even when live is smaller", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [rssRaw("new", "2026-08-05T00:00:00Z")] }));
    const cacheStore = new AppleReviewCacheStore(cacheDir);
    await cacheStore.mergeLive("us", "839285684", [rssRaw("old", "2026-08-01T00:00:00Z")]);

    await runPreviewImpl(makeInput());
    const cache = await cacheStore.readCache("us", "839285684");
    expect(cache?.reviews).toHaveLength(2);
  });

  it("persists the snapshot and reads it back", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [] }));
    const input = makeInput();
    const preview = await runPreviewImpl(input);
    const loaded = await readPreview(previewsDir, "preview-1");
    expect(loaded?.previewId).toBe("preview-1");
    expect(loaded?.expiresAt).toBe(preview.expiresAt);
  });

  it("computes a 30-minute expiry", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [] }));
    const preview = await runPreviewImpl(makeInput());
    const ms = new Date(preview.expiresAt).getTime() - new Date(preview.createdAt).getTime();
    expect(ms).toBe(PREVIEW_TTL_MS);
  });

  it("isPreviewExpired reports expiry after the TTL", () => {
    const createdAt = "2026-08-12T00:00:00.000Z";
    const notExpired = { createdAt, expiresAt: new Date(new Date(createdAt).getTime() + PREVIEW_TTL_MS).toISOString() } as never;
    expect(isPreviewExpired(notExpired, "2026-08-12T00:29:00.000Z")).toBe(false);
    expect(isPreviewExpired(notExpired, "2026-08-12T00:31:00.000Z")).toBe(true);
  });

  it("prunes expired snapshots lazily", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [] }));
    await runPreviewImpl(makeInput());
    // Fast-forward past the TTL and prune.
    const removed = await pruneExpiredPreviews(previewsDir, "2026-08-13T00:00:00.000Z");
    expect(removed).toBe(1);
    expect(await readPreview(previewsDir, "preview-1")).toBeNull();
  });
});
