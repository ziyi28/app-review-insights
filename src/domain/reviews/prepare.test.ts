import { describe, it, expect } from "vitest";
import type { RawReview } from "@/domain/contracts/review";
import { prepareReviews } from "./prepare";

function raw(partial: Partial<RawReview>): RawReview {
  return {
    sourceReviewId: "x",
    source: "apple-rss",
    title: "",
    body: "text",
    rating: 5,
    version: null,
    updatedAt: null,
    ...partial,
  };
}

describe("prepareReviews", () => {
  it("propagates suspect-empty limitation without reviews", () => {
    const out = prepareReviews({
      kind: "collected",
      reviews: [],
      rawRefs: [],
      limitations: [{ code: "RSS_SUSPECT_EMPTY", message: "empty", stage: "source" }],
    });
    expect(out.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
    expect(out.stats.includedCount).toBe(0);
  });

  it("keeps a SocialCrawl-collected review through normalization", () => {
    const out = prepareReviews({
      kind: "collected",
      reviews: [raw({ source: "socialcrawl-app-store", sourceReviewId: "sc-1", body: "Great workout" })],
      rawRefs: ["socialcrawl:req_x#review:sc-1"],
      limitations: [],
    });
    expect(out.reviews[0].source).toBe("socialcrawl-app-store");
    expect(out.reviews[0].sourceReviewId).toBe("sc-1");
    expect(out.stats.includedCount).toBe(1);
  });

  it("dedupes imported duplicates and keeps identity conflicts", () => {
    const parse = {
      reviews: [
        raw({ source: "json-import", sourceReviewId: "a", body: "same" }),
        raw({ source: "json-import", sourceReviewId: "b", body: "same" }),
        raw({ source: "json-import", sourceReviewId: "c", body: "different" }),
      ],
      rawRefs: ["import:x#row-1", "import:x#row-2", "import:x#row-3"],
      errors: [],
      warnings: ["row 2: content duplicate"],
      duplicateIndices: [1],
      conflictIndices: [],
      evidence: {
        fileName: "x.json",
        mediaType: "application/json" as const,
        byteLength: 10,
        sha256: "a".repeat(64),
        schemaVersion: "1",
      },
      sourceFiles: [{ relativePath: "sources/import/input.json", content: "{}" }],
    };
    const out = prepareReviews({ kind: "import", parse });
    expect(out.stats.duplicateCount).toBe(1);
    expect(out.stats.includedCount).toBe(2);
    expect(out.warnings).toHaveLength(1);
  });
});
