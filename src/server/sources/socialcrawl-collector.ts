import { z } from "zod";
import type { RawReview } from "@/domain/contracts/review";
import type { CollectionResult, Limitation } from "./source-types";

/** Application-layer cap on collected reviews; SocialCrawl supports up to 600. */
export const SOCIALCRAWL_REVIEW_DEPTH = 500;

export type SocialCrawlCollectorDeps = {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  baseUrl: string;
  apiKey: string;
  appId: string;
  timeoutMs: number;
  idempotencyKey: string;
  signal?: AbortSignal;
  maxRetries?: number;
};

/**
 * Secret-free request evidence for a SocialCrawl collection. The API key,
 * request headers and account credits balance are deliberately absent.
 */
export type SocialCrawlEvidence = {
  provider: "socialcrawl";
  endpoint: "/v1/app_store/app-reviews";
  country: "US";
  language: "en";
  requestedDepth: 500;
  sortBy: "most_recent";
  forcedRefresh: true;
  cached: boolean | null;
  requestId: string | null;
  creditsUsed: number | null;
  startedAt: string;
  finishedAt: string;
  httpStatus: number | null;
  attemptCount: number;
  providerDropped: number;
  parserDropped: number;
};

export type SocialCrawlCollectionResult = CollectionResult<SocialCrawlEvidence>;

// An envelope for the fields this application actually uses. Unknown provider
// fields (platform, endpoint, pagination…) are stripped by z.object's default
// behavior. `success` and `data` are required; a missing `data` is a malformed
// response, while an empty `items` array is a legitimate empty dataset.
const EnvelopeSchema = z
  .object({
    success: z.boolean(),
    data: z.object({
      items: z.array(z.unknown()).default([]),
      dropped: z.number().default(0),
    }),
    credits_used: z.number().nullable().optional(),
    request_id: z.string().nullable().optional(),
    cached: z.boolean().nullable().optional(),
  });

const ReviewItemSchema = z.object({
  review: z.object({
    id: z.string().min(1),
    entity_id: z.string().optional(),
    title: z.string().nullable().optional(),
    text: z.string().min(1),
    rating: z.object({ value: z.number().min(1).max(5) }),
    author: z.object({ name: z.string().nullable().optional() }).optional(),
    published_at: z.union([z.string(), z.number()]).nullable().optional(),
    ext: z
      .object({
        appdata: z.object({ version: z.string().nullable().optional() }).optional(),
      })
      .optional(),
  }),
});
type SocialCrawlReviewItem = z.infer<typeof ReviewItemSchema>;

const DETERMINISTIC_STATUS = new Set([400, 401, 402, 404]);
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);

const ERROR_TYPES: Record<string, string> = {
  INVALID_API_KEY: "SOCIALCRAWL_AUTH_FAILED",
  INSUFFICIENT_CREDITS: "SOCIALCRAWL_CREDITS_EXHAUSTED",
  RESOURCE_NOT_FOUND: "SOCIALCRAWL_RESOURCE_NOT_FOUND",
  RATE_LIMITED: "SOCIALCRAWL_RATE_LIMITED",
  INTERNAL: "SOCIALCRAWL_UPSTREAM_FAILED",
  BAD_GATEWAY: "SOCIALCRAWL_UPSTREAM_FAILED",
  UNAVAILABLE: "SOCIALCRAWL_UPSTREAM_FAILED",
};

const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_SLEEP_MS = 30_000;

/**
 * Collects up to 500 of the most recent US App Store reviews through
 * SocialCrawl. Every request sends `Cache-Control: no-cache` (bypass the
 * provider's shared cache) and a caller-supplied `Idempotency-Key` (reused on
 * retries so one logical preview never double-charges). Only transient
 * `429/500/502/503` are retried, at most twice, honoring a bounded
 * `Retry-After`. Deterministic `400/401/402/404` and a 503 without
 * `Retry-After` are not retried.
 *
 * The response envelope is validated strictly; each item is validated
 * individually so a malformed item drops the item (counted as parserDropped)
 * without discarding the valid reviews. A zero-valid-review success is
 * `suspect-empty`, never "no reviews". The returned evidence never contains the
 * API key, request headers or the credits balance.
 */
