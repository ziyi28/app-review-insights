import type { RawReview } from "@/domain/contracts/review";
import { parseAppleRssJson } from "./apple-rss-parser";

export type Limitation = {
  code: string;
  message: string;
  stage: string;
};

export type PageEvidence = {
  url: string;
  finalUrl: string;
  startedAt: string;
  finishedAt: string;
  httpStatus: number;
  headers: Record<string, string>;
  byteLength: number;
  sha256: string;
  page: number;
  reviewCount: number;
  parserWarnings: { code: string; message: string; index?: number }[];
  contentType: string | null;
};

export type SourceResult = {
  status: "complete" | "suspect-empty" | "partial" | "failed";
  reviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  pages: PageEvidence[];
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
};

const SAFE_HEADERS = ["content-type", "etag", "last-modified", "date", "cache-control"];

async function sha256(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

export function buildPageUrl(baseUrl: string, page: number, appId: string): string {
  return `${baseUrl}/page=${page}/id=${appId}/sortby=mostRecent/json`;
}

/**
 * Collects US storefront customer reviews from the Apple RSS feed.
 * Sequential, low-frequency, capped at `maxPages`; an HTTP 200 empty first
 * page is `suspect-empty` (never "no reviews"), a failed page after data is
 * `partial`. Every page's raw response and safe headers are preserved.
 */
export async function collectAppleReviews(deps: CollectorDeps): Promise<SourceResult> {
  const { fetchFn, sleep, now, baseUrl, appId, maxPages, pageDelayMs, timeoutMs, signal } = deps;
  const reviews: RawReview[] = [];
  const rawRefs: string[] = [];
  const limitations: Limitation[] = [];
  const pages: PageEvidence[] = [];
  let lastBodyHash: string | null = null;

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await sleep(pageDelayMs);
    const url = buildPageUrl(baseUrl, page, appId);
    const startedAt = now();

    let res: Response;
    let body: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        res = await fetchFn(url, { signal: controller.signal, headers: { accept: "application/json" } });
        body = await res.text();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      if (page === 1 && pages.length === 0) {
        limitations.push({
          code: "RSS_FETCH_FAILED",
          message: `Page ${page} fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          stage: "source",
        });
        return { status: "failed", reviews, rawRefs, limitations, pages };
      }
      limitations.push({
        code: "RSS_PARTIAL",
        message: `Page ${page} fetch failed; continuing with collected reviews`,
        stage: "source",
      });
      return { status: "partial", reviews, rawRefs, limitations, pages };
    }

    const finishedAt = now();

    if (!res.ok) {
      const message = `Page ${page} returned HTTP ${res.status}`;
      if (page === 1 && pages.length === 0) {
        limitations.push({ code: "RSS_FETCH_FAILED", message, stage: "source" });
        return { status: "failed", reviews, rawRefs, limitations, pages };
      }
      limitations.push({ code: "RSS_PARTIAL", message: `${message}; continuing with collected reviews`, stage: "source" });
      return { status: "partial", reviews, rawRefs, limitations, pages };
    }

    const bodyHash = await sha256(body);
    const safeHeaders: Record<string, string> = {};
    for (const h of SAFE_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) safeHeaders[h] = v;
    }

    const parsed = parseAppleRssJson(body);
    pages.push({
      url,
      finalUrl: res.url || url,
      startedAt,
      finishedAt,
      httpStatus: res.status,
      headers: safeHeaders,
      byteLength: body.length,
      sha256: bodyHash,
      page,
      reviewCount: parsed.reviews.length,
      parserWarnings: parsed.warnings,
      contentType: res.headers.get("content-type"),
    });

    if (parsed.reviews.length > 0) {
      for (const [i, r] of parsed.reviews.entries()) {
        reviews.push(r);
        rawRefs.push(`sources/apple/page-${String(page).padStart(2, "0")}.json#${parsed.rawRefs[i]}`);
      }
    }

    // An HTTP 200 page that is not valid JSON (or has no feed object) is a
    // distinct source failure, never a "no reviews" signal.
    const structuralFailure = parsed.warnings.some((w) => w.code === "INVALID_JSON" || w.code === "MISSING_FEED" || w.code === "MISSING_ENTRIES");
    if (page === 1 && parsed.reviews.length === 0 && structuralFailure) {
      limitations.push({
        code: "RSS_NON_JSON",
        message: `Page ${page} returned HTTP 200 but its body is not a valid Apple RSS feed`,
        stage: "source",
      });
      return { status: "failed", reviews, rawRefs, limitations, pages };
    }

    if (page === 1 && parsed.reviews.length === 0) {
      limitations.push({
        code: "RSS_SUSPECT_EMPTY",
        message:
          "Apple RSS returned an HTTP 200 empty feed on page 1; review availability is uncertain and cannot be reported as 'no reviews'",
        stage: "source",
      });
      return { status: "suspect-empty", reviews, rawRefs, limitations, pages };
    }

    if (parsed.reviews.length === 0) {
      // Subsequent empty page = natural pagination end.
      break;
    }

    if (lastBodyHash !== null && bodyHash === lastBodyHash) {
      limitations.push({
        code: "RSS_REPEATED_PAGE",
        message: `Page ${page} body is byte-identical to the previous page; stopping pagination`,
        stage: "source",
      });
      break;
    }
    lastBodyHash = bodyHash;
  }

  return { status: "complete", reviews, rawRefs, limitations, pages };
}
