import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectSerpApiReviews, SERPAPI_REVIEW_LIMIT, type SerpApiCollectorDeps } from "./serpapi-collector";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "serpapi", name), "utf8");
}

function reviewItem(id: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    position: 1,
    id,
    title: `Title ${id}`,
    text: `Body ${id}`,
    rating: 5,
    review_date: "Aug 11, 2026",
    reviewed_version: "Version 8.4.29",
    author: { name: `user-${id}`, author_id: `100-${id}` },
    ...overrides,
  };
}

function serpPage(
  items: unknown[],
  opts: { hasNext?: boolean; page?: number; searchId?: string; status?: string } = {},
): Record<string, unknown> {
  const { hasNext = false, page = 1, searchId = "search_page_1", status = "Success" } = opts;
  return {
    search_metadata: { id: searchId, status },
    search_parameters: { engine: "apple_reviews", product_id: "839285684", country: "us", sort: "mostrecent", page: String(page) },
    search_information: { total_page_count: hasNext ? 2 : 1, reviews_results_state: "Results for exact ID number.", results_count: items.length },
    reviews: items,
    serpapi_pagination: {
      current: `https://serpapi.com/search.json?engine=apple_reviews&page=${page}&product_id=839285684`,
      ...(hasNext ? { next: `https://serpapi.com/search.json?engine=apple_reviews&page=${page + 1}&product_id=839285684` } : {}),
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function jsonFetch(body: unknown): typeof fetch {
  return vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
}

function deps(overrides: Partial<SerpApiCollectorDeps>): SerpApiCollectorDeps {
  return {
    fetchFn: vi.fn(async () => jsonResponse(serpPage([]))) as unknown as typeof fetch,
    now: () => "2026-08-13T12:00:00.000Z",
    baseUrl: "https://serpapi.com",
    apiKey: "serp_test_only",
    appId: "839285684",
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe("collectSerpApiReviews", () => {
  it("requests forced-fresh US reviews and returns normalized reviews", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(JSON.parse(fixture("apple-reviews-page-01.json")))) as unknown as typeof fetch;
    const result = await collectSerpApiReviews(deps({ fetchFn }));

    const requested = new URL(String(fetchFn.mock.calls[0][0]));
    expect(requested.origin + requested.pathname).toBe("https://serpapi.com/search.json");
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      engine: "apple_reviews",
      product_id: "839285684",
      country: "us",
      sort: "mostrecent",
      page: "1",
      no_cache: "true",
      api_key: "serp_test_only",
    });
    expect(result.reviews[0]).toMatchObject({
      sourceReviewId: "14412891541",
      source: "serpapi-apple-reviews",
      rating: 4,
      version: "8.4.29",
      updatedAt: "2026-08-11T00:00:00.000Z",
    });
    // The second fixture review exercises the "10 August 2026" date form.
    expect(result.reviews[1]).toMatchObject({
      sourceReviewId: "14411802642",
      version: "8.5.0",
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(JSON.stringify(result.evidence)).not.toContain("serp_test_only");
  });

  it("rebuilds page URLs instead of following the provider next URL", async () => {
    const requestedOrigins: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedOrigins.push(url.origin);
      if (url.searchParams.get("page") === "1") {
        const body = serpPage([reviewItem("r1")], { hasNext: true, page: 1, searchId: "search_page_1" });
        body.serpapi_pagination = { next: "https://evil.example/steal" };
        return jsonResponse(body);
      }
      return jsonResponse(serpPage([reviewItem("r2")], { page: 2, searchId: "search_page_2" }));
    }) as unknown as typeof fetch;

    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(result.status).toBe("complete");
    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["r1", "r2"]);
    // Page 1 advertises https://evil.example/steal; page 2 must still use baseUrl.
    expect(requestedOrigins).toEqual(["https://serpapi.com", "https://serpapi.com"]);
  });

  it("keeps collected pages as partial when a later page fails", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("page") === "1") {
        return jsonResponse(serpPage([reviewItem("r1")], { hasNext: true, page: 1, searchId: "search_page_1" }));
      }
      return new Response(JSON.stringify({ error: "boom" }), { status: 503 });
    }) as unknown as typeof fetch;

    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(result.status).toBe("partial");
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.reviews[0].sourceReviewId).toBe("r1");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_PARTIAL" }));
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_UPSTREAM_FAILED" }));
  });

  it("reports a successful empty first page as suspect-empty", async () => {
    const result = await collectSerpApiReviews(deps({ fetchFn: jsonFetch(serpPage([])) }));
    expect(result.status).toBe("suspect-empty");
    expect(result.reviews).toHaveLength(0);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_EMPTY" }));
  });

  it("never places the API key in evidence or limitations", async () => {
    const result = await collectSerpApiReviews(deps({ fetchFn: jsonFetch(serpPage([reviewItem("r1")])) }));
    expect(JSON.stringify(result)).not.toContain("serp_test_only");
  });

  it.each([
    [400, "SERPAPI_INVALID_REQUEST"],
    [401, "SERPAPI_AUTH_FAILED"],
    [403, "SERPAPI_AUTH_FAILED"],
    [429, "SERPAPI_RATE_OR_QUOTA_EXHAUSTED"],
    [500, "SERPAPI_UPSTREAM_FAILED"],
    [503, "SERPAPI_UPSTREAM_FAILED"],
  ])("maps HTTP %s to %s without leaking the provider error text", async (status, code) => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: "sensitive provider message", search_metadata: { status: "Error", id: "x" } }), { status }),
    ) as unknown as typeof fetch;
    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code }));
    expect(JSON.stringify(result)).not.toContain("sensitive provider message");
  });

  it("fails when search_metadata.status is Error or Processing", async () => {
    for (const status of ["Error", "Processing", "Queued"]) {
      const result = await collectSerpApiReviews(deps({ fetchFn: jsonFetch(serpPage([], { status })) }));
      expect(result.status).toBe("failed");
      expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_INVALID_RESPONSE" }));
    }
  });

  it("fails on a non-JSON HTTP 200 body without leaking response content", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch;
    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_INVALID_RESPONSE" }));
    expect(JSON.stringify(result)).not.toContain("<html>");
  });

  it("fails when the request times out", async () => {
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const controller = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        controller?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }) as unknown as typeof fetch;
    const result = await collectSerpApiReviews(deps({ fetchFn, timeoutMs: 1 }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_TIMEOUT" }));
  });

  it("fails fast when the caller aborts the signal", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }) as unknown as typeof fetch;
    const resultPromise = collectSerpApiReviews(deps({ fetchFn, signal: controller.signal }));
    controller.abort();
    const result = await resultPromise;
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_ABORTED" }));
  });

  it("keeps valid items and drops malformed items as parserDropped", async () => {
    const body = serpPage([reviewItem("good"), { id: "bad", text: "", rating: 9 }]);
    const result = await collectSerpApiReviews(deps({ fetchFn: jsonFetch(body) }));
    expect(result.status).toBe("partial");
    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["good"]);
    expect(result.evidence.parserDropped).toBe(1);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_ITEMS_DROPPED" }));
  });

  it("caps pagination at 500 reviews and never exceeds 20 pages", async () => {
    const pageSize = 30;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      const items = Array.from({ length: pageSize }, (_, i) => reviewItem(`p${page}-${i}`));
      return jsonResponse(serpPage(items, { hasNext: true, page, searchId: `search_page_${page}` }));
    }) as unknown as typeof fetch;

    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(result.reviews).toHaveLength(SERPAPI_REVIEW_LIMIT);
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(20);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_APP_CAP" }));
  });

  it("stops naturally when a page has no next URL", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(serpPage([reviewItem("r1")], { page: 1 }))) as unknown as typeof fetch;
    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(result.status).toBe("complete");
    expect(result.evidence.requestCount).toBe(1);
    expect(result.evidence.pagesFetched).toBe(1);
  });

  it("does not auto-retry a failing request (one fetch call per failure)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await collectSerpApiReviews(deps({ fetchFn }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SERPAPI_FETCH_FAILED" }));
  });

  it("accepts a missing reviews array as an empty result", async () => {
    const body = serpPage([]) as Record<string, unknown>;
    delete body.reviews;
    const result = await collectSerpApiReviews(deps({ fetchFn: jsonFetch(body) }));
    expect(result.status).toBe("suspect-empty");
  });
});
