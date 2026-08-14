import type { RawReview } from "@/domain/contracts/review";

/** A bounded, user-readable source caveat attached to a collection result. */
export type Limitation = {
  code: string;
  message: string;
  stage: string;
};

/** How much of the requested dataset was collected. */
export type CollectionStatus = "complete" | "suspect-empty" | "partial" | "failed";

/**
 * A raw source payload (response body / imported file) to archive inside the
 * run snapshot. `relativePath` is a run-local, safe path under `sources/`
 * (e.g. `sources/apple/page-01.attempt-01.json`); `content` is the exact bytes
 * as text. Only the archive code may write these; the browser API never exposes
 * them.
 */
export type SourceFile = {
  relativePath: string;
  content: string;
};

/**
 * Provider-neutral collection outcome shared by the Apple RSS collector and the
 * SocialCrawl collector. `evidence` carries provider-specific, secret-free
 * metadata (request counts, freshness signals, request id…).
 */
export type CollectionResult<TEvidence> = {
  status: CollectionStatus;
  reviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  evidence: TEvidence;
};
