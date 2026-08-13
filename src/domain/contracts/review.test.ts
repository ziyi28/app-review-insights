import { describe, it, expect } from "vitest";
import { NormalizedReviewSchema, RawReviewSchema, ReviewSourceSchema } from "./review";

describe("review contracts", () => {
  it("accepts a valid raw review", () => {
    const raw = RawReviewSchema.parse({
      sourceReviewId: "review-1",
      source: "apple-rss",
      title: "Great",
      body: "Love this app",
      rating: 5,
      version: "3.2.1",
      updatedAt: "2026-01-02T03:04:05Z",
    });
    expect(raw.rating).toBe(5);
  });

  it("accepts the SocialCrawl app-store source value", () => {
    expect(ReviewSourceSchema.parse("socialcrawl-app-store")).toBe("socialcrawl-app-store");
  });

  it("rejects a rating outside 1..5", () => {
    expect(() =>
      RawReviewSchema.parse({
        sourceReviewId: "r1",
        source: "apple-rss",
        body: "hi",
        rating: 9,
      }),
    ).toThrow();
  });

  it("requires a body", () => {
    expect(() =>
      RawReviewSchema.parse({ sourceReviewId: "r1", source: "apple-rss", rating: 3 }),
    ).toThrow();
  });

  it("parses a normalized review and derives language default", () => {
    const n = NormalizedReviewSchema.parse({
      reviewId: "abc123",
      sourceReviewId: "r1",
      source: "apple-rss",
      titleOriginal: "",
      bodyOriginal: "text",
      bodyNormalized: "text",
      rating: 4,
      version: null,
      updatedAt: null,
      language: "en",
      rawRef: "sources/apple/page-01.json#entry-0",
      includedInAnalysis: true,
      dedupeStatus: "unique",
    });
    expect(n.includedInAnalysis).toBe(true);
  });

  it("rejects an invalid dedupeStatus", () => {
    expect(() =>
      NormalizedReviewSchema.parse({
        reviewId: "abc",
        sourceReviewId: "r1",
        source: "apple-rss",
        titleOriginal: "",
        bodyOriginal: "x",
        bodyNormalized: "x",
        rating: 5,
        version: null,
        updatedAt: null,
        language: "en",
        rawRef: "x",
        includedInAnalysis: true,
        dedupeStatus: "weird",
      }),
    ).toThrow();
  });
});
