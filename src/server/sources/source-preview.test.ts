import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import { collectAppleReviews, type CollectorDeps, type SourceResult } from "./apple-rss-collector";
import { collectSerpApiReviews, type SerpApiCollectorDeps, type SerpApiCollectionResult, type SerpApiEvidence } from "./serpapi-collector";
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
vi.mock("./serpapi-collector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./serpapi-collector")>();
  return {
    ...actual,
    collectSerpApiReviews: vi.fn(),
  };
});

const mockedCollect = vi.mocked(collectAppleReviews);
const mockedSerpApi = vi.mocked(collectSerpApiReviews);

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

function serpRaw(id: string): RawReview {
  return { sourceReviewId: id, source: "serpapi-apple-reviews", title: `t ${id}`, body: `body ${id}`, rating: 5, version: "8.2.0", updatedAt: "2026-08-12T00:00:00.000Z" };
}

function limit(code: string) {
  return { code, message: code, stage: "source" };
}

function serpResult(overrides: Partial<SerpApiCollectionResult>): SerpApiCollectionResult {
  const evidence: SerpApiEvidence = {
    provider: "serpapi",
    endpoint: "/search.json",
    engine: "apple_reviews",
    country: "us",
    sort: "mostrecent",
    noCache: true,
    startedAt: "2026-08-12T00:00:00.000Z",
    finishedAt: "2026-08-12T00:00:00.100Z",
    httpStatus: 200,
    requestCount: 1,
    pagesFetched: 1,
    searchIds: ["search_page_1"],
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

function serpDeps(): SerpApiCollectorDeps {
  return {
    fetchFn: vi.fn() as unknown as typeof fetch,
    now: () => "2026-08-12T00:00:00.000Z",
    baseUrl: "https://serpapi.com",
    apiKey: "serp_test_only",
    appId: "839285684",
    timeoutMs: 10_000,
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
    serpApiCollector: null,
    rssCollector: {} as CollectorDeps,
    previewsDir,
    cacheDir,
    historyRoots: [],
    runsDir,
    ...overrides,
  };
}

describe("source preview dispatch", () => {
  it("uses a complete SerpApi result without calling RSS", async () => {
    mockedSerpApi.mockResolvedValue(serpResult({ reviews: [serpRaw("s1")] }));
    const preview = await runPreviewImpl(makeInput({ serpApiCollector: serpDeps() }));
    expect(mockedSerpApi).toHaveBeenCalledTimes(1);
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(preview.live.provider).toBe("serpapi");
    expect(preview.live.forcedRefresh).toBe(true);
    expect(preview.live.cached).toBe(false);
  });

  it("falls back to live Apple RSS when SerpApi first-page collection fails", async () => {
    mockedSerpApi.mockResolvedValue(serpResult({
      status: "failed",
      reviews: [],
      limitations: [limit("SERPAPI_UPSTREAM_FAILED")],
    }));
    mockedCollect.mockResolvedValue(rssResult({ reviews: [rssRaw("rss-only")] }));
    const preview = await runPreviewImpl(makeInput({ serpApiCollector: serpDeps() }));
    expect(preview.live.provider).toBe("apple-rss");
    expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["rss-only"]);
    expect(preview.live.limitations.map((l) => l.code)).toContain("SERPAPI_UPSTREAM_FAILED");
  });

  it("keeps partial SerpApi reviews and never mixes RSS", async () => {
    mockedSerpApi.mockResolvedValue(serpResult({ status: "partial", reviews: [serpRaw("valid")], limitations: [limit("SERPAPI_PARTIAL")] }));
    const preview = await runPreviewImpl(makeInput({ serpApiCollector: serpDeps() }));
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(preview.live.provider).toBe("serpapi");
    expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["valid"]);
    expect(preview.live.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_PARTIAL" }));
  });

  it("uses RSS when SerpApi is not configured and labels the reason", async () => {
    mockedCollect.mockResolvedValue(rssResult({ reviews: [rssRaw("r1")] }));
    const preview = await runPreviewImpl(makeInput({ serpApiCollector: null }));
    expect(mockedSerpApi).not.toHaveBeenCalled();
    expect(mockedCollect).toHaveBeenCalledTimes(1);
    expect(preview.live.provider).toBe("apple-rss");
    expect(preview.live.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_NOT_CONFIGURED" }));
  });

  it("falls back to RSS when SerpApi returns an empty first page", async () => {
    mockedSerpApi.mockResolvedValue(serpResult({ status: "suspect-empty", reviews: [], limitations: [limit("SERPAPI_EMPTY")] }));
    mockedCollect.mockResolvedValue(rssResult({ reviews: [rssRaw("rss-after-empty")] }));
    const preview = await runPreviewImpl(makeInput({ serpApiCollector: serpDeps() }));
    expect(preview.live.provider).toBe("apple-rss");
    expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["rss-after-empty"]);
    expect(preview.live.limitations.map((l) => l.code)).toContain("SERPAPI_EMPTY");
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

  it("caps both live and stable samples at reviewLimit while the cache keeps more", async () => {
    // Live returns more than the cap; the preview must defensively truncate.
    const many = Array.from({ length: 120 }, (_, i) => rssRaw(`live-${i}`, `2026-08-${String((i % 20) + 1).padStart(2, "0")}T00:00:00Z`));
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: many, rawRefs: many.map((r) => `ref:${r.sourceReviewId}`) }));
    // Pre-seed the cache with more than the cap too.
    const cacheStore = new AppleReviewCacheStore(cacheDir);
    await cacheStore.mergeLive("us", "839285684", Array.from({ length: 500 }, (_, i) => rssRaw(`stable-${i}`, `2026-08-${String((i % 20) + 1).padStart(2, "0")}T00:00:00Z`)));

    const preview = await runPreviewImpl(makeInput({ reviewLimit: 100 }));
    expect(preview.reviewLimit).toBe(100);
    expect(preview.live.reviews).toHaveLength(100);
    expect(preview.live.rawRefs).toHaveLength(100);
    expect(preview.stable.reviews).toHaveLength(100);
    // The cache file itself keeps the full 500 for later larger selections.
    expect((await cacheStore.readCache("us", "839285684"))?.reviews).toHaveLength(500);
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
