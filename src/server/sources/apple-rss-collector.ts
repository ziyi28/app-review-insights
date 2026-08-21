import type { RawReview } from "@/domain/contracts/review";
import { parseAppleRssJson, type AppleRssParseResult } from "./apple-rss-parser";
import type { Limitation, SourceFile } from "./source-types";

// Re-exported so existing consumers keep working; the canonical type lives in
// source-types.ts and is shared with the SocialCrawl collector.
export type { Limitation } from "./source-types";

export type PageEvidence = {
  url: string;
  finalUrl: string;
  startedAt: string;
  finishedAt: string;
  httpStatus: number;
  headers: Record<string, string>;
  /** UTF-8 byte length of the raw response body. */
  byteLength: number;
  sha256: string;
  page: number;
  /** Which HTTP request this evidence belongs to (1-based, retries included). */
  attempt: number;
  reviewCount: number;
  parserWarnings: { code: string; message: string; index?: number }[];
  contentType: string | null;
  /** Run-local path to the archived raw response for this request. */
  rawFile: string;
};

export type SourceResult = {
  status: "complete" | "suspect-empty" | "partial" | "failed";
  reviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  pages: PageEvidence[];
  /** Every raw HTTP response body, one per fetchOnce attempt. */
  sourceFiles: SourceFile[];
};

export type CollectorDeps = {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  baseUrl: string;
  appId: string;
  maxPages: number;
  pageDelayMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Delays (ms) applied between retries of an empty page-1 response. */
  emptyPageRetryDelaysMs?: number[];
  /** Delay (ms) before re-confirming a page that is empty but has more pages advertised. */
  unstableConfirmDelayMs?: number;
  /** Upper bound on the collected sample (100/300/500); default unbounded. */
  reviewLimit?: number;
};

const SAFE_HEADERS = ["content-type", "etag", "last-modified", "date", "cache-control"];

const STRUCTURAL_WARNINGS = ["INVALID_JSON", "MISSING_FEED", "MISSING_ENTRIES"];

