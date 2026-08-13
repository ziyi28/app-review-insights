import { z } from "zod";

/** Where a raw review came from. */
export const ReviewSourceSchema = z.enum([
  "apple-rss",
  "socialcrawl-app-store",
  "json-import",
  "csv-import",
]);
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

/** Stable dedupe classification after preparation. */
export const DedupeStatusSchema = z.enum(["unique", "duplicate", "identity-conflict"]);
export type DedupeStatus = z.infer<typeof DedupeStatusSchema>;

/** Language is a deterministic statistical label, never a semantic claim. */
export const LanguageTagSchema = z.enum(["en", "zh", "mixed", "other", "und"]);
export type LanguageTag = z.infer<typeof LanguageTagSchema>;

/** Raw review exactly as it arrived from a collector or importer. */
export const RawReviewSchema = z.object({
  sourceReviewId: z.string().min(1).max(512),
  source: ReviewSourceSchema,
  title: z.string().max(10_000).default(""),
  body: z.string().min(1).max(20_000),
  rating: z.number().int().min(1).max(5),
  version: z.string().max(128).nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
});
export type RawReview = z.infer<typeof RawReviewSchema>;

/** Normalized review that enters the analysis corpus. */
export const NormalizedReviewSchema = z.object({
  reviewId: z.string().min(1).max(128),
  sourceReviewId: z.string().min(1).max(512),
  source: ReviewSourceSchema,
  titleOriginal: z.string().max(10_000),
  bodyOriginal: z.string().max(20_000),
  bodyNormalized: z.string().max(20_000),
  rating: z.number().int().min(1).max(5),
  version: z.string().max(128).nullable(),
  updatedAt: z.string().datetime().nullable(),
  language: LanguageTagSchema,
  rawRef: z.string().max(512),
  includedInAnalysis: z.boolean(),
  dedupeStatus: DedupeStatusSchema,
  duplicateOf: z.string().max(128).nullable().default(null),
});
export type NormalizedReview = z.infer<typeof NormalizedReviewSchema>;
