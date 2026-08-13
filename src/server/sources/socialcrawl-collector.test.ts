import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectSocialCrawlReviews, type SocialCrawlCollectorDeps } from "./socialcrawl-collector";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "socialcrawl", name), "utf8");
}

function reviewItem(id: string): unknown {
  return {
    review: {
      id,
      entity_id: "839285684",
      title: `Title ${id}`,
      text: `Body ${id}`,
      rating: { value: 5, max: 5 },
      author: { name: `user-${id}` },
      published_at: "2026-08-12T00:00:00.000Z",
      ext: { appdata: { version: "8.2.0" } },
    },
  };
}

function successEnvelope(items: unknown[]): Record<string, unknown> {
  return {
    success: true,
    platform: "app_store",
    endpoint: "/v1/app_store/app-reviews",
    data: { items, total: items.length, dropped: 0 },
    credits_used: 5,
    credits_remaining: 95,
    request_id: "req_test",
    cached: false,
    pagination: { next_cursor: null, has_more: false, page_size: 50 },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function jsonFetch(body: unknown): typeof fetch {
  return vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
}

function errorResponse(status: number, type: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ success: false, error: { type, message: "boom" } }), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function deps(overrides: Partial<SocialCrawlCollectorDeps>): SocialCrawlCollectorDeps {
  return {
    fetchFn: vi.fn(async () => jsonResponse(successEnvelope([]))) as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => "2026-08-12T00:00:00.000Z",
    baseUrl: "https://www.socialcrawl.dev",
    apiKey: "sc_test_only",
    appId: "839285684",
    timeoutMs: 10_000,
    idempotencyKey: "preview-1",
    ...overrides,
  };
}

describe("collectSocialCrawlReviews", () => {
  it("forces a fresh US most-recent request and maps unified reviews", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Response(fixture("app-reviews.json"), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await collectSocialCrawlReviews(deps({ fetchFn: fetchFn as unknown as typeof fetch }));

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://www.socialcrawl.dev/v1/app_store/app-reviews?app_id=839285684&country=US&language=en&depth=500&sort_by=most_recent");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("sc_test_only");
    expect(new Headers(init?.headers).get("cache-control")).toBe("no-cache");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("preview-1");
    expect(result.reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReviewId: "review-1", source: "socialcrawl-app-store", rating: 5, version: "8.2.0" }),
    ]));
    expect(JSON.stringify(result.evidence)).not.toContain("sc_test_only");
  });

  it("caps a successful response at 500 reviews", async () => {
    const body = successEnvelope(Array.from({ length: 600 }, (_, i) => reviewItem(`r-${i}`)));
    const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch(body) }));
    expect(result.reviews).toHaveLength(500);
    expect(result.rawRefs).toHaveLength(500);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_APP_CAP" }));
  });

  it("keeps valid items and marks malformed items partial without RSS concerns", async () => {
    const body = successEnvelope([reviewItem("good"), { review: { id: "bad", text: "", rating: { value: 9 } } }]);
    const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch(body) }));
    expect(result.status).toBe("partial");
    expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["good"]);
    expect(result.evidence.parserDropped).toBe(1);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_ITEMS_DROPPED" }));
  });

  it.each([
    [401, "INVALID_API_KEY", "SOCIALCRAWL_AUTH_FAILED"],
    [402, "INSUFFICIENT_CREDITS", "SOCIALCRAWL_CREDITS_EXHAUSTED"],
    [404, "RESOURCE_NOT_FOUND", "SOCIALCRAWL_RESOURCE_NOT_FOUND"],
  ])("does not retry deterministic %s errors", async (status, type, code) => {
    const fetchFn = vi.fn(async () => errorResponse(status, type)) as unknown as typeof fetch;
    const result = await collectSocialCrawlReviews(deps({ fetchFn }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code }));
  });

  it("honors Retry-After and reuses the idempotency key on a 429 retry", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(errorResponse(429, "RATE_LIMITED", { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(successEnvelope([reviewItem("ok")])));
    const sleep = vi.fn(async () => {});
    const result = await collectSocialCrawlReviews(deps({ fetchFn: fetchFn as typeof fetch, sleep }));
    expect(result.status).toBe("complete");
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchFn.mock.calls.map(([, init]) => new Headers(init?.headers).get("idempotency-key"))).toEqual(["preview-1", "preview-1"]);
  });

  it("retries an observed 504 UPSTREAM_ERROR and reuses the idempotency key", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(errorResponse(504, "UPSTREAM_ERROR"))
      .mockResolvedValueOnce(jsonResponse(successEnvelope([reviewItem("ok")])));
    const sleep = vi.fn(async () => {});

    const result = await collectSocialCrawlReviews(
      deps({ fetchFn: fetchFn as typeof fetch, sleep }),
    );

    expect(result.status).toBe("complete");
    expect(result.reviews.map((review) => review.sourceReviewId)).toEqual(["ok"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(
      fetchFn.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("idempotency-key"),
      ),
    ).toEqual(["preview-1", "preview-1"]);
    expect(result.evidence.attemptCount).toBe(2);
  });

  it("fails explicitly after exhausting 504 UPSTREAM_ERROR retries", async () => {
    const fetchFn = vi.fn(async () => errorResponse(504, "UPSTREAM_ERROR"));
    const sleep = vi.fn(async () => {});

    const result = await collectSocialCrawlReviews(
      deps({ fetchFn: fetchFn as unknown as typeof fetch, sleep, maxRetries: 2 }),
    );

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(result.status).toBe("failed");
    expect(result.evidence.httpStatus).toBe(504);
    expect(result.evidence.attemptCount).toBe(3);
    expect(result.limitations).toContainEqual({
      code: "SOCIALCRAWL_UPSTREAM_FAILED",
      message: "SocialCrawl request failed (HTTP 504); type=UPSTREAM_ERROR",
      stage: "source",
    });
  });

  it("retries 500 and 502 with bounded backoff", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(errorResponse(502, "BAD_GATEWAY"))
      .mockResolvedValueOnce(jsonResponse(successEnvelope([reviewItem("ok")])));
    const result = await collectSocialCrawlReviews(deps({ fetchFn: fetchFn as typeof fetch, maxRetries: 2 }));
    expect(result.status).toBe("complete");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 503 without Retry-After", async () => {
    const fetchFn = vi.fn(async () => errorResponse(503, "UNAVAILABLE")) as unknown as typeof fetch;
    const result = await collectSocialCrawlReviews(deps({ fetchFn }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_UPSTREAM_FAILED" }));
  });

  it("retries a 503 with Retry-After and caps the sleep at 30s", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(errorResponse(503, "UNAVAILABLE", { "retry-after": "3600" }))
      .mockResolvedValueOnce(jsonResponse(successEnvelope([reviewItem("ok")])));
    const sleep = vi.fn(async () => {});
    const result = await collectSocialCrawlReviews(deps({ fetchFn: fetchFn as typeof fetch, sleep }));
    expect(result.status).toBe("complete");
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("exhausts transient retries into an explicit failure", async () => {
    const fetchFn = vi.fn(async () => errorResponse(429, "RATE_LIMITED", { "retry-after": "1" }));
    const sleep = vi.fn(async () => {});
    const result = await collectSocialCrawlReviews(deps({ fetchFn: fetchFn as typeof fetch, sleep, maxRetries: 2 }));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_RATE_LIMITED" }));
  });

  it("returns suspect-empty when a success envelope has zero valid reviews", async () => {
    const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch(successEnvelope([])) }));
    expect(result.status).toBe("suspect-empty");
    expect(result.reviews).toHaveLength(0);
  });

  it("fails on invalid JSON without leaking response content", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch;
    const result = await collectSocialCrawlReviews(deps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_INVALID_RESPONSE" }));
    expect(JSON.stringify(result)).not.toContain("<html>");
  });

  it("fails on a success:false envelope returned with HTTP 200", async () => {
    const body = { success: false, error: { type: "INVALID_API_KEY", message: "nope" } };
    const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch(body) }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_AUTH_FAILED" }));
  });

  it("fails on a network error after retries", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await collectSocialCrawlReviews(deps({ fetchFn, maxRetries: 2 }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_FETCH_FAILED" }));
  });

  it("fails when the request times out", async () => {
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const controller = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        controller?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }) as unknown as typeof fetch;
    const result = await collectSocialCrawlReviews(deps({ fetchFn, timeoutMs: 1 }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_TIMEOUT" }));
  });

  it("fails fast when the caller aborts the signal", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }) as unknown as typeof fetch;
    const resultPromise = collectSocialCrawlReviews(deps({ fetchFn, signal: controller.signal }));
    controller.abort();
    const result = await resultPromise;
    expect(result.status).toBe("failed");
  });

  it("fails when the envelope omits required top-level fields", async () => {
    const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch({ success: true }) }));
    expect(result.status).toBe("failed");
    expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_INVALID_RESPONSE" }));
  });
});
