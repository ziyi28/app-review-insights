import type { NormalizedReview } from "@/domain/contracts/review";

export type ReviewStats = {
  rawCount: number;
  includedCount: number;
  /** Reviews excluded from analysis (exact duplicates). */
  excludedCount: number;
  duplicateCount: number;
  identityConflictCount: number;
  /** Reviews whose body changed under normalization (Unicode/whitespace/case). */
  normalizedChangedCount: number;
  ratingDistribution: Record<number, number>;
  versionDistribution: Record<string, number>;
  languageDistribution: Record<string, number>;
  dateRange: { earliest: string | null; latest: string | null };
};

/** Deterministic aggregate statistics over the prepared corpus. */
export function computeStats(reviews: NormalizedReview[]): ReviewStats {
  const included = reviews.filter((r) => r.includedInAnalysis);
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const versionDistribution: Record<string, number> = {};
  const languageDistribution: Record<string, number> = {};

  let earliest: string | null = null;
  let latest: string | null = null;

  for (const r of included) {
    ratingDistribution[r.rating] += 1;
    versionDistribution[r.version ?? "(none)"] = (versionDistribution[r.version ?? "(none)"] ?? 0) + 1;
    languageDistribution[r.language] = (languageDistribution[r.language] ?? 0) + 1;
    if (r.updatedAt) {
      if (earliest === null || r.updatedAt < earliest) earliest = r.updatedAt;
      if (latest === null || r.updatedAt > latest) latest = r.updatedAt;
    }
  }

  return {
    rawCount: reviews.length,
    includedCount: included.length,
    excludedCount: reviews.filter((r) => !r.includedInAnalysis).length,
    duplicateCount: reviews.filter((r) => r.dedupeStatus === "duplicate").length,
    identityConflictCount: reviews.filter((r) => r.dedupeStatus === "identity-conflict").length,
    normalizedChangedCount: reviews.filter((r) => r.bodyOriginal !== r.bodyNormalized).length,
    ratingDistribution,
    versionDistribution,
    languageDistribution,
    dateRange: { earliest, latest },
  };
}
