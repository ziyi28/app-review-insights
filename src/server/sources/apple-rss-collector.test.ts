import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectAppleReviews, type CollectorDeps } from "./apple-rss-collector";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "apple", name), "utf8");
}

function makeResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/javascript; charset=UTF-8" } });
}

function depsFor(urlToBody: Record<string, string>): CollectorDeps {
  const fetchMock = vi.fn(async (url: string) => {
    const body = urlToBody[url];
    if (body === undefined) return makeResponse("<error>", 500);
    return makeResponse(body);
  });
  return {
    fetchFn: fetchMock as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => "2026-08-12T00:00:00.000Z",
    baseUrl: "https://itunes.apple.com/us/rss/customerreviews",
    appId: "839285684",
    maxPages: 10,
    pageDelayMs: 500,
    timeoutMs: 10_000,
  };
}

describe("collectAppleReviews", () => {
  it("collects reviews sequentially across pages until pagination ends", async () => {
    const page1 = fixture("page-01.json");
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: page1, [url2]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("complete");
    expect(result.reviews).toHaveLength(2);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("treats an HTTP 200 empty first page as suspect-empty", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("suspect-empty");
    expect(result.reviews).toHaveLength(0);
    expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
  });

  it("stops after page 1 with no reviews (suspect-empty) without fetching page 2", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("empty-feed.json") });
    await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fails on a first-page network failure without entering model stages", async () => {
    const deps = depsFor({});
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.reviews).toHaveLength(0);
    expect(result.limitations.some((l) => l.code === "RSS_FETCH_FAILED")).toBe(true);
  });

  it("marks partial when page 1 succeeds but page 2 fails", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("page-01.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("partial");
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.limitations.some((l) => l.code === "RSS_PARTIAL")).toBe(true);
  });

  it("treats an HTTP 200 non-JSON first page as RSS_NON_JSON failure, not suspect-empty", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: "<html>not a feed</html>" });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
    expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(false);
  });

  it("treats an HTTP 200 body missing a feed object as RSS_NON_JSON failure", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: JSON.stringify({ not: "a feed" }) });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
  });

  it("stops when a page repeats the previous body hash", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("page-01.json"), [url2]: fixture("page-01.json") });
    const result = await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
    expect(result.limitations.some((l) => l.code === "RSS_REPEATED_PAGE")).toBe(true);
  });

  it("respects the delay between pages", async () => {
    const page1 = fixture("page-01.json");
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: page1, [url2]: page1 });
    await collectAppleReviews(deps);
    expect(deps.sleep).toHaveBeenCalled();
  });

  it("caps at max pages", async () => {
    const page1 = fixture("page-01.json");
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
    const deps = depsFor({ [url1]: page1 });
    deps.maxPages = 2;
    deps.pageDelayMs = 0;
    // Every page returns the same body, so repeated-page detection would stop us.
    // Provide distinct bodies per page to force pagination to run to the cap.
    const bodies: Record<string, string> = {};
    for (let i = 1; i <= 2; i++) {
      const j = JSON.parse(page1);
      j.feed.entry[0].id.label = `page-${i}-id`;
      bodies[`https://itunes.apple.com/us/rss/customerreviews/page=${i}/id=839285684/sortby=mostRecent/json`] =
        JSON.stringify(j);
    }
    deps.fetchFn = vi.fn(async (input: RequestInfo | URL) => makeResponse(bodies[String(input)] ?? "<error>"));
    const result = await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("complete");
  });
});
