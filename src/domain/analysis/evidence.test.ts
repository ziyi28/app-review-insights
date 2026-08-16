import { describe, it, expect } from "vitest";
import type { NormalizedReview } from "@/domain/contracts/review";
import { isExactExcerpt, resolveSupportConflictOverlap, validateCitations } from "./evidence";

function reviewMap(entries: [string, string][]): Map<string, NormalizedReview> {
  return new Map(
    entries.map(([id, body]) => [
      id,
      {
        reviewId: id,
        sourceReviewId: id,
        source: "apple-rss",
        titleOriginal: "",
        bodyOriginal: body,
        bodyNormalized: body,
        rating: 5,
        version: null,
        updatedAt: null,
        language: "en",
        rawRef: "raw:" + id,
        includedInAnalysis: true,
        dedupeStatus: "unique",
        duplicateOf: null,
      } satisfies NormalizedReview,
    ]),
  );
}

describe("evidence", () => {
  it("confirms an exact excerpt is a substring of the body", () => {
    expect(isExactExcerpt("too expensive for me", "the price is too expensive for me to justify")).toBe(true);
  });

  it("accepts an excerpt whose whitespace differs from the folded body", () => {
    // Both sides get the same NFC + whitespace fold, so quotes spanning line
    // breaks or doubled spaces are legitimate.
    expect(isExactExcerpt("too expensive\nfor me", "the price is too expensive for me to justify")).toBe(true);
    expect(isExactExcerpt("too  expensive   for me", "the price is too expensive for me to justify")).toBe(true);
  });

  it("rejects a fabricated excerpt", () => {
    expect(isExactExcerpt("this was never said", "the price is too expensive")).toBe(false);
  });

  it("validates citations against a review map", () => {
    const reviews = reviewMap([["r1", "love the app"]]);
    const report = validateCitations([{ reviewId: "r1", excerpt: "love the app" }], reviews);
    expect(report.valid).toBe(true);
    expect(report.invalid).toHaveLength(0);
  });

  it("flags missing review ids and non-exact excerpts", () => {
    const reviews = reviewMap([["r1", "love the app"]]);
    const report = validateCitations(
      [
        { reviewId: "ghost", excerpt: "love the app" },
        { reviewId: "r1", excerpt: "not in the body" },
      ],
      reviews,
    );
    expect(report.valid).toBe(false);
    expect(report.invalid).toHaveLength(2);
  });

  it("resolves support/conflict overlap by retaining in conflicting and removing from supporting", () => {
    const { supporting, conflicting, removed } = resolveSupportConflictOverlap(
      ["r1", "r2", "r3"],
      ["r2", "r4"],
    );
    expect(supporting).toEqual(["r1", "r3"]);
    expect(conflicting).toEqual(["r2", "r4"]);
    expect(removed).toEqual(["r2"]);
  });
});

