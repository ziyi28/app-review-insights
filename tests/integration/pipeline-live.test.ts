import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps } from "@/server/pipeline/orchestrator";
import { ScriptedModelClient } from "@/server/model/scripted-client";

const PAGE1 = JSON.stringify({
  feed: {
    entry: [
      {
        id: { label: "r1" },
        updated: { label: "2026-07-01T10:00:00Z" },
        "im:rating": { label: "5" },
        "im:version": { label: "3.2.1" },
        title: { label: "Great" },
        content: { label: "I love the workout variety and easy to follow at home.", attributes: { type: "text" } },
      },
    ],
    link: [],
  },
});

function makeDeps(scriptedModel: ScriptedModelClient): ExecuteDeps {
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/page=1/")) {
      return new Response(PAGE1, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
  }) as unknown as typeof fetch;

  return {
    model: scriptedModel,
    source: {
      kind: "apple-rss",
      appleRssBaseUrl: "https://itunes.apple.com/us/rss/customerreviews",
      appId: "839285684",
      canonicalUrl: "https://apps.apple.com/us/app/workout/id839285684",
    },
    fetchFn,
    sleep: async () => {},
    now: () => "2026-08-12T00:00:00.000Z",
    pageDelayMs: 0,
    maxPages: 10,
    timeoutMs: 5000,
  };
}

/**
 * Builds the scripted model responses using the real prepared reviewId so the
 * downstream ledger (findings -> requirements -> tests) is internally
 * consistent, exactly as a live model would see it.
 */
