import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST } from "./route";
import { readPreview } from "@/server/sources/source-preview";
import { resetRuntimeSocialCrawlConfig } from "@/server/config";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "apple", name), "utf8");
}

function socialFixture(): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "socialcrawl", "app-reviews.json"), "utf8");
}

function socialEnvelope(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

let baseDir: string;
const saved = { ...process.env };

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "preview-route-"));
  process.env = { ...saved };
  process.env.RUNS_DIR = path.join(baseDir, "runs");
  process.env.SOURCE_CACHE_DIR = path.join(baseDir, "cache");
  process.env.SOURCE_PREVIEWS_DIR = path.join(baseDir, "previews");
  process.env.APPLE_RSS_PAGE_DELAY_MS = "0";
  delete process.env.SOCIALCRAWL_API_KEY;
  delete process.env.SOCIALCRAWL_BASE_URL;
  resetRuntimeSocialCrawlConfig();
});

afterEach(() => {
  process.env = saved;
  vi.unstubAllGlobals();
  resetRuntimeSocialCrawlConfig();
  rmSync(baseDir, { recursive: true, force: true });
});

function validBody(): Request {
  return new Request("http://localhost/api/source-previews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "1", appStoreUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684" }),
  });
}

describe("POST /api/source-previews", () => {
  it("rejects a non-https URL with 422", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await POST(new Request("http://localhost/api/source-previews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "1", appStoreUrl: "http://apps.apple.com/us/app/x/id1" }),
    }));
    expect(res.status).toBe(422);
  });

  it("returns summaries without leaking full reviews", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/page=1/")) return new Response(fixture("page-01.json"), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
    }));
    const res = await POST(validBody());
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.previewId).toMatch(/^preview-/);
    expect((json.live as Record<string, unknown>).reviewCount).toBe(2);
    // The response must not carry the review bodies.
    expect(JSON.stringify(json)).not.toContain("Great workout app");
    expect(JSON.stringify(json)).not.toContain("entry");
  });

  it("persists a snapshot that includes the full live reviews server-side", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/page=1/")) return new Response(fixture("page-01.json"), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
    }));
    const res = await POST(validBody());
    const json = (await res.json()) as { previewId: string };
    const snapshot = await readPreview(process.env.SOURCE_PREVIEWS_DIR!, json.previewId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.live.reviews.length).toBe(2);
    expect(snapshot!.live.reviews[0].body).toBe("I love the variety of workouts. Easy to follow at home.");
  });

  it("accepts a China page URL but collects from the US storefront via RSS", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/page=1/")) return new Response(fixture("page-01.json"), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(new Request("http://localhost/api/source-previews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "1", appStoreUrl: "https://apps.apple.com/cn/app/workout-for-women-home-gym/id839285684" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).canonicalUrl)
      .toBe("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684");
    expect(fetchMock.mock.calls.every(([url]) =>
      String(url).includes("/us/rss/customerreviews/"),
    )).toBe(true);
  });

  it("sets cache-control: no-store", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/page=1/")) return new Response(fixture("page-01.json"), { status: 200 });
      return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
    }));
    const res = await POST(validBody());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("uses SocialCrawl when a key is configured and sends the exact wire contract", async () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_route_test";
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return socialEnvelope(JSON.parse(socialFixture()));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(validBody());
    expect(res.status).toBe(200);
    const json = (await res.clone().json()) as { live: Record<string, unknown>; previewId: string };
    expect(json.live.provider).toBe("socialcrawl");
    expect(json.live.reviewCount).toBe(2);
    expect(json.live.creditsUsed).toBe(5);
    expect(json.live.requestId).toBe("req_fixture");

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("app_id")).toBe("839285684");
    expect(url.searchParams.get("country")).toBe("US");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("depth")).toBe("500");
    expect(url.searchParams.get("sort_by")).toBe("most_recent");
    expect(capturedHeaders?.get("cache-control")).toBe("no-cache");
    expect(capturedHeaders?.get("x-api-key")).toBe("sc_route_test");
    expect(capturedHeaders?.get("idempotency-key")).toBe(json.previewId);
    // The key must never leak into the public response or the snapshot.
    expect(JSON.stringify(await res.clone().json())).not.toContain("sc_route_test");
    expect(JSON.stringify(await readPreview(process.env.SOURCE_PREVIEWS_DIR!, json.previewId))).not.toContain("sc_route_test");
  });

  it("uses SocialCrawl for a China page URL with country=US", async () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_route_test";
    let capturedUrl = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return socialEnvelope(JSON.parse(socialFixture()));
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(new Request("http://localhost/api/source-previews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "1", appStoreUrl: "https://apps.apple.com/cn/app/workout-for-women-home-gym/id839285684" }),
    }));
    expect(res.status).toBe(200);
    expect(new URL(capturedUrl).searchParams.get("country")).toBe("US");
  });
});
