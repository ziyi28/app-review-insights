import { describe, it, expect } from "vitest";
import type { NormalizedReview } from "@/domain/contracts/review";
import { bodyChangeKinds, computeCleaningDetails } from "./cleaning";

function review(partial: Partial<NormalizedReview>): NormalizedReview {
  return {
    reviewId: "r1",
    sourceReviewId: "s1",
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: "text",
    bodyNormalized: "text",
    rating: 5,
    version: null,
    updatedAt: null,
    language: "en",
    rawRef: "raw:s1",
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
    ...partial,
  };
}

describe("bodyChangeKinds", () => {
  it("detects unicode normalization independently", () => {
    const decomposed = "café"; // é as combining acute
    const kinds = bodyChangeKinds(decomposed);
    expect(kinds.unicodeNormalized).toBe(true);
    expect(kinds.whitespaceCollapsed).toBe(false);
    expect(kinds.caseFolded).toBe(false);
  });

  it("detects whitespace collapse", () => {
    const kinds = bodyChangeKinds("  Great\t\n App!  ");
    expect(kinds.whitespaceCollapsed).toBe(true);
    expect(kinds.unicodeNormalized).toBe(false);
  });

  it("detects case folding", () => {
    const kinds = bodyChangeKinds("GREAT APP");
    expect(kinds.caseFolded).toBe(true);
    expect(kinds.unicodeNormalized).toBe(false);
    expect(kinds.whitespaceCollapsed).toBe(false);
  });
});

describe("computeCleaningDetails", () => {
  it("counts zero-changed corpora without over-reporting", () => {
    const d = computeCleaningDetails([
      review({ bodyOriginal: "same", bodyNormalized: "same" }),
      review({ bodyOriginal: "identical", bodyNormalized: "identical" }),
    ]);
    expect(d.unicodeNormalizedCount).toBe(0);
    expect(d.whitespaceCollapsedCount).toBe(0);
    expect(d.caseFoldedCount).toBe(0);
    expect(d.exactDuplicateRemovedCount).toBe(0);
    expect(d.identityConflictCount).toBe(0);
  });

  it("counts each normalization step's affected reviews", () => {
    const d = computeCleaningDetails([
      review({ bodyOriginal: "  HELLO  ", bodyNormalized: "hello" }), // ws + case
      review({ bodyOriginal: "World", bodyNormalized: "world" }), // case only
      review({ bodyOriginal: "ok", bodyNormalized: "ok" }), // unchanged
    ]);
    expect(d.whitespaceCollapsedCount).toBe(1);
    expect(d.caseFoldedCount).toBe(2);
    expect(d.unicodeNormalizedCount).toBe(0);
  });

  it("tallies exact duplicates, identity conflicts and kept short uniques", () => {
    const d = computeCleaningDetails([
      review({ dedupeStatus: "duplicate", includedInAnalysis: false }),
      review({ dedupeStatus: "identity-conflict", bodyOriginal: "short", bodyNormalized: "short" }),
      review({ dedupeStatus: "unique", bodyOriginal: "short", bodyNormalized: "short" }),
      review({ dedupeStatus: "unique", bodyOriginal: "a much longer unique review body that is definitely not short", bodyNormalized: "a much longer unique review body that is definitely not short" }),
    ]);
    expect(d.exactDuplicateRemovedCount).toBe(1);
    expect(d.identityConflictCount).toBe(1);
    // Both the short unique review and the short identity-conflict review are
    // kept for analysis (includedInAnalysis), so 2 short reviews survive.
    expect(d.keptShortUniqueCount).toBe(2);
  });

  it("sorts language labels by frequency", () => {
    const d = computeCleaningDetails([
      review({ language: "zh" }),
      review({ language: "zh" }),
      review({ language: "en" }),
    ]);
    expect(d.languageLabels).toEqual([
      { tag: "zh", count: 2 },
      { tag: "en", count: 1 },
    ]);
  });
});