async function buildScript(): Promise<string[]> {
  const { parseAppleRssJson } = await import("@/server/sources/apple-rss-parser");
  const { prepareReviews } = await import("@/domain/reviews/prepare");
  const parsed = parseAppleRssJson(PAGE1);
  const prepared = prepareReviews({ kind: "collected", reviews: parsed.reviews, rawRefs: parsed.rawRefs, limitations: [] });
  const review = prepared.reviews[0];
  const rid = review.reviewId;

  return [
    // scope
    JSON.stringify({ interpretation: "Pricing focus", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
    // topic discovery
    JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Workout quality", description: "d", supportingReviewIds: [rid], quote: "workout variety" }] }),
    // topic consolidation
    JSON.stringify({ topics: [{ id: "topic-1", label: "Workout quality", description: "d", candidateIds: ["topic-candidate-1"] }] }),
    // findings
    JSON.stringify({
      findings: [
        {
          id: "finding-1",
          topicIds: ["topic-1"],
          title: "Loves variety",
          summary: "Users praise workout variety",
          supportingReviewIds: [rid],
          evidenceExcerpts: [{ reviewId: rid, excerpt: "workout variety" }],
          conflictingReviewIds: [],
          uncertainties: [],
          limitations: [],
        },
      ],
    }),
    // planning
    JSON.stringify({
      title: "Release plan",
      overview: "Improve workout experience",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Content", rationale: "Ships the variety improvements first", requirementIds: ["req-1"] }],
      requirements: [
        {
          id: "req-1",
          findingIds: ["finding-1"],
          title: "Add workout variety",
          description: "more workouts",
          priority: "P1",
          acceptanceCriteria: ["new workouts available"],
          versionId: "ver-1",
          planningFactors: {
            severity: "high",
            userImpact: "high",
            implementationScope: "medium",
            dependencyRequirementIds: [],
            rationale: "Supported user impact and bounded implementation scope",
          },
        },
      ],
      assumptions: [],
    }),
    // tests
    JSON.stringify({
      tests: [
        { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "logged in", steps: ["open app", "browse workouts"], expectedResult: "new workouts listed" },
      ],
    }),
  ];
}

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pipeline-"));
  store = new RunStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function collectEvents(runId: string): Promise<unknown[]> {
  const file = path.join(store.resolveRunDir(runId), "events.ndjson");
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

describe("executeRun (live pipeline)", () => {
  it("runs the full pipeline and completes with traceability pass", async () => {
    const model = new ScriptedModelClient(await buildScript());
    const deps = makeDeps(model);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand why users love it", "en", deps, publisher, store);

    const events = await collectEvents(runId);
    const last = events.at(-1) as { type: string };
    expect(last.type).toBe("run.completed");

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.canReplay).toBe(true);
    // The analysis goal is persisted so the history list can show it.
    expect(manifest.goal).toBe("Understand why users love it");

    const prd = (await store.readArtifact(runId, "prd", 1)) as { requirements: unknown[] };
    expect(prd.requirements).toHaveLength(1);
  });

  it("publishes stats, topic-candidates, evidence-validation and version-plan intermediates in stage order", async () => {
    const model = new ScriptedModelClient(await buildScript());
    const deps = makeDeps(model);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand why users love it", "en", deps, publisher, store);

    const events = await collectEvents(runId) as { type: string; stage?: string }[];
    const stages = events.filter((e) => e.type === "stage.started").map((e) => e.stage);
    const fIdx = stages.indexOf("findings");
    const evIdx = stages.indexOf("evidence-validation");
    const pIdx = stages.indexOf("planning");
    expect(fIdx).toBeGreaterThan(-1);
    expect(evIdx).toBeGreaterThan(fIdx);
    expect(pIdx).toBeGreaterThan(evIdx);

    const stats = (await store.readArtifact(runId, "stats", 1)) as { rawCount?: number };
    expect(stats.rawCount).toBe(1);
    const topicCandidates = (await store.readArtifact(runId, "topic-candidates", 1)) as { candidates: unknown[] };
    expect(topicCandidates.candidates).toHaveLength(1);
    const evidence = (await store.readArtifact(runId, "evidence-validation", 1)) as { validFindingCount?: number };
    expect(evidence.validFindingCount).toBe(1);
    const versionPlan = (await store.readArtifact(runId, "version-plan", 1)) as { decisions?: unknown[] };
    expect(versionPlan.decisions).toHaveLength(1);
  });

  it("publishes live progress events while model stages run", async () => {
    const model = new ScriptedModelClient(await buildScript());
    const deps = makeDeps(model);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand why users love it", "en", deps, publisher, store);

    const events = await collectEvents(runId);
    const progress = events.filter((e) => (e as { type: string }).type === "stage.progress" && (e as { stage?: string }).stage !== undefined) as {
      type: string;
      stage: string;
      data: { message: string };
    }[];
    // Every model stage emits at least one progress message (scope, topics,
    // findings, planning, tests), and the deterministic source/prepare stages
    // announce themselves too so the UI is never silent at run start.
    expect(progress.length).toBeGreaterThanOrEqual(7);
    const stages = new Set(progress.map((p) => p.stage));
    for (const s of ["scope", "topics", "findings", "planning", "tests"]) {
      expect(stages.has(s)).toBe(true);
    }
    expect(stages.has("source")).toBe(true);
    expect(stages.has("prepare")).toBe(true);
    expect(progress.some((p) => /batch|review/i.test(p.data.message))).toBe(true);
    // The collected-count message from the source stage must reflect the page.
    expect(progress.some((p) => p.stage === "source" && /collected 1 reviews/.test(p.data.message))).toBe(true);
  });

  it("applies scope filters so only matching reviews reach the model stages", async () => {
    // PAGE1 is a single 5-star review. A scope that filters to rating 1 must
    // exclude it, ending the run as insufficient-data WITHOUT calling the model.
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));
    const deps = makeDeps(model);
    // Scope output: filter to rating 1 only.
    const scoped = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Only low ratings", filters: { rating: [1], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
    ]);
    deps.model = scoped;
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand why users rate 1 star", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "SCOPE_EMPTY")).toBe(true);
    // Only the scope call ran (callIndex === 1); topics/findings never ran.
    expect(scoped.callIndex).toBe(1);
  });

  it("continues analysis as partial when a later page fails", async () => {
    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing focus", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [] }),
      JSON.stringify({ findings: [] }),
    ]);
    const deps = makeDeps(model);
    deps.fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/page=1/")) return new Response(PAGE1, { status: 200 });
      return new Response("<error>", { status: 500 });
    }) as unknown as typeof fetch;
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.limitations.some((l) => l.code === "RSS_PARTIAL")).toBe(true);
    // No findings survived validation -> the run short-circuits after
    // scope/topics/findings (callIndex === 3); planning/tests never run.
    expect(model.callIndex).toBe(3);
    expect(manifest.limitations.some((l) => l.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(manifest.canReplay).toBe(false);
  });

  it("marks a feed with no entry property suspect-empty and does not enter model stages", async () => {
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));
    const deps = makeDeps(model);
    const emptyFeedWithoutEntry = readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "apple", "empty-feed-no-entry.json"),
      "utf8",
    );
    deps.fetchFn = (async () => new Response(emptyFeedWithoutEntry, { status: 200 })) as unknown as typeof fetch;
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
    expect(model.callIndex).toBe(0);
  });

  it("fails cleanly with PIPELINE_ERROR when a model call throws", async () => {
    const model = new ScriptedModelClient([], new Error("MODEL down"));
    const deps = makeDeps(model);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("failed");
    expect(manifest.limitations.some((l) => l.code === "PIPELINE_ERROR")).toBe(true);
  });

  it("fails cleanly when page 1 fetch fails", async () => {
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));
    const deps = makeDeps(model);
    deps.fetchFn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("failed");
    expect(manifest.limitations.some((l) => l.code === "RSS_FETCH_FAILED")).toBe(true);
    expect(model.callIndex).toBe(0);
  });

  it("analyzes a preview-selected live dataset without re-collecting from Apple", async () => {
    const model = new ScriptedModelClient(await buildScript());
    const parsed = (await import("@/server/sources/apple-rss-parser")).parseAppleRssJson(PAGE1);
    const rawReviews = parsed.reviews;
    const rawRefs = parsed.rawRefs.map((r) => `sources/apple/page-01.json#${r}`);
    const deps: ExecuteDeps = {
      model,
      source: {
        kind: "preview",
        data: {
          previewId: "preview-1",
          appId: "839285684",
          canonicalUrl: "https://apps.apple.com/us/app/workout/id839285684",
          selection: "live",
          reviews: rawReviews,
          rawRefs,
          limitations: [],
          sourceSummary: {
            kind: "app-store-reviews",
            provider: "apple-rss",
            appId: "839285684",
            storefront: "US",
            status: "complete",
            selection: "live",
            liveCount: 1,
            stableCount: 0,
            reviewCount: rawReviews.length,
            collectedAt: "2026-08-12T00:00:00.000Z",
            forcedRefresh: false,
            providerCached: null,
            requestCount: 1,
            searchCount: 0,
            searchId: null,
            requestId: null,
            creditsUsed: null,
          },
        },
      },
    };
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand why users love it", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.canReplay).toBe(true);
    // buildScript yields 6 model calls: scope, topic discovery, consolidation,
    // findings, planning, tests.
    expect(model.callIndex).toBe(6);
    // The selected dataset is persisted as a run-local raw-reviews artifact.
    const rawArtifact = (await store.readArtifact(runId, "raw-reviews", 1)) as { reviews: unknown[] };
    expect(rawArtifact.reviews).toHaveLength(1);
  });

  it("propagates RSS_CACHE_AUGMENTED and keeps RSS_SUSPECT_EMPTY for a stable selection over an empty live", async () => {
    const model = new ScriptedModelClient(await buildScript());
    const parsed = (await import("@/server/sources/apple-rss-parser")).parseAppleRssJson(PAGE1);
    const deps: ExecuteDeps = {
      model,
      source: {
        kind: "preview",
        data: {
          previewId: "preview-2",
          appId: "839285684",
          canonicalUrl: "https://apps.apple.com/us/app/workout/id839285684",
          selection: "stable",
          reviews: parsed.reviews,
          rawRefs: parsed.reviews.map((r) => `cache:${r.sourceReviewId}`),
          limitations: [
            { code: "RSS_CACHE_AUGMENTED", message: "Analysis used the stable cached review sample", stage: "source" },
            { code: "RSS_SUSPECT_EMPTY", message: "Live collection was empty", stage: "source" },
          ],
          sourceSummary: {
            kind: "app-store-reviews",
            provider: "apple-rss",
            appId: "839285684",
            storefront: "US",
            status: "partial",
            selection: "stable",
            liveCount: 0,
            stableCount: 1,
            reviewCount: 1,
            collectedAt: "2026-08-12T00:00:00.000Z",
            forcedRefresh: false,
            providerCached: null,
            requestCount: 3,
            searchCount: 0,
            searchId: null,
            requestId: null,
            creditsUsed: null,
          },
        },
      },
    };
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "RSS_CACHE_AUGMENTED")).toBe(true);
    expect(manifest.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
  });

  it("does not enter model stages when a preview's selected dataset is empty", async () => {
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));
    const deps: ExecuteDeps = {
      model,
      source: {
        kind: "preview",
        data: {
          previewId: "preview-3",
          appId: "839285684",
          canonicalUrl: "https://apps.apple.com/us/app/workout/id839285684",
          selection: "live",
          reviews: [],
          rawRefs: [],
          limitations: [{ code: "RSS_SUSPECT_EMPTY", message: "empty", stage: "source" }],
          sourceSummary: {
            kind: "app-store-reviews",
            provider: "apple-rss",
            appId: "839285684",
            storefront: "US",
            status: "suspect-empty",
            selection: "live",
            liveCount: 0,
            stableCount: 0,
            reviewCount: 0,
            collectedAt: "2026-08-12T00:00:00.000Z",
            forcedRefresh: false,
            providerCached: null,
            requestCount: 3,
            searchCount: 0,
            searchId: null,
            requestId: null,
            creditsUsed: null,
          },
        },
      },
    };
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
    expect(model.callIndex).toBe(0);
  });

  it("keeps a valid-but-insufficient finding and downgrades its requirement to P2 with no version", async () => {
    // corpus = 1 review; finding survives with exact excerpt but its evidence
    // is insufficient (2-support floor not met). The requirement must be
    // pinned to P2/null by the deterministic guardrail even though the model
    // returned P1/ver-1, and the version must not claim it.
    const model = new ScriptedModelClient(await buildScript());
    const deps = makeDeps(model);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
    // planning/tests still run (a finding exists, it is just insufficient),
    // so the full 6-stage script executes.
    expect(model.callIndex).toBe(6);
    const prd = (await store.readArtifact(runId, "prd", 1)) as {
      requirements: { priority: string; versionId: string | null }[];
      versions: { requirementIds: string[] }[];
      findings: { evidenceSufficiency: { status: string } }[];
    };
    expect(prd.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(prd.requirements[0]).toMatchObject({ priority: "P2", versionId: null });
    // The version that only claimed the downgraded requirement is deleted:
    // an empty version cannot survive normalization.
    expect(prd.versions).toHaveLength(0);
  });

  it("short-circuits with insufficient-evidence when no findings survive", async () => {
    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing focus", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [] }),
      JSON.stringify({ findings: [] }),
    ]);
    const deps = makeDeps(model);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(manifest.canReplay).toBe(false);
    // Only scope/topics/findings ran.
    expect(model.callIndex).toBe(3);
    // No planning/tests artifacts on disk.
    const artifact = (name: string) => path.join(store.resolveRunDir(runId), "artifacts", `${name}.attempt-01.json`);
    expect(existsSync(artifact("prd"))).toBe(false);
    expect(existsSync(artifact("tests"))).toBe(false);
    // Final report carries null prd/report.
    const finalReport = (await store.readArtifact(runId, "final-report", 1)) as {
      prd: unknown;
      report: unknown;
    };
    expect(finalReport.prd).toBeNull();
    expect(finalReport.report).toBeNull();
  });
});
