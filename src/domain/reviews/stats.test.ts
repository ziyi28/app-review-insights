import { describe, it, expect } from "vitest";
import type { NormalizedReview } from "@/domain/contracts/review";
import { computeStats } from "./stats";

function review(partial: Partial<NormalizedReview>): NormalizedReview {
  return {
    reviewId: "r1",
    sourceReviewId: "s1",
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: "text",
    bodyNormalized: "text",
    rating: 5,
    version: "3.2.1",
    updatedAt: "2026-07-01T10:00:00Z",
    language: "en",
    rawRef: "sources/apple/page-01.json#entry-0",
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
    ...partial,
  };
}

describe("computeStats", () => {
  it("computes rating distribution from included reviews", () => {
    const stats = computeStats([
      review({ rating: 5 }),
      review({ rating: 5 }),
      review({ rating: 1 }),
      review({ rating: 1, includedInAnalysis: false }),
    ]);
    expect(stats.includedCount).toBe(3);
    expect(stats.ratingDistribution[5]).toBe(2);
    expect(stats.ratingDistribution[1]).toBe(1);
  });

  it("computes version and language distributions", () => {
    const stats = computeStats([
      review({ version: "3.2.1", language: "en" }),
      review({ version: "3.2.1", language: "zh" }),
      review({ version: "3.2.0", language: "en" }),
    ]);
    expect(stats.versionDistribution["3.2.1"]).toBe(2);
    expect(stats.languageDistribution["en"]).toBe(2);
    expect(stats.languageDistribution["zh"]).toBe(1);
  });

  it("computes a date range from included reviews", () => {
    const stats = computeStats([
      review({ updatedAt: "2026-07-01T10:00:00Z" }),
      review({ updatedAt: "2026-08-01T10:00:00Z" }),
      review({ updatedAt: null }),
    ]);
    expect(stats.dateRange.earliest).toBe("2026-07-01T10:00:00Z");
    expect(stats.dateRange.latest).toBe("2026-08-01T10:00:00Z");
  });

  it("counts duplicates and identity conflicts", () => {
    const stats = computeStats([
      review({ dedupeStatus: "duplicate" }),
      review({ dedupeStatus: "identity-conflict" }),
      review({ dedupeStatus: "identity-conflict" }),
      review({ dedupeStatus: "unique" }),
    ]);
    expect(stats.duplicateCount).toBe(1);
    expect(stats.identityConflictCount).toBe(2);
  });
});
