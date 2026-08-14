import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { RawReviewSchema, type RawReview } from "@/domain/contracts/review";
import type { SourceFile } from "./source-types";

export const MAX_IMPORT_REVIEWS = 1000;

export type ImportEvidence = {
  fileName: string;
  mediaType: "application/json" | "text/csv";
  byteLength: number;
  sha256: string;
  schemaVersion: string | null;
};

export type ImportParseResult = {
  reviews: RawReview[];
  rawRefs: string[];
  errors: string[];
  warnings: string[];
  /** Zero-based indices of exact-content duplicates kept for dedupe in prepare. */
  duplicateIndices: number[];
  /** Zero-based indices of identity conflicts (same id, conflicting body/rating). */
  conflictIndices: number[];
  evidence: ImportEvidence;
  /** The original imported file, archived at a fixed safe run-local path. */
  sourceFiles: SourceFile[];
};

type ImportInput = {
  fileName: string;
  mediaType: "application/json" | "text/csv";
  content: string;
};

const MAX_CONTENT_BYTES = 2_000_000;

/** UTF-8 byte length of a string (matches the documented byte limits). */
function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function contentKey(r: { body: string; rating: number; version: string | null; updatedAt: string | null }): string {
  return JSON.stringify({ body: r.body, rating: r.rating, version: r.version, updatedAt: r.updatedAt });
}

function toRawReview(id: string, row: Record<string, unknown>, source: "json-import" | "csv-import"): RawReview {
  const rating = Number(row.rating);
  const updatedAtRaw = row.updatedAt ? String(row.updatedAt) : null;
  let updatedAt: string | null = null;
  if (updatedAtRaw) {
    const d = new Date(updatedAtRaw);
    if (!Number.isNaN(d.getTime())) updatedAt = d.toISOString();
  }
  return RawReviewSchema.parse({
    sourceReviewId: id,
    source,
    title: row.title ? String(row.title) : "",
    body: String(row.body),
    rating,
    version: row.version ? String(row.version) : null,
    updatedAt,
  });
}

export function parseImportedReviews(input: ImportInput): ImportParseResult {
  const { fileName, mediaType, content } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const evidence: ImportEvidence = {
    fileName,
    mediaType,
    byteLength: byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    schemaVersion: null,
  };
  // The original file is archived at a fixed, safe run-local path (never the
  // user-supplied filename, which is kept only in evidence metadata).
  const archivePath = mediaType === "application/json" ? "sources/import/input.json" : "sources/import/input.csv";
  const sourceFiles: SourceFile[] = [{ relativePath: archivePath, content }];

  if (byteLength(content) > MAX_CONTENT_BYTES) {
    throw new Error(`Import content exceeds ${MAX_CONTENT_BYTES} bytes`);
  }

  const seen = new Map<string, string>(); // contentKey -> original id
  const seenIds = new Map<string, number>();
  const reviews: RawReview[] = [];
  const rawRefs: string[] = [];
  const duplicateIndices: number[] = [];
  const conflictIndices: number[] = [];

  if (mediaType === "application/json") {
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      errors.push("File is not valid JSON");
      return { reviews, rawRefs, errors, warnings, duplicateIndices, conflictIndices, evidence, sourceFiles };
    }
    const root = json as { schemaVersion?: unknown; reviews?: unknown };
    if (root.schemaVersion !== "1") {
      throw new Error("Unsupported import schemaVersion; expected \"1\"");
    }
    evidence.schemaVersion = String(root.schemaVersion);
    const list = root.reviews;
    if (!Array.isArray(list)) {
      errors.push("JSON root must contain a reviews array");
      return { reviews, rawRefs, errors, warnings, duplicateIndices, conflictIndices, evidence, sourceFiles };
    }
    if (list.length > MAX_IMPORT_REVIEWS) {
      throw new Error(`Import exceeds the ${MAX_IMPORT_REVIEWS} review limit`);
    }
    list.forEach((item, index) => {
      const row = item as Record<string, unknown>;
      const id = row.id ? String(row.id) : null;
      const body = row.body ? String(row.body) : "";
      if (!id) {
        errors.push(`row ${index + 1}: missing id`);
        return;
      }
      if (!body.trim()) {
        errors.push(`row ${index + 1}: missing body`);
        return;
      }
      const rating = Number(row.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        errors.push(`row ${index + 1}: invalid rating ${String(row.rating)}`);
        return;
      }
      // JSON v1 requires a parseable updatedAt per the documented schema.
      if (!row.updatedAt) {
        errors.push(`row ${index + 1}: missing required field updatedAt`);
        return;
      }
      let raw: RawReview;
      try {
        raw = toRawReview(id, { ...row, body, rating }, "json-import");
      } catch (err) {
        errors.push(`row ${index + 1}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const key = contentKey(raw);
      if (seen.has(key)) {
        duplicateIndices.push(index);
        warnings.push(`row ${index + 1}: content duplicate of ${seen.get(key)}`);
      }
      if (seenIds.has(id)) {
        conflictIndices.push(index);
        warnings.push(`row ${index + 1}: identity conflict with existing id ${id}`);
      }
      seen.set(key, id);
      seenIds.set(id, index);
      reviews.push(raw);
      rawRefs.push(`import:${fileName}#row-${index + 1}`);
    });
  } else {
    let records: Record<string, string>[];
    try {
      records = parse(content, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    } catch (err) {
      errors.push(`CSV parse failed: ${err instanceof Error ? err.message : String(err)}`);
      return { reviews, rawRefs, errors, warnings, duplicateIndices, conflictIndices, evidence, sourceFiles };
    }
    if (records.length > MAX_IMPORT_REVIEWS) {
      throw new Error(`Import exceeds the ${MAX_IMPORT_REVIEWS} review limit`);
    }
    const header = records[0] ?? {};
    const required = ["id", "body", "rating", "updatedAt"];
    for (const col of required) {
      if (!(col in header) && !Object.keys(header).some((k) => k.trim() === col)) {
        errors.push(`CSV missing required column: ${col}`);
      }
    }
    if (errors.length > 0) {
      return { reviews, rawRefs, errors, warnings, duplicateIndices, conflictIndices, evidence, sourceFiles };
    }
    records.forEach((row, index) => {
      const id = String(row.id ?? "").trim();
      const body = String(row.body ?? "");
      const rating = Number(row.rating);
      if (!id) {
        errors.push(`row ${index + 2}: missing id`);
        return;
      }
      if (!body.trim()) {
        errors.push(`row ${index + 2}: missing body`);
        return;
      }
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        errors.push(`row ${index + 2}: invalid rating ${String(row.rating)}`);
        return;
      }
      let raw: RawReview;
      try {
        raw = toRawReview(id, row, "csv-import");
      } catch (err) {
        errors.push(`row ${index + 2}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const key = contentKey(raw);
      if (seen.has(key)) {
        duplicateIndices.push(index);
        warnings.push(`row ${index + 2}: content duplicate of ${seen.get(key)}`);
      }
      if (seenIds.has(id)) {
        conflictIndices.push(index);
        warnings.push(`row ${index + 2}: identity conflict with existing id ${id}`);
      }
      seen.set(key, id);
      seenIds.set(id, index);
      reviews.push(raw);
      rawRefs.push(`import:${fileName}#row-${index + 2}`);
    });
  }

  return { reviews, rawRefs, errors, warnings, duplicateIndices, conflictIndices, evidence, sourceFiles };
}