export async function collectSocialCrawlReviews(deps: SocialCrawlCollectorDeps): Promise<SocialCrawlCollectionResult> {
  const { fetchFn, sleep, now, baseUrl, apiKey, appId, timeoutMs, idempotencyKey, signal } = deps;
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const startedAt = now();
  const reviews: RawReview[] = [];
  const rawRefs: string[] = [];
  const limitations: Limitation[] = [];
  let requestId: string | null = null;
  let creditsUsed: number | null = null;
  let cached: boolean | null = null;
  let httpStatus: number | null = null;
  let attemptCount = 0;
  let providerDropped = 0;
  let parserDropped = 0;
  let retryDelayMs: number | null = null;

  const url = buildReviewsUrl(baseUrl, appId);
  const headers = {
    accept: "application/json",
    "x-api-key": apiKey,
    "cache-control": "no-cache",
    "idempotency-key": idempotencyKey,
  };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attemptCount = attempt;
    if (attempt > 1 && retryDelayMs !== null) {
      await sleep(retryDelayMs);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await fetchFn(url, { headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (isAbortError(err)) {
        if (controller.signal.aborted && !signal?.aborted) {
          limitations.push({ code: "SOCIALCRAWL_TIMEOUT", message: "SocialCrawl request timed out", stage: "source" });
        } else {
          limitations.push({ code: "SOCIALCRAWL_ABORTED", message: "SocialCrawl request aborted by the caller", stage: "source" });
        }
        return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
      }
      // Transient network failure: retry below.
      if (attempt <= maxRetries) {
        retryDelayMs = defaultRetryDelayMs(attempt);
        continue;
      }
      limitations.push({ code: "SOCIALCRAWL_FETCH_FAILED", message: "SocialCrawl request failed: network error", stage: "source" });
      return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    httpStatus = res.status;
    let text: string;
    try {
      text = await res.text();
    } catch {
      if (attempt <= maxRetries) {
        retryDelayMs = defaultRetryDelayMs(attempt);
        continue;
      }
      limitations.push({ code: "SOCIALCRAWL_INVALID_RESPONSE", message: "SocialCrawl response could not be read", stage: "source" });
      return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    if (!res.ok) {
      const type = extractErrorType(text);
      const code = ERROR_TYPES[type] ?? (DETERMINISTIC_STATUS.has(res.status) ? "SOCIALCRAWL_AUTH_FAILED" : "SOCIALCRAWL_UPSTREAM_FAILED");
      const message = buildErrorMessage(res.status, type, text);
      if (RETRYABLE_STATUS.has(res.status)) {
        const retryAfterMs = retryAfterMsFrom(res);
        // A 503 without Retry-After is deterministic (not retried); the other
        // retryable statuses may carry one but fall back to a bounded backoff.
        const shouldRetry = res.status !== 503 || retryAfterMs !== null;
        if (shouldRetry && attempt <= maxRetries) {
          retryDelayMs = retryAfterMs !== null ? retryAfterMs : defaultRetryDelayMs(attempt);
          continue;
        }
      }
      limitations.push({ code, message, stage: "source" });
      return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    // HTTP 200 with a success:false envelope is a deterministic failure, not a
    // retryable transient. Check the top-level success flag before requiring
    // the full success envelope (which includes `data`).
    const rawJson = safeJson(text);
    if (rawJson === null) {
      limitations.push({
        code: "SOCIALCRAWL_INVALID_RESPONSE",
        message: "SocialCrawl returned a non-JSON HTTP 200 body",
        stage: "source",
      });
      return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }
    const successFlag = (rawJson as { success?: unknown }).success;
    if (successFlag === false) {
      const type = extractErrorType(text);
      const code = ERROR_TYPES[type] ?? "SOCIALCRAWL_UPSTREAM_FAILED";
      limitations.push({ code, message: buildErrorMessage(200, type, text), stage: "source" });
      return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }
    const envelope = EnvelopeSchema.safeParse(rawJson);
    if (!envelope.success) {
      limitations.push({
        code: "SOCIALCRAWL_INVALID_RESPONSE",
        message: "SocialCrawl response did not match the documented envelope",
        stage: "source",
      });
      return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }
    const envelopeData = envelope.data;

    requestId = envelopeData.request_id ?? null;
    creditsUsed = envelopeData.credits_used ?? null;
    cached = envelopeData.cached ?? null;
    providerDropped = envelopeData.data.dropped;

    let dropped = 0;
    for (const item of envelopeData.data.items) {
      const parsed = ReviewItemSchema.safeParse(item);
      if (!parsed.success) {
        dropped += 1;
        continue;
      }
      const review = toRawReview(parsed.data);
      reviews.push(review);
      rawRefs.push(`socialcrawl:${requestId ?? "unknown"}#review:${review.sourceReviewId}`);
    }
    parserDropped = dropped;

    if (reviews.length > SOCIALCRAWL_REVIEW_DEPTH) {
      reviews.length = SOCIALCRAWL_REVIEW_DEPTH;
      rawRefs.length = SOCIALCRAWL_REVIEW_DEPTH;
      limitations.push({
        code: "SOCIALCRAWL_APP_CAP",
        message: `SocialCrawl returned more than ${SOCIALCRAWL_REVIEW_DEPTH} reviews; the sample was capped at ${SOCIALCRAWL_REVIEW_DEPTH}`,
        stage: "source",
      });
    }

    if (reviews.length === 0) {
      limitations.push({
        code: "SOCIALCRAWL_EMPTY",
        message: "SocialCrawl returned no valid reviews; availability is uncertain",
        stage: "source",
      });
      return { status: "suspect-empty", reviews, rawRefs, limitations, evidence: buildEvidence() };
    }

    const status = dropped > 0 ? "partial" : "complete";
    if (dropped > 0) {
      limitations.push({
        code: "SOCIALCRAWL_ITEMS_DROPPED",
        message: `${dropped} SocialCrawl item(s) were malformed and dropped; valid reviews were kept`,
        stage: "source",
      });
    }
    return { status, reviews, rawRefs, limitations, evidence: buildEvidence() };
  }

  // Exhausted transient retries.
  limitations.push({
    code: "SOCIALCRAWL_UPSTREAM_FAILED",
    message: "SocialCrawl transient errors exhausted retries",
    stage: "source",
  });
  return { status: "failed", reviews, rawRefs, limitations, evidence: buildEvidence() };

  function buildEvidence(): SocialCrawlEvidence {
    return {
      provider: "socialcrawl",
      endpoint: "/v1/app_store/app-reviews",
      country: "US",
      language: "en",
      requestedDepth: SOCIALCRAWL_REVIEW_DEPTH,
      sortBy: "most_recent",
      forcedRefresh: true,
      cached,
      requestId,
      creditsUsed,
      startedAt,
      finishedAt: now(),
      httpStatus,
      attemptCount,
      providerDropped,
      parserDropped,
    };
  }
}

/** Builds the fixed US, English, newest-first, 500-depth request URL. */
export function buildReviewsUrl(baseUrl: string, appId: string): string {
  const url = new URL("/v1/app_store/app-reviews", baseUrl.replace(/\/+$/, ""));
  url.searchParams.set("app_id", appId);
  url.searchParams.set("country", "US");
  url.searchParams.set("language", "en");
  url.searchParams.set("depth", String(SOCIALCRAWL_REVIEW_DEPTH));
  url.searchParams.set("sort_by", "most_recent");
  return url.toString();
}

/**
 * Normalizes the provider timestamp (ISO string or millisecond epoch) into an
 * ISO string, or null. Never substitutes the current time.
 */
export function normalizePublishedAt(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const date = typeof raw === "number" ? new Date(raw) : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toRawReview(item: SocialCrawlReviewItem): RawReview {
  return {
    sourceReviewId: item.review.id,
    source: "socialcrawl-app-store",
    title: item.review.title ?? "",
    body: item.review.text,
    rating: item.review.rating.value,
    version: item.review.ext?.appdata?.version ?? null,
    updatedAt: normalizePublishedAt(item.review.published_at),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorType(text: string): string {
  const parsed = safeJson(text) as { error?: { type?: string } } | null;
  return typeof parsed?.error?.type === "string" ? parsed.error.type : "";
}

function buildErrorMessage(status: number, type: string, _text: string): string {
  // The message may carry the status, a stable error type and the provider
  // request_id — never response headers or the API key.
  const pieces = [`SocialCrawl request failed (HTTP ${status})`];
  if (type) pieces.push(`type=${type}`);
  return pieces.join("; ");
}

function retryAfterMsFrom(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_SLEEP_MS);
  return 1000;
}

/** Bounded default backoff for transient retries that lack Retry-After. */
function defaultRetryDelayMs(attempt: number): number {
  return Math.min(1000 * attempt, MAX_RETRY_SLEEP_MS);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : err instanceof Error && err.name === "AbortError";
}
