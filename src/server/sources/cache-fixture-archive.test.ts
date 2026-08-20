import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import type { RawReview } from "@/domain/contracts/review";
import type { AppleReviewCache } from "./apple-review-cache";
import { archiveCachedFixtureReviews, CACHE_FIXTURE_ARCHIVE_PATH } from "./cache-fixture-archive";

function makeRawReview(id: string, source: RawReview["source"] = "apple-rss", body = "test body", rating = 5): RawReview {
  return {
    sourceReviewId: id,
    source,
    title: `title-${id}`,
    body,
    rating,
    version: "1.0.0",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

describe("archiveCachedFixtureReviews", () => {
  it("archives pure RSS reviews and generates matching evidence, refs, and file", () => {
    const r1 = makeRawReview("r1", "apple-rss");
    const r2 = makeRawReview("r2", "apple-rss");
    const cache: AppleReviewCache = {
      updatedAt: "2026-08-10T12:00:00Z",
      bootstrapRunId: "run-bootstrap-1",
      reviews: [r1, r2],
    };

    const result = archiveCachedFixtureReviews(cache, [r1, r2]);
    expect(result.rawRefs).toEqual([
      `${CACHE_FIXTURE_ARCHIVE_PATH}#/reviews/0`,
      `${CACHE_FIXTURE_ARCHIVE_PATH}#/reviews/1`,
    ]);
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.sourceFiles[0].relativePath).toBe(CACHE_FIXTURE_ARCHIVE_PATH);

    const parsed = JSON.parse(result.sourceFiles[0].content);
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.cacheUpdatedAt).toBe("2026-08-10T12:00:00Z");
    expect(parsed.bootstrapRunId).toBe("run-bootstrap-1");
    expect(parsed.reviews).toEqual([r1, r2]);

    expect(result.evidence.sourceCounts).toEqual({ "apple-rss": 2 });
    expect(result.evidence.byteLength).toBe(Buffer.byteLength(result.sourceFiles[0].content, "utf8"));
    expect(result.evidence.sha256).toBe(
      createHash("sha256").update(result.sourceFiles[0].content, "utf8").digest("hex"),
    );
  });

  it("handles mixed RSS and SerpApi reviews with accurate sourceCounts", () => {
    const r1 = makeRawReview("r1", "apple-rss");
    const r2 = makeRawReview("r2", "serpapi-apple-reviews");
    const r3 = makeRawReview("r3", "apple-rss");
    const cache: AppleReviewCache = {
      updatedAt: "2026-08-10T12:00:00Z",
      bootstrapRunId: null,
      reviews: [r1, r2, r3],
    };

    const result = archiveCachedFixtureReviews(cache, [r1, r2, r3]);
    expect(result.evidence.sourceCounts).toEqual({
      "apple-rss": 2,
      "serpapi-apple-reviews": 1,
    });
    expect(result.evidence.bootstrapRunId).toBeNull();
  });

  it("accepts a valid prefix of cache.reviews", () => {
    const r1 = makeRawReview("r1");
    const r2 = makeRawReview("r2");
    const r3 = makeRawReview("r3");
    const cache: AppleReviewCache = {
      updatedAt: "2026-08-10T12:00:00Z",
      bootstrapRunId: null,
      reviews: [r1, r2, r3],
    };

    const result = archiveCachedFixtureReviews(cache, [r1, r2]);
    expect(result.rawRefs).toHaveLength(2);
    expect(result.evidence.sourceCounts).toEqual({ "apple-rss": 2 });
  });

  it("throws when reviews count exceeds cache size", () => {
    const r1 = makeRawReview("r1");
    const r2 = makeRawReview("r2");
    const cache: AppleReviewCache = {
      updatedAt: "2026-08-10T12:00:00Z",
      bootstrapRunId: null,
      reviews: [r1],
    };

    expect(() => archiveCachedFixtureReviews(cache, [r1, r2])).toThrow(/exceeds cache size/);
  });

  it("throws when a review has modified field vs cache entry", () => {
    const r1 = makeRawReview("r1", "apple-rss", "original body", 5);
    const r1Modified = makeRawReview("r1", "apple-rss", "tampered body", 5);
    const cache: AppleReviewCache = {
      updatedAt: "2026-08-10T12:00:00Z",
      bootstrapRunId: null,
      reviews: [r1],
    };

    expect(() => archiveCachedFixtureReviews(cache, [r1Modified])).toThrow(/does not match cache entry/);
  });

  it("throws when reviews are out of order vs cache", () => {
    const r1 = makeRawReview("r1");
    const r2 = makeRawReview("r2");
    const cache: AppleReviewCache = {
      updatedAt: "2026-08-10T12:00:00Z",
      bootstrapRunId: null,
      reviews: [r1, r2],
    };

    expect(() => archiveCachedFixtureReviews(cache, [r2, r1])).toThrow(/does not match cache entry/);
  });
});
