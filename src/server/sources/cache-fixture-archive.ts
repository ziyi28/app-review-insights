import { createHash } from "node:crypto";
import type { RawReview } from "@/domain/contracts/review";
import type { SourceFile } from "./source-types";
import type { AppleReviewCache } from "./apple-review-cache";

export const CACHE_FIXTURE_ARCHIVE_PATH = "sources/cache/reviews.attempt-01.json";

export type CacheFixtureArchiveEvidence = {
  rawFile: string;
  byteLength: number;
  sha256: string;
  cacheUpdatedAt: string;
  bootstrapRunId: string | null;
  sourceCounts: Partial<Record<RawReview["source"], number>>;
};

function reviewsEqual(a: RawReview, b: RawReview): boolean {
  return (
    a.sourceReviewId === b.sourceReviewId &&
    a.source === b.source &&
    a.title === b.title &&
    a.body === b.body &&
    a.rating === b.rating &&
    a.version === b.version &&
    a.updatedAt === b.updatedAt
  );
}

export function archiveCachedFixtureReviews(
  cache: AppleReviewCache,
  reviews: RawReview[],
): {
  rawRefs: string[];
  sourceFiles: SourceFile[];
  evidence: CacheFixtureArchiveEvidence;
} {
  if (reviews.length > cache.reviews.length) {
    throw new Error(`Requested review count ${reviews.length} exceeds cache size ${cache.reviews.length}`);
  }
  for (let i = 0; i < reviews.length; i++) {
    if (!reviewsEqual(reviews[i], cache.reviews[i])) {
      throw new Error(`Review at index ${i} does not match cache entry (sourceReviewId: ${reviews[i]?.sourceReviewId})`);
    }
  }

  const payload = {
    schemaVersion: "1",
    cacheUpdatedAt: cache.updatedAt,
    bootstrapRunId: cache.bootstrapRunId ?? null,
    reviews,
  };
  const content = JSON.stringify(payload, null, 2);
  const byteLength = Buffer.byteLength(content, "utf8");
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");

  const sourceCounts: Partial<Record<RawReview["source"], number>> = {};
  for (const r of reviews) {
    sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
  }

  const rawRefs = reviews.map((_, i) => `${CACHE_FIXTURE_ARCHIVE_PATH}#/reviews/${i}`);
  const sourceFiles: SourceFile[] = [{ relativePath: CACHE_FIXTURE_ARCHIVE_PATH, content }];
  const evidence: CacheFixtureArchiveEvidence = {
    rawFile: CACHE_FIXTURE_ARCHIVE_PATH,
    byteLength,
    sha256,
    cacheUpdatedAt: cache.updatedAt,
    bootstrapRunId: cache.bootstrapRunId ?? null,
    sourceCounts,
  };

  return {
    rawRefs,
    sourceFiles,
    evidence,
  };
}
