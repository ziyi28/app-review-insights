import { promises as fs } from "node:fs";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import type { Limitation } from "./apple-rss-collector";
import { collectAppleReviews, type CollectorDeps, type SourceResult } from "./apple-rss-collector";
import { AppleReviewCacheStore } from "./apple-review-cache";

export const PREVIEW_TTL_MS = 30 * 60 * 1000;

export type SourcePreview = {
  protocolVersion: "1";
  previewId: string;
  appId: string;
  canonicalUrl: string;
  createdAt: string;
  expiresAt: string;
  /** Full snapshot held server-side; the API response only exposes summaries. */
  live: {
    status: SourceResult["status"];
    reviewCount: number;
    pageCount: number;
    requestCount: number;
    dateRange: { earliest: string | null; latest: string | null };
    limitations: Limitation[];
    /** Full live reviews, never sent to the browser. */
    reviews: RawReview[];
    rawRefs: string[];
  };
  stable: {
    available: boolean;
    reviewCount: number;
    cacheUpdatedAt: string | null;
    dateRange: { earliest: string | null; latest: string | null };
    bootstrapRunId: string | null;
    /** Full cached reviews, never sent to the browser. */
    reviews: RawReview[];
  };
  recommendedSelection: "live" | "stable" | null;
};

export type PreviewInput = {
  previewId: string;
  appId: string;
  canonicalUrl: string;
  now: string;
  collector: CollectorDeps;
  /** Root where preview snapshots are stored. */
  previewsDir: string;
  /** Root where the review cache lives. */
  cacheDir: string;
  /** Roots scanned to bootstrap the cache from history. */
  historyRoots: string[];
  runsDir: string;
};

export function buildPreviewSnapshot(input: PreviewInput): Promise<SourcePreview> {
  return runPreviewImpl(input);
}

export async function runPreviewImpl(input: PreviewInput): Promise<SourcePreview> {
  const { previewId, appId, canonicalUrl, now, collector, previewsDir, cacheDir, historyRoots, runsDir } = input;
  const createdAt = now;
  const expiresAt = new Date(new Date(createdAt).getTime() + PREVIEW_TTL_MS).toISOString();

  const liveResult = await collectAppleReviews(collector);
  const live: SourcePreview["live"] = {
    status: liveResult.status,
    reviewCount: liveResult.reviews.length,
    pageCount: liveResult.pages.length,
    requestCount: liveResult.pages.reduce((n, p) => n + p.attempt, 0),
    dateRange: dateRangeOf(liveResult.reviews),
    limitations: liveResult.limitations,
    reviews: liveResult.reviews,
    rawRefs: liveResult.rawRefs,
  };

  const cacheStore = new AppleReviewCacheStore(cacheDir);
  // Empty or partial live results must never clear the cache.
  if (live.reviewCount > 0) {
    await cacheStore.mergeLive("us", appId, live.reviews);
  }
  const cached = await cacheStore.bootstrapFromHistory("us", appId, { roots: historyRoots, runsDir });
  const cacheReviews = cached?.reviews ?? [];
  const stable: SourcePreview["stable"] = {
    available: cacheReviews.length > 0,
    reviewCount: cacheReviews.length,
    cacheUpdatedAt: cached?.updatedAt ?? null,
    dateRange: dateRangeOf(cacheReviews),
    bootstrapRunId: cached?.bootstrapRunId ?? null,
    reviews: cacheReviews,
  };

  let recommendedSelection: SourcePreview["recommendedSelection"] = null;
  if (stable.available && stable.reviewCount > live.reviewCount) {
    // Stable has more (or all of the) reviews: prefer the stable sample.
    recommendedSelection = "stable";
  } else if (live.reviewCount > 0) {
    recommendedSelection = "live";
  } else if (stable.available) {
    recommendedSelection = "stable";
  }

  const snapshot: SourcePreview = {
    protocolVersion: "1",
    previewId,
    appId,
    canonicalUrl,
    createdAt,
    expiresAt,
    live,
    stable,
    recommendedSelection,
  };

  await writeSnapshotAtomically(previewsDir, previewId, snapshot);
  return snapshot;
}

export function previewFilePath(previewsDir: string, previewId: string): string {
  return path.join(previewsDir, `${previewId}.json`);
}

export async function readPreview(previewsDir: string, previewId: string): Promise<SourcePreview | null> {
  try {
    const text = await fs.readFile(previewFilePath(previewsDir, previewId), "utf8");
    const parsed = JSON.parse(text) as SourcePreview;
    if (parsed.previewId !== previewId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isPreviewExpired(preview: SourcePreview, now: string): boolean {
  return new Date(now).getTime() > new Date(preview.expiresAt).getTime();
}

/**
 * Lazy cleanup: removes expired preview snapshots in the given directory.
 * Best-effort; never throws on individual failures.
 */
export async function pruneExpiredPreviews(previewsDir: string, now: string): Promise<number> {
  let removed = 0;
  try {
    const files = await fs.readdir(previewsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const text = await fs.readFile(path.join(previewsDir, file), "utf8");
        const parsed = JSON.parse(text) as { expiresAt?: string };
        if (parsed.expiresAt && new Date(now).getTime() > new Date(parsed.expiresAt).getTime()) {
          await fs.unlink(path.join(previewsDir, file));
          removed += 1;
        }
      } catch {
        // skip corrupt/unreadable snapshots
      }
    }
  } catch {
    // directory may not exist yet
  }
  return removed;
}

async function writeSnapshotAtomically(previewsDir: string, previewId: string, snapshot: SourcePreview): Promise<void> {
  await fs.mkdir(previewsDir, { recursive: true });
  const finalPath = previewFilePath(previewsDir, previewId);
  const tmp = path.join(previewsDir, `.${previewId}.${Math.random().toString(36).slice(2)}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(tmp, finalPath);
}

function dateRangeOf(reviews: RawReview[]): { earliest: string | null; latest: string | null } {
  const dates = reviews.map((r) => r.updatedAt).filter((d): d is string => d !== null);
  if (dates.length === 0) return { earliest: null, latest: null };
  const sorted = [...dates].sort();
  return { earliest: sorted[0], latest: sorted[sorted.length - 1] };
}
