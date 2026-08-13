import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
  const prepared = prepareReviews({ kind: "apple-rss", reviews: parsed.reviews, rawRefs: parsed.rawRefs, limitations: [] });
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
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Content", requirementIds: ["req-1"] }],
      requirements: [
        { id: "req-1", findingIds: ["finding-1"], title: "Add workout variety", description: "more workouts", priority: "P1", acceptanceCriteria: ["new workouts available"], versionId: "ver-1" },
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

    const prd = (await store.readArtifact(runId, "prd", 1)) as { requirements: unknown[] };
    expect(prd.requirements).toHaveLength(1);
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
      JSON.stringify({ title: "x", overview: "y", versions: [], requirements: [], assumptions: [] }),
      JSON.stringify({ tests: [] }),
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
    // Analysis proceeded into model stages despite partial source.
    expect(model.callIndex).toBe(5);
  });

  it("marks suspect-empty and does not enter model stages when page 1 is empty", async () => {
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));
    const deps = makeDeps(model);
    deps.fetchFn = (async () => new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 })) as unknown as typeof fetch;
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
    // Model must not have been called.
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
});
