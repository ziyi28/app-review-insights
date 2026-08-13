import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import { collectAppleReviews, type CollectorDeps, type SourceResult } from "./apple-rss-collector";
import { AppleReviewCacheStore } from "./apple-review-cache";
import { runPreviewImpl, type PreviewInput } from "./source-preview";
import { readPreview, isPreviewExpired, pruneExpiredPreviews, PREVIEW_TTL_MS } from "./source-preview";

// The real collector is exercised by the collector tests; here we stub it to
// return deterministic live results and observe the preview logic.
vi.mock("./apple-rss-collector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apple-rss-collector")>();
  return {
    ...actual,
    collectAppleReviews: vi.fn(),
  };
});

const mockedCollect = vi.mocked(collectAppleReviews);

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

function raw(id: string, updatedAt: string | null): RawReview {
  return { sourceReviewId: id, source: "apple-rss", title: `t ${id}`, body: `body ${id}`, rating: 5, version: "1.0", updatedAt };
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

function makeInput(): PreviewInput {
  return {
    previewId: "preview-1",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/x/id839285684",
    now: "2026-08-12T00:00:00.000Z",
    collector: {} as CollectorDeps,
    previewsDir,
    cacheDir,
    historyRoots: [],
    runsDir,
  };
}

describe("source preview", () => {
  it("writes a snapshot and reports recommendedSelection=stable when stable has more reviews", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [raw("a", "2026-08-01T00:00:00Z")] }));
    // Pre-seed a stable cache with more reviews.
    const cacheStore = new AppleReviewCacheStore(cacheDir);
    await cacheStore.mergeLive("us", "839285684", [raw("a", "2026-08-01T00:00:00Z"), raw("b", "2026-08-02T00:00:00Z")]);

    const preview = await runPreviewImpl(makeInput());
    expect(preview.recommendedSelection).toBe("stable");
    expect(preview.live.reviewCount).toBe(1);
    expect(preview.stable.reviewCount).toBe(2);
  });

  it("recommends live when live is non-empty and not smaller than stable", async () => {
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [raw("a", "2026-08-01T00:00:00Z"), raw("b", "2026-08-02T00:00:00Z")] }));
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
    await cacheStore.mergeLive("us", "839285684", [raw("a", "2026-08-01T00:00:00Z")]);

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
    mockedCollect.mockResolvedValue(liveResult({ status: "complete", reviews: [raw("new", "2026-08-05T00:00:00Z")] }));
    const cacheStore = new AppleReviewCacheStore(cacheDir);
    await cacheStore.mergeLive("us", "839285684", [raw("old", "2026-08-01T00:00:00Z")]);

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