async function sha256(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

/** Run-local, safe archive path for one HTTP attempt's raw response. */
function sourceFilePath(page: number, attempt: number): string {
  return `sources/apple/page-${String(page).padStart(2, "0")}.attempt-${String(attempt).padStart(2, "0")}.json`;
}

export function buildPageUrl(baseUrl: string, page: number, appId: string): string {
  return `${baseUrl}/page=${page}/id=${appId}/sortBy=mostRecent/json`;
}

type FetchOutcome = {
  res: Response;
  body: string;
  bodyHash: string;
  parsed: AppleRssParseResult;
  url: string;
  page: number;
  attempt: number;
  httpStatus: number;
  safeHeaders: Record<string, string>;
  contentType: string | null;
  startedAt: string;
  finishedAt: string;
  /** Run-local archive path for this request's raw body. */
  rawFile: string;
};

/**
 * Collects US storefront customer reviews from the Apple RSS feed.
 * Sequential, low-frequency, capped at `maxPages`.
 *
 * Reliability policy for the unstable Apple/CDN pagination:
 * - An HTTP 200 empty page 1 is retried twice (2s/5s, cache-busted); three
 *   consecutive empties are `suspect-empty` (never "no reviews").
 * - A page that is empty while feed.link[rel=last] advertises more pages is an
 *   abnormal early end: confirmed once after 2s, then `partial` with
 *   `RSS_UNSTABLE_PAGINATION` (collected reviews are kept).
 * - A page whose body repeats the previous page is detected before appending
 *   (`RSS_REPEATED_PAGE`, repeated content never counts toward totals).
 * Every request's raw response and safe headers are preserved; `attempt` tags
 * which HTTP request of the same page a page evidence belongs to.
 */
export async function collectAppleReviews(deps: CollectorDeps): Promise<SourceResult> {
  const { fetchFn, sleep, now, baseUrl, appId, maxPages, pageDelayMs, timeoutMs, signal } = deps;
  const reviewLimit = deps.reviewLimit ?? Number.POSITIVE_INFINITY;
  const emptyRetryDelays = deps.emptyPageRetryDelaysMs ?? [2000, 5000];
  const confirmDelayMs = deps.unstableConfirmDelayMs ?? 2000;
  const reviews: RawReview[] = [];
  const rawRefs: string[] = [];
  const limitations: Limitation[] = [];
  const pages: PageEvidence[] = [];
  const sourceFiles: SourceFile[] = [];
  let lastBodyHash: string | null = null;
  // The most recent advertised last page across responses. An empty page often
  // carries no rel=last link of its own, so the collector falls back to the
  // last known value to decide whether the empty page is an early end.
  let advertisedLastPage: number | null = null;

  const abortError = () => new DOMException("aborted by the caller", "AbortError");
  const wait = async (ms: number): Promise<void> => {
    if (!signal) return sleep(ms);
    if (signal.aborted) throw abortError();
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([sleep(ms), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  };

  async function fetchOnce(page: number, attempt: number): Promise<FetchOutcome> {
    if (signal?.aborted) throw abortError();
    const base = buildPageUrl(baseUrl, page, appId);
    // Cache-busting on retries: the empty response is often a stale CDN cache,
    // so a fresh query parameter forces a new origin lookup.
    const url = attempt > 1 ? `${base}?_=${new Date(now()).getTime()}-${attempt}` : base;
    const startedAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    let body: string;
    try {
      res = await fetchFn(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 (compatible; AppReviewPlanner/1.0)",
        },
      });
      body = await res.text();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    const finishedAt = now();
    const bodyHash = await sha256(body);
    const safeHeaders: Record<string, string> = {};
    for (const h of SAFE_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) safeHeaders[h] = v;
    }
    const parsed = parseAppleRssJson(body);
    return {
      res,
      body,
      bodyHash,
      parsed,
      url,
      page,
      attempt,
      httpStatus: res.status,
      safeHeaders,
      contentType: res.headers.get("content-type"),
      startedAt,
      finishedAt,
      rawFile: sourceFilePath(page, attempt),
    };
  }

  function record(o: FetchOutcome): void {
    if (o.parsed.lastPage !== null) advertisedLastPage = o.parsed.lastPage;
    // Archive the exact raw response body so every HTTP attempt is
    // independently verifiable from the run directory.
    sourceFiles.push({ relativePath: o.rawFile, content: o.body });
    pages.push({
      url: o.url,
      finalUrl: o.res.url || o.url,
      startedAt: o.startedAt,
      finishedAt: o.finishedAt,
      httpStatus: o.httpStatus,
      headers: o.safeHeaders,
      byteLength: Buffer.byteLength(o.body, "utf8"),
      sha256: o.bodyHash,
      page: o.page,
      attempt: o.attempt,
      reviewCount: o.parsed.reviews.length,
      parserWarnings: o.parsed.warnings,
      contentType: o.contentType,
      rawFile: o.rawFile,
    });
  }

  function appendFrom(o: FetchOutcome): void {
    for (const [i, r] of o.parsed.reviews.entries()) {
      reviews.push(r);
      // The rawRef points at the attempt file that actually provided this
      // review, so its body can always be re-read from the archive.
      rawRefs.push(`${o.rawFile}#${o.parsed.rawRefs[i]}`);
    }
    lastBodyHash = o.bodyHash;
  }

  const structuralFailure = (o: FetchOutcome): boolean =>
    o.httpStatus === 200 && o.parsed.warnings.some((w) => (STRUCTURAL_WARNINGS as readonly string[]).includes(w.code));

  const httpOkEmpty = (o: FetchOutcome): boolean => o.httpStatus === 200 && o.parsed.reviews.length === 0 && !structuralFailure(o);

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await wait(pageDelayMs);

    let outcome: FetchOutcome;
    try {
      outcome = await fetchOnce(page, 1);
    } catch (err) {
      if (page === 1 && pages.length === 0) {
        limitations.push({
          code: "RSS_FETCH_FAILED",
          message: `Page ${page} fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          stage: "source",
          params: { page, detail: err instanceof Error ? err.message : String(err) },
        });
        return { status: "failed", reviews, rawRefs, limitations, pages, sourceFiles };
      }
      limitations.push({
        code: "RSS_PARTIAL",
        message: `Page ${page} fetch failed; continuing with collected reviews`,
        stage: "source",
        params: { page },
      });
      return { status: "partial", reviews, rawRefs, limitations, pages, sourceFiles };
    }
    record(outcome);

    if (!outcome.res.ok) {
      const message = `Page ${page} returned HTTP ${outcome.httpStatus}`;
      if (page === 1 && pages.length === 1) {
        limitations.push({ code: "RSS_FETCH_FAILED", message, stage: "source", params: { page, detail: `HTTP ${outcome.httpStatus}` } });
        return { status: "failed", reviews, rawRefs, limitations, pages, sourceFiles };
      }
      limitations.push({ code: "RSS_PARTIAL", message: `${message}; continuing with collected reviews`, stage: "source", params: { page } });
      return { status: "partial", reviews, rawRefs, limitations, pages, sourceFiles };
    }

    // An HTTP 200 page that is not valid JSON (or has no feed object, or a
    // non-array entry) is a distinct source failure, never a "no reviews"
    // signal. This is evaluated before any empty-page retry. (A structural
    // failure always parses to zero reviews, so no empty check is needed.)
    if (structuralFailure(outcome) && page === 1) {
      limitations.push({
        code: "RSS_NON_JSON",
        message: `Page ${page} returned HTTP 200 but its body is not a valid Apple RSS feed`,
        stage: "source",
        params: { page },
      });
      return { status: "failed", reviews, rawRefs, limitations, pages, sourceFiles };
    }

    // Empty page 1: retry twice (2s, 5s) with cache-busting before accepting
    // "empty". The Apple/CDN pagination has been observed to flap between
    // page counts across identical requests, so a single empty response is not
    // trustworthy.
    if (page === 1 && httpOkEmpty(outcome)) {
      let attempt = 1;
      let recovered = false;
      for (const delay of emptyRetryDelays) {
        attempt += 1;
        await wait(delay);
        let retry: FetchOutcome;
        try {
          retry = await fetchOnce(page, attempt);
        } catch {
          // A transient retry failure keeps the empty conclusion; the next
          // retry (if any) or the empty classification below decides.
          continue;
        }
        record(retry);
        if (retry.parsed.reviews.length > 0 && !structuralFailure(retry)) {
          outcome = retry;
          recovered = true;
          break;
        }
        if (structuralFailure(retry)) {
          limitations.push({
            code: "RSS_NON_JSON",
            message: `Page ${page} returned HTTP 200 but its body is not a valid Apple RSS feed`,
            stage: "source",
            params: { page },
          });
          return { status: "failed", reviews, rawRefs, limitations, pages, sourceFiles };
        }
        // Still empty; loop continues to the next retry.
      }
      if (!recovered) {
        limitations.push({
          code: "RSS_SUSPECT_EMPTY",
          message:
            "Apple RSS returned an HTTP 200 empty feed on page 1 after retries; review availability is uncertain and cannot be reported as 'no reviews'",
          stage: "source",
        });
        return { status: "suspect-empty", reviews, rawRefs, limitations, pages, sourceFiles };
      }
    }

    // Empty pages beyond page 1: the natural end is page >= lastPage (or no
    // lastPage advertised). An empty page while rel=last still advertises more
    // pages is an abnormal early end: confirm once, then partial. A structural
    // failure (non-JSON etc.) on page > 1 is never a trustworthy "natural
    // end" — the remaining pages are unknowable, so the collection is partial
    // and the already-collected reviews are kept. Fatal RSS_NON_JSON only
    // applies to page 1, where nothing has been collected yet.
    if (page > 1 && outcome.parsed.reviews.length === 0) {
      if (structuralFailure(outcome)) {
        limitations.push({
          code: "RSS_NON_JSON",
          message: `Page ${page} returned HTTP 200 but its body is not a valid Apple RSS feed; ending pagination with the collected reviews`,
          stage: "source",
          params: { page },
        });
        return { status: "partial", reviews, rawRefs, limitations, pages, sourceFiles };
      }
      const lastPage = advertisedLastPage ?? outcome.parsed.lastPage;
      const abnormalEarlyEnd = lastPage !== null && page < lastPage;
      if (abnormalEarlyEnd) {
        await wait(confirmDelayMs);
        let confirm: FetchOutcome;
        try {
          confirm = await fetchOnce(page, outcome.attempt + 1);
        } catch {
          limitations.push({
            code: "RSS_UNSTABLE_PAGINATION",
            message: `Page ${page} is empty while ${lastPage} pages are advertised; confirmation failed`,
            stage: "source",
            params: { page, lastPage: lastPage ?? page },
          });
          return { status: "partial", reviews, rawRefs, limitations, pages, sourceFiles };
        }
        record(confirm);
        if (confirm.parsed.reviews.length > 0 && !structuralFailure(confirm)) {
          outcome = confirm;
        } else {
          limitations.push({
            code: "RSS_UNSTABLE_PAGINATION",
            message: `Page ${page} is empty while ${lastPage} pages are advertised; ending pagination early`,
            stage: "source",
            params: { page, lastPage: lastPage ?? page },
          });
          return { status: "partial", reviews, rawRefs, limitations, pages, sourceFiles };
        }
      } else {
        // Natural end: the advertised last page was reached (or is unknown).
        break;
      }
    }

    // A page whose body repeats the previous page is detected BEFORE appending,
    // so the repeated content never inflates review counts.
    if (outcome.parsed.reviews.length > 0 && lastBodyHash !== null && outcome.bodyHash === lastBodyHash) {
      limitations.push({
        code: "RSS_REPEATED_PAGE",
        message: `Page ${page} body is byte-identical to the previous page; stopping pagination`,
        stage: "source",
        params: { page },
      });
      break;
    }

    if (outcome.parsed.reviews.length > 0) {
      appendFrom(outcome);
      // The requested review cap was reached: truncate exactly and stop
      // requesting further pages (the same limit the preview applies).
      if (reviews.length >= reviewLimit) {
        if (reviews.length > reviewLimit) {
          reviews.length = reviewLimit;
          rawRefs.length = reviewLimit;
          limitations.push({
            code: "RSS_APP_CAP",
            message: `Apple RSS returned more than ${reviewLimit} reviews; the sample was capped at ${reviewLimit}`,
            stage: "source",
            params: { limit: reviewLimit },
          });
        }
        break;
      }
      // The advertised last page was reached: no need to request more pages.
      if (advertisedLastPage !== null && page >= advertisedLastPage) {
        break;
      }
    }
  }

  return { status: "complete", reviews, rawRefs, limitations, pages, sourceFiles };
}
