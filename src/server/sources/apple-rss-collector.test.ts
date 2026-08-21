import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPageUrl, collectAppleReviews, type CollectorDeps } from "./apple-rss-collector";

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
  it("uses Apple's case-sensitive sortBy segment when building page URLs", () => {
    expect(buildPageUrl("https://itunes.apple.com/us/rss/customerreviews", 1, "839285684")).toBe(
      "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json",
    );
  });

  it("does not call fetch when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = depsFor({});
    deps.signal = controller.signal;

    const result = await collectAppleReviews(deps);

    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("interrupts the delay between pages when the caller aborts", async () => {
    const controller = new AbortController();
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("page-01.json") });
    const sleeping = Promise.withResolvers<void>();
    const releaseSleep = Promise.withResolvers<void>();
    deps.signal = controller.signal;
    deps.sleep = vi.fn(async () => {
      sleeping.resolve();
      await releaseSleep.promise;
    });

    const result = collectAppleReviews(deps);
    await sleeping.promise;
    controller.abort();

    await expect(result).rejects.toThrow(/aborted/i);
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
    releaseSleep.resolve();
  });

  it("uses App Store-compatible request headers so the live feed returns reviews", async () => {
    const page1 = JSON.parse(fixture("page-01.json"));
    page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
      "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";

    const deps = depsFor({});
    deps.fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const isCompatibleRequest =
        String(input).includes("/sortBy=mostRecent/json") &&
        headers.get("accept") === "application/json" &&
        headers.get("user-agent")?.startsWith("Mozilla/5.0 ");
      return makeResponse(isCompatibleRequest ? JSON.stringify(page1) : fixture("empty-feed.json"));
    }) as unknown as typeof fetch;
    deps.emptyPageRetryDelaysMs = [];

    const result = await collectAppleReviews(deps);

    expect(result.status).toBe("complete");
    expect(result.reviews).toHaveLength(2);
  });

  it("collects reviews sequentially across pages until pagination ends", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    // Advertise lastPage=2 so the empty page 2 is a natural end, not an
    // abnormally early one.
    const page1 = JSON.parse(fixture("page-01.json"));
    page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
      "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: JSON.stringify(page1), [url2]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("complete");
    expect(result.reviews).toHaveLength(2);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns partial with RSS_NON_JSON when page 2 is HTML, keeping page-1 reviews", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    // Advertise lastPage=5 so page 2 is well before the natural end.
    const page1 = JSON.parse(fixture("page-01.json"));
    page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
      "https://itunes.apple.com/us/rss/customerreviews/page=5/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: JSON.stringify(page1), [url2]: "<html>request blocked</html>" });
    const result = await collectAppleReviews(deps);
    // A structural failure beyond page 1 must not silently read as the natural
    // end of pagination ("complete").
    expect(result.status).toBe("partial");
    expect(result.reviews).toHaveLength(2);
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
  });

  it("stops paginating and truncates exactly at a requested reviewLimit", async () => {
    // A single page carrying more reviews than the limit (each ~20 chars) and a
    // rel=last advertising more pages, to prove the collector stops early.
    const makeEntries = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: { label: String(start + i) },
        author: { name: { label: `r${start + i}` }, uri: { label: "https://itunes.apple.com/us/reviews?user=x" } },
        updated: { label: "2026-07-20T18:04:23-07:00" },
        "im:rating": { label: "5" },
        "im:version": { label: "3.2.1" },
        title: { label: `t ${start + i}` },
        content: { label: `body ${start + i}`, attributes: { type: "text" } },
        link: { attributes: { rel: "alternate", href: `https://apps.apple.com/us/review?appId=839285684&reviewId=${start + i}` } },
      }));
    const page1 = {
      feed: {
        entry: makeEntries(0, 40),
        link: [
          { attributes: { rel: "self", href: "page=1" } },
          { attributes: { rel: "last", href: "https://itunes.apple.com/us/rss/customerreviews/page=5/id=839285684/sortBy=mostRecent/json" } },
        ],
      },
    };
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    const url3 = "https://itunes.apple.com/us/rss/customerreviews/page=3/id=839285684/sortBy=mostRecent/json";
    const page2 = { feed: { entry: makeEntries(40, 40), link: [{ attributes: { rel: "last", href: "page=5" } }] } };
    const page3 = { feed: { entry: makeEntries(80, 30), link: [{ attributes: { rel: "last", href: "page=5" } }] } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(url1)) return makeResponse(JSON.stringify(page1));
      if (url.startsWith(url2)) return makeResponse(JSON.stringify(page2));
      if (url.startsWith(url3)) return makeResponse(JSON.stringify(page3));
      return makeResponse(JSON.stringify({ feed: { entry: [] } }));
    });
    const deps = depsFor({});
    deps.fetchFn = fetchMock as unknown as typeof fetch;
    deps.reviewLimit = 100;

    const result = await collectAppleReviews(deps);
    expect(result.reviews).toHaveLength(100);
    expect(result.rawRefs).toHaveLength(100);
    // 40 + 40 + 20 needed to reach 100, so page 3 must be requested, then stop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.limitations.some((l) => l.code === "RSS_APP_CAP")).toBe(true);
  });

  it("treats an HTTP 200 empty first page as suspect-empty", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("suspect-empty");
    expect(result.reviews).toHaveLength(0);
    expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
  });

  it("treats an HTTP 200 feed with no entry property as suspect-empty", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("empty-feed-no-entry.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("suspect-empty");
    expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(false);
  });

  it("keeps a non-array entry property classified as RSS_NON_JSON", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("malformed-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
    expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(false);
  });

  it("retries an empty page 1 twice and returns suspect-empty without fetching page 2", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    // Original attempt + 2 retries (2s, 5s), never reaching page 2.
    expect(deps.fetchFn).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("suspect-empty");
  });

  it("recovers from an empty page 1 when a retry returns reviews", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // First attempt empty, retries return real content. Advertise lastPage=1
      // so pagination ends after the recovered page 1.
      if (calls.length === 1) return makeResponse(fixture("empty-feed.json"));
      const page1 = JSON.parse(fixture("page-01.json"));
      page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
        "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
      return makeResponse(JSON.stringify(page1));
    });
    const deps = depsFor({});
    deps.fetchFn = fetchMock as unknown as typeof fetch;
    deps.emptyPageRetryDelaysMs = [1, 1];
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("complete");
    expect(result.reviews.length).toBe(2);
    // The recovered retry carries a cache-busting query param.
    expect(calls.some((c) => c.includes("_="))).toBe(true);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("marks partial when an empty page is still before the advertised last page", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    // page-01.json advertises lastPage=10; page 2 is empty -> abnormal early end.
    const deps = depsFor({ [url1]: fixture("page-01.json"), [url2]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("partial");
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.limitations.some((l) => l.code === "RSS_UNSTABLE_PAGINATION")).toBe(true);
  });

  it("ends pagination naturally without retrying when page >= lastPage", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    const page1 = JSON.parse(fixture("page-01.json"));
    page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
      "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: JSON.stringify(page1), [url2]: fixture("empty-feed.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("complete");
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
    expect(result.limitations.some((l) => l.code === "RSS_UNSTABLE_PAGINATION")).toBe(false);
  });

  it("records the attempt number on each page evidence", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (calls.length === 1) return makeResponse(fixture("empty-feed.json"));
      // Advertise lastPage=1 so the recovered page 1 is also the natural end,
      // and the collector never requests page 2.
      const page1 = JSON.parse(fixture("page-01.json"));
      page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
        "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
      return makeResponse(JSON.stringify(page1));
    });
    const deps = depsFor({});
    deps.fetchFn = fetchMock as unknown as typeof fetch;
    deps.emptyPageRetryDelaysMs = [1];
    const result = await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
    const attempts = result.pages.map((p) => p.attempt).sort();
    expect(attempts).toEqual([1, 2]);
  });

  it("fails on a first-page network failure without entering model stages", async () => {
    const deps = depsFor({});
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.reviews).toHaveLength(0);
    expect(result.limitations.some((l) => l.code === "RSS_FETCH_FAILED")).toBe(true);
  });

  it("marks partial when page 1 succeeds but page 2 fails", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("page-01.json") });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("partial");
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(result.limitations.some((l) => l.code === "RSS_PARTIAL")).toBe(true);
  });

  it("treats an HTTP 200 non-JSON first page as RSS_NON_JSON failure, not suspect-empty", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: "<html>not a feed</html>" });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
    expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(false);
  });

  it("treats an HTTP 200 body missing a feed object as RSS_NON_JSON failure", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: JSON.stringify({ not: "a feed" }) });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
  });

  it("stops when a page repeats the previous body hash", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: fixture("page-01.json"), [url2]: fixture("page-01.json") });
    const result = await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
    expect(result.limitations.some((l) => l.code === "RSS_REPEATED_PAGE")).toBe(true);
  });

  it("respects the delay between pages", async () => {
    const page1 = fixture("page-01.json");
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const url2 = "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: page1, [url2]: page1 });
    await collectAppleReviews(deps);
    expect(deps.sleep).toHaveBeenCalled();
  });

  it("caps at max pages", async () => {
    const page1 = fixture("page-01.json");
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: page1 });
    deps.maxPages = 2;
    deps.pageDelayMs = 0;
    // Every page returns the same body, so repeated-page detection would stop us.
    // Provide distinct bodies per page to force pagination to run to the cap.
    const bodies: Record<string, string> = {};
    for (let i = 1; i <= 2; i++) {
      const j = JSON.parse(page1);
      j.feed.entry[0].id.label = `page-${i}-id`;
      bodies[`https://itunes.apple.com/us/rss/customerreviews/page=${i}/id=839285684/sortBy=mostRecent/json`] =
        JSON.stringify(j);
    }
    deps.fetchFn = vi.fn(async (input: RequestInfo | URL) => makeResponse(bodies[String(input)] ?? "<error>"));
    const result = await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("complete");
  });
});

