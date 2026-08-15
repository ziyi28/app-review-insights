import type { NormalizedReview } from "@/domain/contracts/review";

export function isExactExcerpt(excerpt: string, bodyNormalized: string): boolean {
  const e = excerpt.trim();
  if (!e) return false;
  // Exact substring match against the normalized body (same whitespace fold).
  return bodyNormalized.includes(e) || bodyNormalized.includes(e.toLowerCase());
}

export type CitationCheck = {
  valid: boolean;
  invalid: { reviewId: string; reason: string }[];
};

export function validateCitations(
  citations: { reviewId: string; excerpt: string }[],
  reviews: Map<string, NormalizedReview>,
): CitationCheck {
  const invalid: { reviewId: string; reason: string }[] = [];
  for (const c of citations) {
    const review = reviews.get(c.reviewId);
    if (!review) {
      invalid.push({ reviewId: c.reviewId, reason: "review does not exist" });
      continue;
    }
    if (!isExactExcerpt(c.excerpt, review.bodyNormalized)) {
      invalid.push({ reviewId: c.reviewId, reason: "excerpt is not an exact substring" });
    }
  }
  return { valid: invalid.length === 0, invalid };
}

/** Returns the set of review ids reachable from a list of findings. */
export function reviewIdsFromFindings(findings: { supportingReviewIds: string[] }[]): string[] {
  const ids = new Set<string>();
  for (const f of findings) {
    for (const id of f.supportingReviewIds) ids.add(id);
  }
  return [...ids];
}

/**
 * Resolves overlap between supporting and conflicting review citations.
 * When a review is cited in both sets, the conservative policy removes it from
 * supporting and keeps it in conflicting, preventing inflated positive support.
 */
export function resolveSupportConflictOverlap(
  supportingReviewIds: string[],
  conflictingReviewIds: string[],
): { supporting: string[]; conflicting: string[]; removed: string[] } {
  const conflictSet = new Set(conflictingReviewIds);
  const removed = supportingReviewIds.filter((id) => conflictSet.has(id));
  const supporting = supportingReviewIds.filter((id) => !conflictSet.has(id));
  return { supporting, conflicting: conflictingReviewIds, removed };
}

