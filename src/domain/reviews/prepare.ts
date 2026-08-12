import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import type { Limitation } from "@/server/sources/apple-rss-collector";
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

function bundleFromApple(
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
 * Builds the prepared review corpus from a source outcome. Source limitations
 * (suspect-empty, partial, import errors) propagate verbatim so downstream
 * findings, PRD and tests inherit the data caveats.
 */
export function prepareReviews(
  input:
    | { kind: "apple-rss"; reviews: RawReview[]; rawRefs: string[]; limitations: Limitation[] }
    | { kind: "import"; parse: ImportParseResult },
): PreparedReviews {
  const bundle =
    input.kind === "apple-rss"
      ? bundleFromApple(input.reviews, input.rawRefs, input.limitations)
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
