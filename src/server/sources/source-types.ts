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
