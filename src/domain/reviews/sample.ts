import { createHash } from "node:crypto";
import type { NormalizedReview } from "@/domain/contracts/review";

export const ANALYSIS_SAMPLE_LIMIT = 200;
export const ANALYSIS_SAMPLE_STRATEGY = "rating-language-stratified-v1" as const;

/** Per-layer selection counts persisted in the `analysis-sample` artifact. */
export type AnalysisSampleLayer = {
  rating: number;
  language: string;
  candidates: number;
  selected: number;
};

/** The `analysis-sample` artifact: how many reviews were eligible, selected,
 *  and which exact reviews the model stages saw. */
export type AnalysisSampleArtifact = {
  strategy: typeof ANALYSIS_SAMPLE_STRATEGY;
  eligibleCount: number;
  selectedCount: number;
  limit: number;
  selectedReviewIds: string[];
  layers: AnalysisSampleLayer[];
};

export type SampleResult = {
  /** The selected reviews, in their original corpus order. */
  selected: NormalizedReview[];
  artifact: AnalysisSampleArtifact;
  /** True when sampling actually reduced the corpus (eligible > limit). */
  applied: boolean;
};

function sortKey(reviewId: string): string {
  return createHash("sha256").update(reviewId).digest("hex");
}

/**
 * Deterministic rating × language stratified sample of the analysis corpus.
 *
 * Every non-empty rating/language layer keeps at least one review; the
 * remaining quota is distributed proportionally to layer size (largest
 * remainder). Within a layer reviews are ordered by the SHA-256 of their
 * reviewId so repeated runs pick the same members, then the selected reviews
 * are restored to their original corpus order. A corpus at or below the limit
 * is returned unchanged (applied=false) so the no-sampling path is byte-for-
 * byte identical to before.
 */
export function sampleReviews(reviews: NormalizedReview[], limit = ANALYSIS_SAMPLE_LIMIT): SampleResult {
  const eligibleCount = reviews.length;
  if (eligibleCount <= limit) {
    return {
      selected: reviews,
      artifact: {
        strategy: ANALYSIS_SAMPLE_STRATEGY,
        eligibleCount,
        selectedCount: eligibleCount,
        limit,
        selectedReviewIds: reviews.map((r) => r.reviewId),
        layers: [],
      },
      applied: false,
    };
  }

  // Group into rating × language layers, keeping corpus order within a layer.
  const layers = new Map<string, NormalizedReview[]>();
  for (const r of reviews) {
    const key = `${r.rating}:${r.language}`;
    let arr = layers.get(key);
    if (!arr) {
      arr = [];
      layers.set(key, arr);
    }
    arr.push(r);
  }
  const entries = [...layers.entries()].filter(([, list]) => list.length > 0);

  // Every non-empty layer starts with one guaranteed seat; the rest is
  // distributed proportionally with a largest-remainder correction. The loop
  // is robust to per-layer caps (a layer can never exceed its own size).
  const quota = new Map<string, number>();
  let remaining = limit;
  for (const [key] of entries) {
    quota.set(key, 1);
    remaining -= 1;
  }
  while (remaining > 0) {
    const open = entries.filter(([key]) => quota.get(key)! < layers.get(key)!.length);
    if (open.length === 0) break;
    const openTotal = open.reduce((s, [, list]) => s + list.length, 0);
    let allocatedNow = 0;
    for (const [key, list] of open) {
      const add = Math.floor((list.length / openTotal) * remaining);
      if (add > 0) {
        const next = Math.min(quota.get(key)! + add, list.length);
        allocatedNow += next - quota.get(key)!;
        quota.set(key, next);
      }
    }
    if (allocatedNow === 0) {
      // Fractional remainder too small to round up for any layer: give one
      // extra seat to the largest open layers until the quota is filled.
      const ordered = [...open].sort((a, b) => b[1].length - a[1].length);
      for (const [key, list] of ordered) {
        if (remaining <= 0) break;
        if (quota.get(key)! < list.length) {
          quota.set(key, quota.get(key)! + 1);
          remaining -= 1;
        }
      }
      break;
    }
    remaining -= allocatedNow;
  }

  // Pick members deterministically inside each layer (SHA-256 reviewId order).
  const selected: NormalizedReview[] = [];
  for (const [key, list] of layers) {
    const k = quota.get(key) ?? 0;
    if (k <= 0) continue;
    const sorted = [...list].sort((a, b) => (sortKey(a.reviewId) < sortKey(b.reviewId) ? -1 : sortKey(a.reviewId) > sortKey(b.reviewId) ? 1 : 0));
    selected.push(...sorted.slice(0, k));
  }

  // Restore the original corpus order.
  const chosen = new Set(selected.map((r) => r.reviewId));
  const ordered = reviews.filter((r) => chosen.has(r.reviewId));

  return {
    selected: ordered,
    artifact: {
      strategy: ANALYSIS_SAMPLE_STRATEGY,
      eligibleCount,
      selectedCount: ordered.length,
      limit,
      selectedReviewIds: ordered.map((r) => r.reviewId),
      layers: entries.map(([key, list]) => ({
        rating: list[0].rating,
        language: list[0].language,
        candidates: list.length,
        selected: quota.get(key)!,
      })),
    },
    applied: true,
  };
}
