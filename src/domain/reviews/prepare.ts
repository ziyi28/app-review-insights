import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import type { Limitation } from "@/server/sources/source-types";
import type { ImportParseResult } from "@/server/sources/import-parser";
import { dedupeReviews } from "./dedupe";
import { computeStats, type ReviewStats } from "./stats";

export type PreparedReviews = {
  reviews: NormalizedReview[];
  stats: ReviewStats;
  limitations: Limitation[];
  warnings: string[];
};

type SourceBundle = {
  rawReviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  warnings: string[];
};

function bundleFromCollected(
  reviews: RawReview[],
  rawRefs: string[],
  limitations: Limitation[],
): SourceBundle {
  return { rawReviews: reviews, rawRefs, limitations, warnings: [] };
}

function bundleFromImport(parse: ImportParseResult): SourceBundle {
  const limitations: Limitation[] = [];
  for (const err of parse.errors) {
    limitations.push({ code: "IMPORT_ERROR", message: err, stage: "source" });
  }
  return {
    rawReviews: parse.reviews,
    rawRefs: parse.rawRefs,
    limitations,
    warnings: parse.warnings,
  };
}

/**
 * Builds the prepared review corpus from a source outcome. The "collected"
 * branch is provider-neutral: it carries reviews from Apple RSS or SocialCrawl
 * alike, so source limitations (suspect-empty, partial, import errors)
 * propagate verbatim for downstream findings, PRD and tests to inherit.
 */
export function prepareReviews(
  input:
    | { kind: "collected"; reviews: RawReview[]; rawRefs: string[]; limitations: Limitation[] }
    | { kind: "import"; parse: ImportParseResult },
): PreparedReviews {
  const bundle =
    input.kind === "collected"
      ? bundleFromCollected(input.reviews, input.rawRefs, input.limitations)
      : bundleFromImport(input.parse);

  const deduped = dedupeReviews(bundle.rawReviews, bundle.rawRefs);
  const stats = computeStats(deduped.reviews);

  return {
    reviews: deduped.reviews,
    stats,
    limitations: bundle.limitations,
    warnings: bundle.warnings,
  };
}
