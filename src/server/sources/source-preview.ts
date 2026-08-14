import { promises as fs } from "node:fs";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import type { Limitation, CollectionStatus } from "./source-types";
import { collectAppleReviews, type CollectorDeps } from "./apple-rss-collector";
import { collectSerpApiReviews, type SerpApiEvidence, type SerpApiCollectorDeps } from "./serpapi-collector";
import { AppleReviewCacheStore } from "./apple-review-cache";

export const PREVIEW_TTL_MS = 30 * 60 * 1000;

/** Which live provider produced this preview's fresh sample. */
export type LiveProvider = "serpapi" | "apple-rss";

type LiveSourceEvidence =
  | SerpApiEvidence
  | { provider: "apple-rss"; pageCount: number; requestCount: number };

export type SourcePreview = {
  protocolVersion: "1";
  previewId: string;
  appId: string;
  canonicalUrl: string;
  createdAt: string;
  expiresAt: string;
  /** The selected review cap (100/300/500) this preview was built against. */
  reviewLimit: number;
  /** Full snapshot held server-side; the API response only exposes summaries. */
  live: {
    provider: LiveProvider;
    forcedRefresh: boolean;
    cached: boolean | null;
    collectedAt: string;
    status: CollectionStatus;
    reviewCount: number;
    pageCount: number;
    requestCount: number;
    dateRange: { earliest: string | null; latest: string | null };
    limitations: Limitation[];
    /** Secret-free provider metadata (request id, credits used…). */
    evidence: LiveSourceEvidence;
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
  /** Selected review cap (100/300/500); defaults to 500 for old clients. */
  reviewLimit?: number;
  /** SerpApi deps, or null when the key is not configured. */
  serpApiCollector: SerpApiCollectorDeps | null;
  rssCollector: CollectorDeps;
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
  const { previewId, appId, canonicalUrl, now, serpApiCollector, rssCollector, previewsDir, cacheDir, historyRoots, runsDir } = input;
  // 500 is both the historical default and the hard ceiling.
  const reviewLimit = Math.min(input.reviewLimit ?? 500, 500);
  const createdAt = now;
  const expiresAt = new Date(new Date(createdAt).getTime() + PREVIEW_TTL_MS).toISOString();

  // One live provider per preview: SerpApi when configured and it returns
  // valid reviews; otherwise an explicit live Apple RSS fallback. A partial
  // SerpApi result is kept as-is and never mixed with RSS reviews. The same
  // review cap is threaded to both collectors so they stop paginating early.
  const serp = serpApiCollector ? await collectSerpApiReviews({ ...serpApiCollector, reviewLimit }) : null;
  const useSerp = serp !== null && serp.reviews.length > 0;
  const rss = useSerp ? null : await collectAppleReviews({ ...rssCollector, reviewLimit });
  const selected = useSerp ? serp : rss!;

  const limitations: Limitation[] = [];
  if (serp === null) {
    limitations.push({
      code: "SERPAPI_NOT_CONFIGURED",
      message: "SerpApi is not configured; falling back to Apple RSS",
      stage: "source",
    });
  } else if (!useSerp) {
    // Preserve every SerpApi limitation (auth failure, quota, upstream, empty)
    // before the RSS fallback reason.
    limitations.push(...serp.limitations);
  }
  limitations.push(...selected.limitations);

  // Defensive re-truncation so an abnormal upstream response can never exceed
  // the selected cap, even when a collector already applied it.
  const liveReviews = selected.reviews.slice(0, reviewLimit);
  const liveRawRefs = selected.rawRefs.slice(0, reviewLimit);

  const live: SourcePreview["live"] = useSerp
    ? {
        provider: "serpapi",
        forcedRefresh: true,
        cached: false,
        collectedAt: now,
        status: serp!.status,
        reviewCount: liveReviews.length,
        pageCount: serp!.evidence.pagesFetched,
        requestCount: serp!.evidence.requestCount,
        dateRange: dateRangeOf(liveReviews),
        limitations,
        evidence: serp!.evidence,
        reviews: liveReviews,
        rawRefs: liveRawRefs,
      }
    : {
        provider: "apple-rss",
        forcedRefresh: false,
        cached: null,
        collectedAt: now,
        status: rss!.status,
        reviewCount: liveReviews.length,
        pageCount: rss!.pages.length,
        requestCount: rss!.pages.reduce((n, p) => n + p.attempt, 0),
        dateRange: dateRangeOf(liveReviews),
        limitations,
        evidence: { provider: "apple-rss", pageCount: rss!.pages.length, requestCount: rss!.pages.reduce((n, p) => n + p.attempt, 0) },
        reviews: liveReviews,
        rawRefs: liveRawRefs,
      };

  const cacheStore = new AppleReviewCacheStore(cacheDir);
  // Empty or partial live results must never clear the cache.
  if (live.reviewCount > 0) {
    await cacheStore.mergeLive("us", appId, live.reviews);
  }
  const cached = await cacheStore.bootstrapFromHistory("us", appId, { roots: historyRoots, runsDir });
  // Stable sample: take the newest N from the time-descending cache, while the
  // cache file itself keeps up to 500 reviews for later, larger selections.
  const cacheReviews = (cached?.reviews ?? []).slice(0, reviewLimit);
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
    reviewLimit,
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
