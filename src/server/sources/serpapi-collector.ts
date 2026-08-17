import { z } from "zod";
import type { RawReview } from "@/domain/contracts/review";
import type { CollectionResult, Limitation } from "./source-types";

/** Application-layer cap on the live sample (most recent 500). */
export const SERPAPI_REVIEW_LIMIT = 500;
/** Hard cap on paginated requests; each page may count as one paid search. */
export const SERPAPI_MAX_PAGES = 20;

export type SerpApiCollectorDeps = {
  fetchFn: typeof fetch;
  now: () => string;
  baseUrl: string;
  apiKey: string;
  appId: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxPages?: number;
  /** Upper bound on the collected sample (100/300/500); default 500. */
  reviewLimit?: number;
};

/**
 * Secret-free request evidence for a SerpApi Apple Reviews collection. The API
 * key and the request URL are deliberately absent; only stable metadata that a
 * user or a report can act on is kept.
 */
export type SerpApiEvidence = {
  provider: "serpapi";
  endpoint: "/search.json";
  engine: "apple_reviews";
  country: "us";
  sort: "mostrecent";
  noCache: true;
  startedAt: string;
  finishedAt: string;
  httpStatus: number | null;
  requestCount: number;
  pagesFetched: number;
  searchIds: string[];
  parserDropped: number;
};

export type SerpApiCollectionResult = CollectionResult<SerpApiEvidence>;

/** Envelope fields this application actually uses; unknown fields are stripped. */
const EnvelopeSchema = z.object({
  search_metadata: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  reviews: z.array(z.unknown()).optional(),
  serpapi_pagination: z.object({ next: z.string().optional() }).optional(),
});

const ReviewItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  text: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  review_date: z.string().optional(),
  reviewed_version: z.string().optional(),
});
type SerpApiReviewItem = z.infer<typeof ReviewItemSchema>;

/** 400/401/403/429/500/503 + network + timeout + abort + malformed. */
const ERROR_CODE_BY_STATUS: Record<number, string> = {
  400: "SERPAPI_INVALID_REQUEST",
  401: "SERPAPI_AUTH_FAILED",
  403: "SERPAPI_AUTH_FAILED",
  429: "SERPAPI_RATE_OR_QUOTA_EXHAUSTED",
  500: "SERPAPI_UPSTREAM_FAILED",
  503: "SERPAPI_UPSTREAM_FAILED",
};

/**
 * Collects up to 500 of the most recent US App Store reviews through SerpApi's
 * Apple Reviews engine. Every request is forced-fresh (`no_cache=true`) and
 * fixed to `country=us` + `sort=mostrecent`. There is NO automatic retry: a
 * network result is uncertain, so repeating a `no_cache=true` request could
 * create extra paid searches. A user can explicitly re-check instead.
 *
 * Pagination trusts only the *existence* of `serpapi_pagination.next` as a
 * continue signal; the next page URL is always rebuilt from the trusted
 * `baseUrl`, never followed. Each page is validated independently; a malformed
 * item drops that item (counted as `parserDropped`) without discarding valid
 * reviews. A first-page failure is `failed`; a later-page failure keeps the
 * collected pages as `partial`. A successful empty first page is
 * `suspect-empty`, never "no reviews".
 */
