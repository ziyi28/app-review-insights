import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RawReview } from "@/domain/contracts/review";
import type { SourcePreview } from "@/server/sources/source-preview";
import { RunStore } from "@/server/runs/run-store";
import { isRunActive, resetActiveRuns } from "@/server/runs/run-executor";

// The route schedules the pipeline via `after()` (which needs a request scope).
// Tests run the route handler directly, so `after` is stubbed to capture the
// scheduled callback; the pipeline is then exercised by invoking it manually.
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: vi.fn() };
});

vi.mock("@/server/sources/apple-rss-collector", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/sources/apple-rss-collector")>();
  return {
    ...mod,
    collectAppleReviews: vi.fn().mockResolvedValue({
      status: "complete",
      reviews: [
        {
          sourceReviewId: "mock-1",
          source: "apple-rss",
          title: "Great",
          body: "Good app",
          rating: 5,
          version: "1.0",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
      rawRefs: ["sources/apple/page-01.json#entry-mock-1"],
      limitations: [],
      pages: [],
      sourceFiles: [],
    }),
  };
});

import { GET, POST } from "./route";
import { after } from "next/server";

const afterMock = after as unknown as Mock;

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
    reviewLimit: 500,
    live: {
      provider: "apple-rss",
      forcedRefresh: false,
      cached: null,
      collectedAt: now,
      status: (opts.liveStatus ?? "complete") as "complete",
      reviewCount,
      pageCount: 1,
      requestCount: 1,
      dateRange: { earliest: null, latest: null },
      limitations: [],
      evidence: { provider: "apple-rss", pageCount: 1, requestCount: 1 },
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

/** A SerpApi-backed preview snapshot (forced fresh, 2 reviews). */
function serpSnapshot(): SourcePreview {
  const now = new Date().toISOString();
  const reviews: RawReview[] = [
    { sourceReviewId: "review-1", source: "serpapi-apple-reviews", title: "Useful", body: "The guided workout is clear.", rating: 5, version: "8.2.0", updatedAt: "2026-08-12T00:00:00.000Z" },
    { sourceReviewId: "review-2", source: "serpapi-apple-reviews", title: "Timer issue", body: "The timer resets after backgrounding.", rating: 1, version: "8.2.0", updatedAt: "2026-08-11T00:00:00.000Z" },
  ];
  return {
    protocolVersion: "1",
    previewId: "preview-serp",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/x/id839285684",
    createdAt: now,
    expiresAt: new Date(new Date(now).getTime() + 30 * 60 * 1000).toISOString(),
    reviewLimit: 500,
    live: {
      provider: "serpapi",
      forcedRefresh: true,
      cached: false,
      collectedAt: now,
      status: "complete",
      reviewCount: 2,
      pageCount: 1,
      requestCount: 1,
      dateRange: { earliest: "2026-08-11T00:00:00.000Z", latest: "2026-08-12T00:00:00.000Z" },
      limitations: [],
      evidence: {
        provider: "serpapi",
        endpoint: "/search.json",
        engine: "apple_reviews",
        country: "us",
        sort: "mostrecent",
        noCache: true,
        startedAt: now,
        finishedAt: now,
        httpStatus: 200,
        requestCount: 1,
        pagesFetched: 1,
        searchIds: ["search_page_1"],
        parserDropped: 0,
      },
      reviews,
      rawRefs: reviews.map((r) => `serpapi:search_page_1#review:${r.sourceReviewId}`),
    },
    stable: { available: false, reviewCount: 0, cacheUpdatedAt: null, dateRange: { earliest: null, latest: null }, bootstrapRunId: null, reviews: [] },
    recommendedSelection: "live",
  };
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
  resetActiveRuns();
  afterMock.mockClear();
});

afterEach(() => {
  process.env = saved;
  rmSync(baseDir, { recursive: true, force: true });
  resetActiveRuns();
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

  it("accepts a China page URL, matches the US app id preview, and returns 202 immediately", async () => {
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
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string; status: string; eventsUrl: string };
    expect(body.runId).toMatch(/^run-/);
    expect(body.status).toBe("running");
    expect(body.eventsUrl).toBe(`/api/runs/${body.runId}/events`);

    // The run is identifiable (running manifest), registered as active, and has
    // already persisted a run.accepted event before the response returned.
    expect(isRunActive(body.runId)).toBe(true);
    const store = new RunStore(process.env.RUNS_DIR!);
    const manifest = await store.readManifest(body.runId);
    expect(manifest.status).toBe("running");
    const eventsText = await (await import("node:fs")).promises.readFile(
      path.join(store.resolveRunDir(body.runId), "events.ndjson"),
      "utf8",
    );
    expect(eventsText).toContain("run.accepted");
  });

  it("rejects an unavailable stable dataset when stable has no reviews (422)", async () => {
    writeSnapshot(snapshot(1));
    const res = await POST(analyzeRequest("preview-test", "stable"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title?: string };
    expect(body.title).toContain("unavailable");
  });

  it("persists SerpApi provider provenance without leaking the key", async () => {
    writeSnapshot(serpSnapshot());
    // No model configured: the deterministic source/prepare stages still run,
    // the source-evidence artifact is still written, and the run completes with
    // MODEL_NOT_CONFIGURED — exactly what this provenance test needs.
    delete process.env.MODEL_BASE_URL;
    delete process.env.MODEL_NAME;
    const res = await POST(analyzeRequest("preview-serp", "live"));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^run-/);

    // The route schedules the pipeline via after(); invoke the captured callback
    // to run it to completion, exactly as the request scope would after the
    // response is sent.
    const callback = afterMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
    expect(callback).toBeTypeOf("function");
    await callback!();

    // The task unregisters on completion.
    expect(isRunActive(body.runId)).toBe(false);

    const store = new RunStore(process.env.RUNS_DIR!);
    const sourceEvidence = (await store.readArtifact(body.runId, "source-evidence", 1)) as Record<string, unknown>;
    expect(sourceEvidence).toMatchObject({
      kind: "app-store-reviews",
      provider: "serpapi",
      appId: "839285684",
      storefront: "US",
      selection: "live",
      reviewCount: 2,
      forcedRefresh: true,
      providerCached: false,
      searchCount: 1,
      searchId: "search_page_1",
    });
    expect(JSON.stringify(sourceEvidence)).not.toContain("serp_");
  });

  it("auto-builds preview snapshot for direct live request without previewId (e.g. historical retry)", async () => {
    delete process.env.MODEL_BASE_URL;
    delete process.env.MODEL_NAME;
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
          appStoreUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^run-/);

    const callback = afterMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
    expect(callback).toBeTypeOf("function");
    await callback!();

    expect(isRunActive(body.runId)).toBe(false);
    const store = new RunStore(process.env.RUNS_DIR!);
    const sourceEvidence = (await store.readArtifact(body.runId, "source-evidence", 1)) as Record<string, unknown>;
    expect(sourceEvidence).toBeDefined();
    expect(sourceEvidence.kind).toBe("app-store-reviews");
  });
});

describe("GET /api/runs listing", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), "runs-list-route-"));
    process.env = { ...saved };
    process.env.RUNS_DIR = path.join(baseDir, "runs");
  });

  afterEach(() => {
    process.env = saved;
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("marks runtime runs deletable and bundled fixtures non-deletable", async () => {
    const store = new RunStore(process.env.RUNS_DIR!);
    const runId = store.createRunId();
    await store.writeManifest(runId, {
      runId,
      status: "completed",
      executionMode: "live",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "",
      stages: {},
      artifacts: {},
      limitations: [],
      canReplay: true,
    });

    const res = await GET();
    const body = (await res.json()) as { runs: { runId: string; deletable: boolean }[] };

    const runtimeRun = body.runs.find((r) => r.runId === runId);
    expect(runtimeRun?.deletable).toBe(true);

    const demoRun = body.runs.find((r) => r.runId === "run-x-twitter-us");
    expect(demoRun?.deletable).toBe(false);
  });
});
