import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseImportedReviews } from "./import-parser";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "imports", name), "utf8");
}

describe("parseImportedReviews (JSON)", () => {
  it("parses a mixed-language json import and flags content duplicates", () => {
    const result = parseImportedReviews({
      fileName: "mixed-reviews.json",
      mediaType: "application/json",
      content: fixture("mixed-reviews.json"),
    });
    expect(result.reviews).toHaveLength(4);
    expect(result.duplicateIndices).toContain(2);
    expect(result.conflictIndices).toContain(3);
  });

  it("rejects a json file with an unknown schemaVersion", () => {
    const content = fixture("mixed-reviews.json").replace('"schemaVersion": "1"', '"schemaVersion": "9"');
    expect(() =>
      parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content }),
    ).toThrow(/schemaVersion/);
  });

  it("reports an error when the file is not valid JSON", () => {
    const result = parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content: "{ not json" });
    expect(result.errors.some((e) => e.includes("not valid JSON"))).toBe(true);
    expect(result.reviews).toHaveLength(0);
  });

  it("reports an error when the JSON root has no reviews array", () => {
    const content = JSON.stringify({ schemaVersion: "1", reviews: "nope" });
    const result = parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content });
    expect(result.errors.some((e) => e.includes("reviews array"))).toBe(true);
    expect(result.reviews).toHaveLength(0);
  });

  it("rejects a missing body with a row error", () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [{ id: "r1", rating: 5 }],
    });
    const result = parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.reviews).toHaveLength(0);
  });

  it("enforces a maximum review count", () => {
    const reviews = Array.from({ length: 1001 }, (_, i) => ({
      id: `r${i}`,
      body: "x".repeat(10),
      rating: 5,
      updatedAt: "2026-07-01T00:00:00Z",
    }));
    const content = JSON.stringify({ schemaVersion: "1", reviews });
    expect(() =>
      parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content }),
    ).toThrow(/1000/);
  });

  it("rejects a JSON row missing the required updatedAt", () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [{ id: "r1", body: "ok body", rating: 5 }],
    });
    const result = parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content });
    expect(result.reviews).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("updatedAt"))).toBe(true);
  });

  it("rejects a JSON row that violates RawReviewSchema (oversized body)", () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [{ id: "r1", body: "x".repeat(20_001), rating: 5, updatedAt: "2026-07-01T00:00:00Z" }],
    });
    const result = parseImportedReviews({ fileName: "x.json", mediaType: "application/json", content });
    expect(result.reviews).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("measures byte length as UTF-8 bytes for multi-byte content", () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [{ id: "r1", body: "订阅费太贵", rating: 1, updatedAt: "2026-07-01T00:00:00Z" }],
    });
    const result = parseImportedReviews({ fileName: "zh.json", mediaType: "application/json", content });
    expect(result.evidence.byteLength).toBe(Buffer.byteLength(content, "utf8"));
  });
});