export async function collectSerpApiReviews(deps: SerpApiCollectorDeps): Promise<SerpApiCollectionResult> {
  const { fetchFn, now, baseUrl, apiKey, appId, timeoutMs, signal } = deps;
  const maxPages = Math.min(deps.maxPages ?? SERPAPI_MAX_PAGES, SERPAPI_MAX_PAGES);
  const reviewLimit = Math.min(deps.reviewLimit ?? SERPAPI_REVIEW_LIMIT, SERPAPI_REVIEW_LIMIT);
  const startedAt = now();
  const reviews: RawReview[] = [];
  const rawRefs: string[] = [];
  const limitations: Limitation[] = [];
  const searchIds: string[] = [];
  let httpStatus: number | null = null;
  let parserDropped = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchPage(page);
    pagesFetched += 1;
    if (result === null) {
      // A first-page failure leaves nothing usable; a later-page failure keeps
      // the collected pages as partial (RSS is never mixed in).
      if (page === 1) {
        return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
      }
      limitations.push({ code: "SERPAPI_PARTIAL", message: "SerpApi review collection stopped after a page failure; collected pages were kept", stage: "source" });
      return { status: "partial", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    const { pageReviews, nextExists, dropped, suspectEmpty } = result;

    parserDropped += dropped;
    reviews.push(...pageReviews);
    rawRefs.push(...pageReviews.map((r) => `serpapi:${searchIds.at(-1) ?? "unknown"}#review:${r.sourceReviewId}`));

    if (suspectEmpty) {
      limitations.push({ code: "SERPAPI_EMPTY", message: "SerpApi returned no valid reviews; availability is uncertain", stage: "source" });
      return { status: "suspect-empty", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    if (dropped > 0) {
      limitations.push({ code: "SERPAPI_ITEMS_DROPPED", message: `${dropped} SerpApi review(s) were malformed and dropped; valid reviews were kept`, stage: "source", params: { count: dropped } });
    }

    if (reviews.length >= reviewLimit) {
      if (reviews.length > reviewLimit) {
        reviews.length = reviewLimit;
        rawRefs.length = reviewLimit;
        limitations.push({
          code: "SERPAPI_APP_CAP",
          message: `SerpApi returned more than ${reviewLimit} reviews; the sample was capped at ${reviewLimit}`,
          stage: "source",
          params: { limit: reviewLimit },
        });
      }
      return { status: dropped > 0 ? "partial" : "complete", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    if (!nextExists) {
      return { status: dropped > 0 ? "partial" : "complete", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    if (page >= maxPages) {
      // The page cap cut pagination short while SerpApi still advertised a
      // next page — the dataset is intentionally partial, never "complete".
      limitations.push({ code: "SERPAPI_PAGE_CAP", message: `SerpApi pagination stopped at ${maxPages} pages (max); collected reviews were kept`, stage: "source", params: { limit: maxPages } });
      return { status: "partial", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }
  }

  // Only reachable when the loop body never ran (a non-positive page cap):
  // nothing was collected, so the outcome is partial with the same page-cap
  // caveat rather than a fabricated "complete" dataset.
  limitations.push({ code: "SERPAPI_PAGE_CAP", message: `SerpApi pagination stopped at ${maxPages} pages (max); collected reviews were kept`, stage: "source", params: { limit: maxPages } });
  return { status: "partial", reviews, rawRefs, limitations, evidence: buildEvidence() };

  async function fetchPage(page: number): Promise<{ pageReviews: RawReview[]; nextExists: boolean; dropped: number; suspectEmpty: boolean } | null> {
    const url = buildSearchUrl(baseUrl, apiKey, appId, page);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await fetchFn(url, { signal: controller.signal });
    } catch {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const timedOut = controller.signal.aborted && !signal?.aborted;
      const code = timedOut ? "SERPAPI_TIMEOUT" : signal?.aborted ? "SERPAPI_ABORTED" : "SERPAPI_FETCH_FAILED";
      const message = timedOut
        ? "SerpApi request timed out"
        : signal?.aborted
          ? "SerpApi request aborted by the caller"
          : "SerpApi request failed: network error";
      limitations.push({ code, message, stage: "source" });
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    httpStatus = res.status;
    let text: string;
    try {
      text = await res.text();
    } catch {
      limitations.push({ code: "SERPAPI_INVALID_RESPONSE", message: "SerpApi response could not be read", stage: "source" });
      return null;
    }

    if (!res.ok) {
      const metadataStatus = metadataStatusFrom(text);
      const code = ERROR_CODE_BY_STATUS[res.status] ?? "SERPAPI_INVALID_RESPONSE";
      const message = metadataStatus && metadataStatus !== "Success" ? `SerpApi request failed (HTTP ${res.status}; ${metadataStatus})` : `SerpApi request failed (HTTP ${res.status})`;
      limitations.push({ code, message, stage: "source" });
      return null;
    }

    const rawJson = safeJson(text);
    if (rawJson === null) {
      limitations.push({ code: "SERPAPI_INVALID_RESPONSE", message: "SerpApi returned a non-JSON HTTP 200 body", stage: "source" });
      return null;
    }
    const envelope = EnvelopeSchema.safeParse(rawJson);
    if (!envelope.success) {
      limitations.push({ code: "SERPAPI_INVALID_RESPONSE", message: "SerpApi response did not match the documented envelope", stage: "source" });
      return null;
    }
    const data = envelope.data;

    const searchId = data.search_metadata?.id;
    if (searchId) searchIds.push(searchId);

    const metadataStatus = data.search_metadata?.status;
    if (metadataStatus && metadataStatus !== "Success") {
      limitations.push({ code: "SERPAPI_INVALID_RESPONSE", message: `SerpApi search did not complete (${metadataStatus})`, stage: "source" });
      return null;
    }

    const nextExists = Boolean(data.serpapi_pagination?.next);
    const items = data.reviews ?? [];
    let dropped = 0;
    const pageReviews: RawReview[] = [];
    for (const item of items) {
      const parsed = ReviewItemSchema.safeParse(item);
      if (!parsed.success) {
        dropped += 1;
        continue;
      }
      pageReviews.push(toRawReview(parsed.data));
    }

    if (pageReviews.length === 0) {
      return { pageReviews: [], nextExists, dropped, suspectEmpty: true };
    }
    return { pageReviews, nextExists, dropped, suspectEmpty: false };
  }

  function buildEvidence(): SerpApiEvidence {
    return {
      provider: "serpapi",
      endpoint: "/search.json",
      engine: "apple_reviews",
      country: "us",
      sort: "mostrecent",
      noCache: true,
      startedAt,
      finishedAt: now(),
      httpStatus,
      requestCount: pagesFetched,
      pagesFetched,
      searchIds,
      parserDropped,
    };
  }
}

/** Builds the trusted SerpApi search URL. Never trusts a provider-supplied URL. */
export function buildSearchUrl(baseUrl: string, apiKey: string, appId: string, page: number): string {
  const url = new URL("/search.json", baseUrl.replace(/\/+$/, ""));
  url.searchParams.set("engine", "apple_reviews");
  url.searchParams.set("product_id", appId);
  url.searchParams.set("country", "us");
  url.searchParams.set("sort", "mostrecent");
  url.searchParams.set("page", String(page));
  url.searchParams.set("no_cache", "true");
  url.searchParams.set("api_key", apiKey);
  return url.toString();
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Parses the two English month forms the SerpApi Apple Reviews API documents:
 * "MMM DD, YYYY" (e.g. "Aug 11, 2026") and "DD MMMM YYYY" (e.g. "10 August
 * 2026"). Always returns midnight UTC. Unparseable dates become null; the local
 * current time is never substituted.
 */
export function parseReviewDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  const abbr = trimmed.match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/);
  if (abbr) {
    const month = MONTH_ABBR[abbr[1].toLowerCase()];
    if (month === undefined) return null;
    const day = Number(abbr[2]);
    const year = Number(abbr[3]);
    if (day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month, day)).toISOString();
  }

  const full = trimmed.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (full) {
    const month = MONTHS.findIndex((m) => m.toLowerCase() === full[2].toLowerCase());
    if (month === -1) return null;
    const day = Number(full[1]);
    const year = Number(full[3]);
    if (day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month, day)).toISOString();
  }

  return null;
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function toRawReview(item: SerpApiReviewItem): RawReview {
  return {
    sourceReviewId: item.id,
    source: "serpapi-apple-reviews",
    title: item.title ?? "",
    body: item.text,
    rating: item.rating,
    // Only a leading "Version " or "v" prefix is stripped, nothing else.
    version: item.reviewed_version?.replace(/^Version\s+/i, "").replace(/^v/i, "") || null,
    updatedAt: parseReviewDate(item.review_date),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function metadataStatusFrom(text: string): string | null {
  const parsed = safeJson(text) as { search_metadata?: { status?: unknown } } | null;
  return typeof parsed?.search_metadata?.status === "string" ? parsed.search_metadata.status : null;
}
