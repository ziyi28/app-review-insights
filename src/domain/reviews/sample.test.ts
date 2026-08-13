import { describe, it, expect } from "vitest";
import type { NormalizedReview } from "@/domain/contracts/review";
import { sampleReviews, ANALYSIS_SAMPLE_LIMIT } from "./sample";

function review(id: string, rating = 5, language: NormalizedReview["language"] = "en", body = "some review body text"): NormalizedReview {
  return {
    reviewId: id,
    sourceReviewId: id,
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: body,
    bodyNormalized: body.toLowerCase(),
    rating,
    version: null,
    updatedAt: null,
    language,
    rawRef: "raw:" + id,
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
  };
}

describe("sampleReviews", () => {
  it("returns the corpus unchanged when it is at or below the limit", () => {
    const reviews = [review("r1"), review("r2")];
    const result = sampleReviews(reviews);
    expect(result.applied).toBe(false);
    expect(result.selected).toBe(reviews); // same reference, no copy
    expect(result.artifact.selectedCount).toBe(2);
    expect(result.artifact.layers).toEqual([]);
  });

  it("selects exactly the limit from a larger corpus", () => {
    const reviews = Array.from({ length: 500 }, (_, i) => review(`r${i}`));
    const result = sampleReviews(reviews);
    expect(result.applied).toBe(true);
    expect(result.selected).toHaveLength(ANALYSIS_SAMPLE_LIMIT);
    expect(result.artifact.eligibleCount).toBe(500);
    expect(result.artifact.selectedCount).toBe(200);
    // Selections sum to the limit.
    expect(result.artifact.layers.reduce((s, l) => s + l.selected, 0)).toBe(200);
    // No review is selected twice.
    expect(new Set(result.artifact.selectedReviewIds).size).toBe(200);
  });

  it("preserves the original corpus order in the selected output", () => {
    const reviews = Array.from({ length: 250 }, (_, i) => review(`r${String(i).padStart(3, "0")}`));
    const result = sampleReviews(reviews);
    const positions = new Map(reviews.map((r, i) => [r.reviewId, i]));
    const selectedPositions = result.selected.map((r) => positions.get(r.reviewId)!);
    for (let i = 1; i < selectedPositions.length; i++) {
      expect(selectedPositions[i]).toBeGreaterThan(selectedPositions[i - 1]);
    }
  });

  it("keeps at least one review from every non-empty rating × language layer", () => {
    const reviews = [
      ...Array.from({ length: 300 }, (_, i) => review(`en5-${i}`, 5, "en")),
      ...Array.from({ length: 300 }, (_, i) => review(`zh1-${i}`, 1, "zh")),
      ...Array.from({ length: 300 }, (_, i) => review(`mix3-${i}`, 3, "mixed")),
    ];
    const result = sampleReviews(reviews, 200);
    const byLayer = new Map<string, number>();
    for (const l of result.artifact.layers) byLayer.set(`${l.rating}:${l.language}`, l.selected);
    expect(byLayer.get("5:en")).toBeGreaterThan(0);
    expect(byLayer.get("1:zh")).toBeGreaterThan(0);
    expect(byLayer.get("3:mixed")).toBeGreaterThan(0);
  });

  it("distributes the extra quota proportionally across larger layers", () => {
    // 900 en + 100 zh, limit 100. 9:1 ratio means en keeps ~90, zh ~10.
    const reviews = [
      ...Array.from({ length: 900 }, (_, i) => review(`en-${i}`, 5, "en")),
      ...Array.from({ length: 100 }, (_, i) => review(`zh-${i}`, 1, "zh")),
    ];
    const result = sampleReviews(reviews, 100);
    const byLayer = new Map(result.artifact.layers.map((l) => [`${l.rating}:${l.language}`, l.selected]));
    expect(byLayer.get("5:en")).toBeGreaterThan(80);
    expect(byLayer.get("1:zh")).toBeGreaterThanOrEqual(1);
    expect((byLayer.get("5:en") ?? 0) + (byLayer.get("1:zh") ?? 0)).toBe(100);
  });

  it("is deterministic across repeated runs", () => {
    const reviews = Array.from({ length: 300 }, (_, i) => review(`r${i}`, (i % 5) + 1, i % 2 === 0 ? "en" : "zh", `body ${i}`));
    const a = sampleReviews(reviews).selected.map((r) => r.reviewId);
    const b = sampleReviews(reviews).selected.map((r) => r.reviewId);
    expect(a).toEqual(b);
  });
});