describe("parseImportedReviews (CSV)", () => {
  it("parses a csv import into raw reviews", () => {
    const result = parseImportedReviews({
      fileName: "mixed-reviews.csv",
      mediaType: "text/csv",
      content: fixture("mixed-reviews.csv"),
    });
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews[1]).toMatchObject({ sourceReviewId: "csv-2", rating: 1 });
  });

  it("reports a row-level error for a missing required column", () => {
    const content = "id,title\nr1,hello";
    const result = parseImportedReviews({ fileName: "x.csv", mediaType: "text/csv", content });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.reviews).toHaveLength(0);
  });

  it("rejects an invalid rating with a row error", () => {
    const content = "id,body,rating\nr1,hi,11";
    const result = parseImportedReviews({ fileName: "x.csv", mediaType: "text/csv", content });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.reviews).toHaveLength(0);
  });

  it("reports a CSV parse failure as an error", () => {
    // Unterminated quoted field makes csv-parse throw.
    const content = 'id,body,rating\nr1,"unterminated,5';
    const result = parseImportedReviews({ fileName: "bad.csv", mediaType: "text/csv", content });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.reviews).toHaveLength(0);
  });

  it("flags CSV duplicates and identity conflicts", () => {
    const content = [
      "id,title,body,rating,version,updatedAt,language",
      "csv-1,Great,Love the workout,5,3.2.1,2026-07-01T10:00:00Z,en",
      "csv-1,Changed,Love the workout,5,3.2.1,2026-07-01T10:00:00Z,en",
      "csv-2,Other,Too expensive now,1,3.2.0,2026-07-02T10:00:00Z,en",
      "csv-1,Changed,Too expensive now,1,3.2.0,2026-07-03T10:00:00Z,en",
    ].join("\n");
    const result = parseImportedReviews({ fileName: "dup.csv", mediaType: "text/csv", content });
    // csv-1 identical content -> duplicate; csv-1 different content -> conflict
    expect(result.duplicateIndices).toContain(1);
    expect(result.conflictIndices).toContain(3);
  });

  it("rejects a CSV row that violates RawReviewSchema (oversized body)", () => {
    const content = `id,body,rating,updatedAt\nr1,${"x".repeat(20_001)},5,2026-07-01T10:00:00Z`;
    const result = parseImportedReviews({ fileName: "big.csv", mediaType: "text/csv", content });
    expect(result.reviews).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("produces import evidence with size and hash", () => {
    const content = fixture("mixed-reviews.csv");
    const result = parseImportedReviews({ fileName: "mixed-reviews.csv", mediaType: "text/csv", content });
    expect(result.evidence).toMatchObject({ fileName: "mixed-reviews.csv", mediaType: "text/csv" });
    expect(result.evidence.byteLength).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.evidence.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("import date validation", () => {
  it("rejects a JSON row with an unparseable updatedAt and keeps valid rows", () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [
        { id: "r1", body: "bad date row", rating: 5, updatedAt: "not-a-date" },
        { id: "r2", body: "valid row", rating: 5, updatedAt: "2026-07-01T00:00:00Z" },
      ],
    });
    const result = parseImportedReviews({ fileName: "dates.json", mediaType: "application/json", content });
    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["r2"]);
    expect(result.errors.some((e) => e.includes("row 1") && e.includes("invalid updatedAt"))).toBe(true);
  });

  it("treats an empty-string updatedAt as an invalid date in JSON", () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [{ id: "r1", body: "empty date", rating: 5, updatedAt: "" }],
    });
    const result = parseImportedReviews({ fileName: "dates.json", mediaType: "application/json", content });
    expect(result.reviews).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("updatedAt"))).toBe(true);
  });

  it("rejects a CSV row with an unparseable updatedAt with the right row number", () => {
    const content = [
      "id,title,body,rating,version,updatedAt,language",
      "csv-1,Great,Love the workout,5,3.2.1,2026-07-01T10:00:00Z,en",
      "csv-2,Other,Too expensive,1,3.2.0,not-a-date,en",
      "csv-3,Good,Nice app,4,3.2.0,2026-07-03T10:00:00Z,en",
    ].join("\n");
    const result = parseImportedReviews({ fileName: "dates.csv", mediaType: "text/csv", content });
    // Header is data row 1; csv-1 is row 2, csv-2 is row 3.
    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["csv-1", "csv-3"]);
    expect(result.errors.some((e) => e.includes("row 3") && e.includes("invalid updatedAt"))).toBe(true);
  });

  it("treats a missing updatedAt in a CSV row as an invalid-date row error", () => {
    const content = [
      "id,title,body,rating,version,updatedAt,language",
      "csv-1,Great,Love the workout,5,3.2.1,,en",
    ].join("\n");
    const result = parseImportedReviews({ fileName: "dates.csv", mediaType: "text/csv", content });
    expect(result.reviews).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("updatedAt"))).toBe(true);
  });

  it.each([
    "2026-02-30T10:00:00Z",
    "01/02/2026",
    "1",
    "2026-07-01",
    "2026-07-01T10:00:00",
  ])("rejects non-contract updatedAt %s", (updatedAt) => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [
        { id: "bad", body: "bad date", rating: 1, updatedAt },
        {
          id: "good",
          body: "valid date",
          rating: 5,
          updatedAt: "2026-07-01T10:00:00Z",
        },
      ],
    });

    const result = parseImportedReviews({
      fileName: "dates.json",
      mediaType: "application/json",
      content,
    });

    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["good"]);
    expect(result.errors).toContain("row 1: invalid updatedAt");
  });

  it("accepts an ISO datetime with an explicit offset and normalizes to UTC", () => {
    const content = [
      "id,body,rating,updatedAt",
      "r1,valid offset,5,2026-07-01T18:00:00+08:00",
    ].join("\n");

    const result = parseImportedReviews({
      fileName: "offset.csv",
      mediaType: "text/csv",
      content,
    });

    expect(result.errors).toEqual([]);
    expect(result.reviews[0].updatedAt).toBe("2026-07-01T10:00:00.000Z");
  });
});

describe("CSV unknown columns", () => {
  it("warns once per unknown column without entering RawReview", () => {
    const content = [
      "id,title,body,rating,version,updatedAt,language,deviceModel",
      "csv-1,Great,Love the workout,5,3.2.1,2026-07-01T10:00:00Z,en,iPhone 15",
      "csv-2,Good,Nice app,4,3.2.0,2026-07-02T10:00:00Z,en,Android",
    ].join("\n");
    const result = parseImportedReviews({ fileName: "unknown.csv", mediaType: "text/csv", content });
    // The unknown column is warned exactly once, not once per row.
    expect(result.warnings.filter((w) => w.includes("CSV unknown column ignored: deviceModel"))).toHaveLength(1);
    expect(result.reviews).toHaveLength(2);
    // The unknown value must never reach the RawReview.
    for (const r of result.reviews) {
      expect(JSON.stringify(r)).not.toContain("iPhone 15");
      expect(JSON.stringify(r)).not.toContain("Android");
    }
  });
});
