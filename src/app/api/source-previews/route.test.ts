import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST } from "./route";
import { readPreview } from "@/server/sources/source-preview";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "apple", name), "utf8");
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
});

afterEach(() => {
  process.env = saved;
  vi.unstubAllGlobals();
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

  it("sets cache-control: no-store", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/page=1/")) return new Response(fixture("page-01.json"), { status: 200 });
      return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
    }));
    const res = await POST(validBody());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
