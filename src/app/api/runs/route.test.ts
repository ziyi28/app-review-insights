import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import { POST } from "./route";
import type { SourcePreview } from "@/server/sources/source-preview";

let baseDir: string;
const saved = { ...process.env };

function snapshot(reviewCount: number, opts: { expiresAt?: string; appId?: string; liveStatus?: string } = {}): SourcePreview {
  // Created "now" (relative) so the snapshot is not already expired when the
  // route validates it against the real clock.
  const now = new Date().toISOString();
  const reviews: RawReview[] = Array.from({ length: reviewCount }, (_, i) => ({
    sourceReviewId: `live-${i}`,
    source: "apple-rss",
    title: `t ${i}`,
    body: `body ${i}`,
    rating: 5,
    version: "1.0",
    updatedAt: "2026-08-01T00:00:00Z",
  }));
  return {
    protocolVersion: "1",
    previewId: "preview-test",
    appId: opts.appId ?? "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/x/id839285684",
    createdAt: now,
    expiresAt: opts.expiresAt ?? new Date(new Date(now).getTime() + 30 * 60 * 1000).toISOString(),
    live: {
      status: (opts.liveStatus ?? "complete") as "complete",
      reviewCount,
      pageCount: 1,
      requestCount: 1,
      dateRange: { earliest: null, latest: null },
      limitations: [],
      reviews,
      rawRefs: reviews.map((r) => `sources/apple/page-01.json#entry-${r.sourceReviewId}`),
    },
    stable: { available: false, reviewCount: 0, cacheUpdatedAt: null, dateRange: { earliest: null, latest: null }, bootstrapRunId: null, reviews: [] },
    recommendedSelection: reviewCount > 0 ? "live" : null,
  };
}

function writeSnapshot(preview: SourcePreview): void {
  const dir = process.env.SOURCE_PREVIEWS_DIR!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${preview.previewId}.json`), JSON.stringify(preview), "utf8");
}

function analyzeRequest(previewId: string, selection: "live" | "stable"): Request {
  return new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "1",
      mode: "analyze",
      uiLocale: "en",
      outputLocale: "en",
      goal: "Understand why users love this app",
      source: {
        kind: "live",
        appStoreUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
        previewId,
        reviewSelection: selection,
      },
    }),
  });
}

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "runs-route-"));
  process.env = { ...saved };
  process.env.RUNS_DIR = path.join(baseDir, "runs");
  process.env.SOURCE_CACHE_DIR = path.join(baseDir, "cache");
  process.env.SOURCE_PREVIEWS_DIR = path.join(baseDir, "previews");
  process.env.MODEL_BASE_URL = "https://example.com/v1";
  process.env.MODEL_NAME = "model";
});

afterEach(() => {
  process.env = saved;
  rmSync(baseDir, { recursive: true, force: true });
});

describe("POST /api/runs preview-backed live", () => {
  it("rejects a previewId without a reviewSelection", async () => {
    const req = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: "en",
        outputLocale: "en",
        goal: "Understand why users love this app",
        source: { kind: "live", appStoreUrl: "https://apps.apple.com/us/app/x/id839285684", previewId: "preview-test" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title?: string };
    expect(body.title).toContain("together");
  });

  it("rejects a missing preview (404)", async () => {
    writeSnapshot(snapshot(1));
    const res = await POST(analyzeRequest("preview-missing", "live"));
    expect(res.status).toBe(404);
  });

  it("rejects an expired preview (422)", async () => {
    writeSnapshot(snapshot(1, { expiresAt: "2026-08-11T00:00:00.000Z" }));
    const res = await POST(analyzeRequest("preview-test", "live"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title?: string };
    expect(body.title).toContain("expired");
  });

  it("rejects an appId mismatch (422)", async () => {
    writeSnapshot(snapshot(1, { appId: "999" }));
    const res = await POST(analyzeRequest("preview-test", "live"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title?: string };
    expect(body.title).toContain("mismatch");
  });

  it("rejects an unavailable live dataset (422)", async () => {
    writeSnapshot(snapshot(0));
    const res = await POST(analyzeRequest("preview-test", "live"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title?: string };
    expect(body.title).toContain("unavailable");
  });

  it("accepts a China page URL and matches the US app id preview", async () => {
    writeSnapshot(snapshot(1, { appId: "839285684" }));
    const req = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: "en",
        outputLocale: "en",
        goal: "Understand why users love this app",
        source: {
          kind: "live",
          appStoreUrl: "https://apps.apple.com/cn/app/workout-for-women-home-gym/id839285684",
          previewId: "preview-test",
          reviewSelection: "live",
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  });

  it("rejects an unavailable stable dataset when stable has no reviews (422)", async () => {
    writeSnapshot(snapshot(1));
    const res = await POST(analyzeRequest("preview-test", "stable"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title?: string };
    expect(body.title).toContain("unavailable");
  });
});
