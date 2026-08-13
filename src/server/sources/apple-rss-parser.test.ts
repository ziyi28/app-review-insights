import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAppleRssJson } from "./apple-rss-parser";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "apple", name), "utf8");
}

describe("parseAppleRssJson", () => {
  it("parses a page with two reviews and preserves raw evidence", () => {
    const result = parseAppleRssJson(fixture("page-01.json"));
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({
      sourceReviewId: "8435931487",
      source: "apple-rss",
      rating: 5,
      version: "3.2.1",
      title: "Great workout app",
    });
    expect(result.reviews[0].updatedAt).toBeTruthy();
    expect(result.warnings).toHaveLength(0);
  });

  it("returns an empty result for an empty feed without warnings", () => {
    const result = parseAppleRssJson(fixture("empty-feed.json"));
    expect(result.reviews).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("treats a feed with no entry property as an empty feed", () => {
    const result = parseAppleRssJson(fixture("empty-feed-no-entry.json"));
    expect(result.reviews).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns and skips entries with a missing rating", () => {
    const input = JSON.parse(fixture("page-01.json"));
    delete input.feed.entry[0]["im:rating"];
    const result = parseAppleRssJson(JSON.stringify(input));
    expect(result.reviews).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("does not crash on a malformed feed structure", () => {
    const result = parseAppleRssJson(fixture("malformed-feed.json"));
    expect(result.reviews).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("flags non-numeric rating as a warning and skips it", () => {
    const input = JSON.parse(fixture("page-01.json"));
    input.feed.entry[1]["im:rating"] = { label: "not-a-number" };
    const result = parseAppleRssJson(JSON.stringify(input));
    expect(result.reviews).toHaveLength(1);
    expect(result.warnings.some((w) => w.code === "INVALID_RATING")).toBe(true);
  });

  it("parses the last page number from feed.link[rel=last]", () => {
    const result = parseAppleRssJson(fixture("page-01.json"));
    expect(result.lastPage).toBe(10);
  });

  it("reports null lastPage when the feed has no last link", () => {
    const result = parseAppleRssJson(fixture("empty-feed.json"));
    expect(result.lastPage).toBeNull();
  });

  it("reports null lastPage when the last link has no page number", () => {
    const result = parseAppleRssJson(fixture("empty-feed-no-entry.json"));
    expect(result.lastPage).toBeNull();
  });

  it("treats an invalid-json body as having no last page", () => {
    const result = parseAppleRssJson("<html>not a feed</html>");
    expect(result.lastPage).toBeNull();
  });
});
