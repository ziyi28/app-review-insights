import { promises as fs } from "node:fs";
import path from "node:path";
import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import { RunStore } from "@/server/runs/run-store";
import { RunCatalog } from "@/server/runs/run-catalog";

export const CACHE_MAX_REVIEWS = 500;

export type AppleReviewCache = {
  /** ISO timestamps of the last merge and the last read. */
  updatedAt: string;
  reviews: RawReview[];
  /** runId used to bootstrap the cache from history, when applicable. */
  bootstrapRunId: string | null;
};

/**
 * Local, persistent review cache for the Apple RSS source, keyed by storefront
 * + appId under the git-ignored `data/source-cache/apple/{storefront}/{appId}.json`.
 *
 * Merge semantics:
 * - Dedupe by `sourceReviewId`; a same-id review from live data overwrites the
 *   cached fields (most-recent-wins).
 * - Sort by `updatedAt` descending, reviews without a date last, id as final
 *   tiebreaker, capped at 500.
 * - An empty or partial live result never clears or shrinks the cache; any
 *   non-empty live result is merged in.
 *
 * History bootstrap: when no cache exists for an appId, scan historical runs
 * for the same appId. Only runs whose source status is `complete` with a
 * verifiable cleaned artifact are accepted; prefer the one with the most
 * reviews, then the newest. The cleaned NormalizedReviews are converted back to
 * RawReviews (body is restored from bodyOriginal, rating/version/updatedAt are
 * preserved) and recorded as `bootstrapRunId`. Historical run files are never
 * modified.
 */
export class AppleReviewCacheStore {
  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  cachePath(storefront: "us", appId: string): string {
    return path.join(this.root, "apple", storefront, `${appId}.json`);
  }

  async readCache(storefront: "us", appId: string): Promise<AppleReviewCache | null> {
    try {
      const text = await fs.readFile(this.cachePath(storefront, appId), "utf8");
      const parsed = JSON.parse(text) as Partial<AppleReviewCache>;
      if (!Array.isArray(parsed.reviews)) return null;
      return {
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : this.now(),
        reviews: parsed.reviews,
        bootstrapRunId: typeof parsed.bootstrapRunId === "string" ? parsed.bootstrapRunId : null,
      };
    } catch {
      return null;
    }
  }

  async writeCache(storefront: "us", appId: string, cache: AppleReviewCache): Promise<void> {
    const file = this.cachePath(storefront, appId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${Math.random().toString(36).slice(2)}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), "utf8");
    await fs.rename(tmp, file);
  }

  /**
   * Merges live reviews into the cache. An empty live list is a no-op (an empty
   * or partial result never clears the cache). Reviews are deduped by
   * sourceReviewId with live-most-recent-wins, then sorted and capped.
   */
  async mergeLive(storefront: "us", appId: string, live: RawReview[]): Promise<AppleReviewCache> {
    const current = await this.readCache(storefront, appId);
    const merged = new Map<string, RawReview>();
    for (const r of current?.reviews ?? []) merged.set(r.sourceReviewId, r);
    for (const r of live) merged.set(r.sourceReviewId, r);
    const sorted = [...merged.values()].sort(compareByDate).slice(0, CACHE_MAX_REVIEWS);
    const cache: AppleReviewCache = {
      updatedAt: this.now(),
      reviews: sorted,
      bootstrapRunId: current?.bootstrapRunId ?? null,
    };
    await this.writeCache(storefront, appId, cache);
    return cache;
  }

  /**
   * Bootstraps the cache from historical runs when it does not exist yet.
   * Returns null when no qualifying run is found.
   */
  async bootstrapFromHistory(
    storefront: "us",
    appId: string,
    options: { roots: string[]; runsDir: string },
  ): Promise<AppleReviewCache | null> {
    const existing = await this.readCache(storefront, appId);
    if (existing) return existing;

    const candidates = await this.findHistoricalCandidates(appId, options.roots);
    if (candidates.length === 0) return null;

    const store = new RunStore(options.runsDir);
    const runId = candidates[0].runId;
    try {
      const cleaned = (await store.readArtifact(runId, "cleaned-reviews", 1)) as {
        reviews?: NormalizedReview[];
      };
      const reviews = cleaned.reviews?.filter((r) => r.dedupeStatus === "unique").map(normalizedToRaw) ?? [];
      if (reviews.length === 0) return null;
      const cache: AppleReviewCache = {
        updatedAt: this.now(),
        reviews: reviews.slice(0, CACHE_MAX_REVIEWS),
        bootstrapRunId: runId,
      };
      await this.writeCache(storefront, appId, cache);
      return cache;
    } catch {
      return null;
    }
  }

  /**
   * Finds qualifying historical runs for an appId across the given roots.
   * A run qualifies when its source status is `complete` and it has a readable
   * cleaned-reviews artifact. Sorted by (reviewCount desc, createdAt desc).
   */
  async findHistoricalCandidates(appId: string, roots: string[]): Promise<{ runId: string; reviewCount: number; createdAt: string }[]> {
    const catalog = new RunCatalog(roots);
    const entries = await catalog.list();
    const qualified: { runId: string; reviewCount: number; createdAt: string }[] = [];
    for (const entry of entries) {
      if (entry.manifest.status !== "completed") continue;
      const sourceSummary = await this.readSourceEvidence(entry.runId, entry.root).catch(() => null);
      if (!sourceSummary) continue;
      // Legacy runs carry kind "apple-rss"; newer SocialCrawl runs carry the
      // provider-aware "app-store-reviews" summary. Both can bootstrap a cache.
      const supportedKind = sourceSummary.kind === "apple-rss" || sourceSummary.kind === "app-store-reviews";
      if (!supportedKind || String(sourceSummary.appId) !== appId) continue;
      if (sourceSummary.status !== "complete") continue;
      const count = Number(sourceSummary.reviewCount ?? 0);
      qualified.push({ runId: entry.runId, reviewCount: count, createdAt: entry.manifest.createdAt });
    }
    qualified.sort((a, b) => (a.reviewCount !== b.reviewCount ? b.reviewCount - a.reviewCount : (a.createdAt < b.createdAt ? 1 : -1)));
    return qualified;
  }

  private async readSourceEvidence(runId: string, root: string): Promise<{ kind?: unknown; appId?: unknown; status?: unknown; reviewCount?: unknown }> {
    const store = new RunStore(root);
    const value = (await store.readArtifact(runId, "source-evidence", 1)) as Record<string, unknown>;
    return value;
  }
}

function compareByDate(a: RawReview, b: RawReview): number {
  const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
  const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
  if (ta !== null && tb !== null) return ta === tb ? (a.sourceReviewId < b.sourceReviewId ? -1 : 1) : tb - ta;
  if (ta !== null) return -1; // dated reviews before undated
  if (tb !== null) return 1;
  return a.sourceReviewId < b.sourceReviewId ? -1 : 1;
}

function normalizedToRaw(n: NormalizedReview): RawReview {
  return {
    sourceReviewId: n.sourceReviewId,
    source: n.source,
    title: n.titleOriginal,
    body: n.bodyOriginal,
    rating: n.rating,
    version: n.version,
    updatedAt: n.updatedAt,
  };
}
