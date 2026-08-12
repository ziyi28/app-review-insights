import type { RawReview } from "@/domain/contracts/review";

export type ParserWarning = {
  code: string;
  message: string;
  index?: number;
};

export type AppleRssParseResult = {
  reviews: RawReview[];
  warnings: ParserWarning[];
  /** Stable entry reference within the page, e.g. "entry-3". */
  rawRefs: string[];
};

function label(v: unknown): string | null {
  if (v && typeof v === "object" && "label" in (v as { label?: unknown })) {
    const l = (v as { label?: unknown }).label;
    if (typeof l === "string") return l;
  }
  return null;
}

/**
 * Parses one Apple Customer Reviews RSS JSON page into raw reviews.
 * Missing optional fields are warned about, never fatal. rawRefs entries are
 * stable per entry index so downstream evidence can point back into the page.
 */
export function parseAppleRssJson(body: string): AppleRssParseResult {
  const warnings: ParserWarning[] = [];
  const reviews: RawReview[] = [];
  const rawRefs: string[] = [];

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { reviews, warnings: [{ code: "INVALID_JSON", message: "response body is not valid JSON" }], rawRefs };
  }

  const feed = (json as { feed?: unknown })?.feed;
  if (!feed || typeof feed !== "object") {
    return { reviews, warnings: [{ code: "MISSING_FEED", message: "response has no feed object" }], rawRefs };
  }

  const entries = (feed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) {
    return { reviews, warnings: [{ code: "MISSING_ENTRIES", message: "feed.entry is not an array" }], rawRefs };
  }

  entries.forEach((entryRaw, index) => {
    if (!entryRaw || typeof entryRaw !== "object") {
      warnings.push({ code: "MALFORMED_ENTRY", message: `entry ${index} is not an object`, index });
      return;
    }
    const entry = entryRaw as Record<string, unknown>;

    const sourceReviewId = label(entry.id);
    if (!sourceReviewId) {
      warnings.push({ code: "MISSING_REVIEW_ID", message: `entry ${index} has no id.label`, index });
      return;
    }

    const ratingLabel = label(entry["im:rating"]);
    const rating = ratingLabel ? Number(ratingLabel) : NaN;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      warnings.push({ code: "INVALID_RATING", message: `entry ${index} has invalid rating`, index });
      return;
    }

    const body = label(entry.content) ?? "";
    if (!body.trim()) {
      warnings.push({ code: "EMPTY_BODY", message: `entry ${index} has no content`, index });
      return;
    }

    const updatedAtRaw = label(entry.updated);
    let updatedAt: string | null = null;
    if (updatedAtRaw) {
      const asDate = new Date(updatedAtRaw);
      if (!Number.isNaN(asDate.getTime())) {
        updatedAt = asDate.toISOString();
      } else {
        warnings.push({ code: "INVALID_DATE", message: `entry ${index} has unparseable date`, index });
      }
    }

    const review: RawReview = {
      sourceReviewId,
      source: "apple-rss",
      title: label(entry.title) ?? "",
      body,
      rating,
      version: label(entry["im:version"]),
      updatedAt,
    };
    reviews.push(review);
    rawRefs.push(`entry-${index}`);
  });

  return { reviews, warnings, rawRefs };
}
