import { describe, it, expect } from "vitest";
import type { RawReview } from "@/domain/contracts/review";
import { dedupeReviews } from "./dedupe";

function raw(partial: Partial<RawReview>): RawReview {
  return {
    sourceReviewId: "id-x",
    source: "apple-rss",
    title: "",
    body: "text",
    rating: 5,
    version: null,
    updatedAt: null,
    ...partial,
  };
}

describe("dedupeReviews", () => {
  it("flags exact duplicates by source id and identical content as duplicate", () => {
    const input = [
      raw({ sourceReviewId: "a", body: "same text" }),
      raw({ sourceReviewId: "a", body: "same text" }),
    ];
    const { reviews, stats } = dedupeReviews(input);
    expect(stats.duplicateCount).toBe(1);
    expect(reviews.filter((r) => r.dedupeStatus === "duplicate")).toHaveLength(1);
  });

  it("flags content duplicates with different source ids", () => {
    const input = [
      raw({ sourceReviewId: "a", body: "same text" }),
      raw({ sourceReviewId: "b", body: "same text" }),
    ];
    const { reviews, stats } = dedupeReviews(input);
    expect(stats.duplicateCount).toBe(1);
    const dup = reviews.find((r) => r.dedupeStatus === "duplicate");
    expect(dup?.duplicateOf).toBeTruthy();
  });

  it("keeps identity conflicts (same source id, conflicting content)", () => {
    const input = [
      raw({ sourceReviewId: "a", body: "first version" }),
      raw({ sourceReviewId: "a", body: "changed my mind" }),
    ];
    const { reviews, stats } = dedupeReviews(input);
    expect(stats.identityConflictCount).toBe(2);
    expect(reviews.filter((r) => r.dedupeStatus === "identity-conflict")).toHaveLength(2);
  });

  it("marks unique reviews and includes them in analysis", () => {
    const input = [
      raw({ sourceReviewId: "a", body: "one" }),
      raw({ sourceReviewId: "b", body: "two" }),
    ];
    const { reviews, stats } = dedupeReviews(input);
    expect(stats.uniqueCount).toBe(2);
    expect(stats.duplicateCount).toBe(0);
    expect(reviews.every((r) => r.includedInAnalysis)).toBe(true);
  });

  it("generates stable review ids independent of input order", () => {
    const a = raw({ sourceReviewId: "x", body: "hello" });
    const b = raw({ sourceReviewId: "y", body: "world" });
    const r1 = dedupeReviews([a, b]).reviews;
    const r2 = dedupeReviews([b, a]).reviews;
    const idFor = (src: string) => r1.find((r) => r.sourceReviewId === src)?.reviewId;
    const idFor2 = (src: string) => r2.find((r) => r.sourceReviewId === src)?.reviewId;
    expect(idFor("x")).toBe(idFor2("x"));
    expect(idFor("y")).toBe(idFor2("y"));
    expect(idFor("x")).not.toBe(idFor("y"));
  });
});
