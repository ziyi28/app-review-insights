import type { NormalizedReview } from "@/domain/contracts/review";

/**
 * Cleaning detail counts for the UI: how many reviews were actually changed by
 * each deterministic normalization step, plus the language/dedupe tallies that
 * make the cleaning stage explainable. These are pure counts over the prepared
 * corpus — the normalization rules themselves live in `normalize.ts`/`dedupe.ts`.
 */
export type CleaningDetails = {
  unicodeNormalizedCount: number;
  whitespaceCollapsedCount: number;
  caseFoldedCount: number;
  languageLabels: { tag: string; count: number }[];
  exactDuplicateRemovedCount: number;
  identityConflictCount: number;
  keptShortUniqueCount: number;
};

/**
 * Reports which normalization steps changed a given original body relative to
 * its normalized form. Each step is judged against the previous step's output,
 * mirroring the exact pipeline order in `normalizeBody`:
 * NFC normalize → line-ending + whitespace collapse + trim → lowercase fold.
 */
export function bodyChangeKinds(original: string): {
  unicodeNormalized: boolean;
  whitespaceCollapsed: boolean;
  caseFolded: boolean;
} {
  const nfc = original.normalize("NFC");
  const unicodeNormalized = nfc !== original;
  const wsCollapsed = nfc
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  const whitespaceCollapsed = wsCollapsed !== nfc;
  const caseFolded = wsCollapsed.toLowerCase() !== wsCollapsed;
  return { unicodeNormalized, whitespaceCollapsed, caseFolded };
}

/** Aggregate cleaning counts over a prepared corpus. */
export function computeCleaningDetails(reviews: NormalizedReview[]): CleaningDetails {
  let unicodeNormalizedCount = 0;
  let whitespaceCollapsedCount = 0;
  let caseFoldedCount = 0;
  const languageCounts = new Map<string, number>();
  let exactDuplicateRemovedCount = 0;
  let identityConflictCount = 0;
  let keptShortUniqueCount = 0;

  for (const r of reviews) {
    const kinds = bodyChangeKinds(r.bodyOriginal);
    if (kinds.unicodeNormalized) unicodeNormalizedCount += 1;
    if (kinds.whitespaceCollapsed) whitespaceCollapsedCount += 1;
    if (kinds.caseFolded) caseFoldedCount += 1;
    languageCounts.set(r.language, (languageCounts.get(r.language) ?? 0) + 1);
    if (r.dedupeStatus === "duplicate") exactDuplicateRemovedCount += 1;
    if (r.dedupeStatus === "identity-conflict") identityConflictCount += 1;
    if (r.includedInAnalysis && r.bodyOriginal.length < 40) keptShortUniqueCount += 1;
  }

  return {
    unicodeNormalizedCount,
    whitespaceCollapsedCount,
    caseFoldedCount,
    languageLabels: [...languageCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    exactDuplicateRemovedCount,
    identityConflictCount,
    keptShortUniqueCount,
  };
}