describe("raw source file archiving", () => {
  it("archives one sourceFile per successful request with an attempt-level path", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const page1 = fixture("page-01.json");
    const deps = depsFor({ [url1]: page1 });
    // Advertise lastPage=1 so pagination ends naturally after page 1.
    deps.fetchFn = vi.fn(async () => {
      const j = JSON.parse(page1);
      j.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
        "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
      return makeResponse(JSON.stringify(j));
    }) as unknown as typeof fetch;
    const result = await collectAppleReviews(deps);
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.sourceFiles[0].relativePath).toBe("sources/apple/page-01.attempt-01.json");
    // The archived content is the exact body the collector received.
    expect(JSON.parse(result.sourceFiles[0].content).feed.entry).toHaveLength(2);
    // PageEvidence.rawFile matches the archived path.
    expect(result.pages[0].rawFile).toBe("sources/apple/page-01.attempt-01.json");
  });

  it("points every review rawRef at the attempt file that actually provided it", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const page1 = fixture("page-01.json");
    const deps = depsFor({ [url1]: page1 });
    // Advertise lastPage=1 so pagination ends after page 1.
    deps.fetchFn = vi.fn(async () => {
      const j = JSON.parse(page1);
      j.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
        "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
      return makeResponse(JSON.stringify(j));
    }) as unknown as typeof fetch;
    const result = await collectAppleReviews(deps);
    expect(result.reviews.length).toBeGreaterThan(0);
    for (const ref of result.rawRefs) {
      expect(ref).toMatch(/^sources\/apple\/page-01\.attempt-01\.json#/);
    }
    // The parser's rawRef fragment (entry id) is preserved after the file.
    expect(result.rawRefs[0].split("#")[1]).toBeTruthy();
  });

  it("archives each attempt separately when page 1 empties twice then succeeds", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // First two attempts empty, third returns real content.
      if (calls.length <= 2) return makeResponse(fixture("empty-feed.json"));
      const page1 = JSON.parse(fixture("page-01.json"));
      page1.feed.link.find((l: { attributes?: { rel?: string } }) => l.attributes?.rel === "last").attributes.href =
        "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
      return makeResponse(JSON.stringify(page1));
    });
    const deps = depsFor({});
    deps.fetchFn = fetchMock as unknown as typeof fetch;
    deps.emptyPageRetryDelaysMs = [1, 1];
    const result = await collectAppleReviews(deps);
    expect(deps.fetchFn).toHaveBeenCalledTimes(3);
    // Three distinct attempt-level files, one per HTTP request.
    const paths = result.sourceFiles.map((f) => f.relativePath);
    expect(paths).toEqual([
      "sources/apple/page-01.attempt-01.json",
      "sources/apple/page-01.attempt-02.json",
      "sources/apple/page-01.attempt-03.json",
    ]);
    // The empty retries are archived too, so failures are independently verifiable.
    expect(result.sourceFiles[0].content).toBe(fixture("empty-feed.json"));
  });

  it("measures byteLength in UTF-8 bytes, not JS string length", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    // A body with multi-byte characters: "é" is 2 UTF-8 bytes, "好" is 3.
    const body = JSON.stringify({ feed: { entry: [], link: [] }, note: "café 好评" });
    const deps = depsFor({ [url1]: body });
    const result = await collectAppleReviews(deps);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(body.length);
    expect(result.pages[0].byteLength).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("archives non-JSON failure responses for later forensics", async () => {
    const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortBy=mostRecent/json";
    const deps = depsFor({ [url1]: "<html>not a feed</html>" });
    const result = await collectAppleReviews(deps);
    expect(result.status).toBe("failed");
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.sourceFiles[0].content).toBe("<html>not a feed</html>");
  });
});
