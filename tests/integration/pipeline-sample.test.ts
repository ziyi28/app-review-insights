import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps } from "@/server/pipeline/orchestrator";
import type { ModelRequest } from "@/server/model/types";

/**
 * Builds a synthetic corpus of `count` unique reviews with a mixed rating ×
 * language spread (so stratified sampling has multiple non-empty layers).
 */
function makeCorpus(count: number): string[] {
  const bodies: string[] = [];
  for (let i = 0; i < count; i++) {
    const rating = (i % 5) + 1;
    const lang = i % 3 === 0 ? "zh" : "en";
    bodies.push(`review number ${i} ${lang} ${rating}`);
  }
  return bodies;
}

function fetchStub(corpus: string[]): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        feed: {
          entry: corpus.map((b, i) => ({
            id: { label: `s${i}` },
            updated: { label: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z` },
            "im:rating": { label: String((i % 5) + 1) },
            "im:version": { label: "8.2.0" },
            title: { label: "" },
            content: { label: b, attributes: { type: "text" } },
          })),
          link: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

function makeDeps(model: unknown, corpus: string[]): ExecuteDeps {
  return {
    model: model as never,
    source: {
      kind: "apple-rss",
      appleRssBaseUrl: "https://itunes.apple.com/us/rss/customerreviews",
      appId: "839285684",
      canonicalUrl: "https://apps.apple.com/us/app/workout/id839285684",
    },
    fetchFn: fetchStub(corpus),
    sleep: async () => {},
    now: () => "2026-08-12T00:00:00.000Z",
    pageDelayMs: 0,
    maxPages: 20,
    timeoutMs: 5000,
  };
}

type StubModel = {
  requests: ModelRequest<unknown>[];
  generate<T>(request: ModelRequest<T>): Promise<unknown>;
};

/**
 * A model client that dispatches on promptVersion, exactly like the real
 * pipeline stages do. Robust to however many discovery chunks a corpus splits
 * into — each chunk issues its own discovery call.
 */
function stubModel(dispatch: { scope?: unknown; discovery?: unknown; consolidation?: unknown; findings?: unknown; planning?: unknown; tests?: unknown }): StubModel {
  const requests: ModelRequest<unknown>[] = [];
  return {
    requests,
    async generate<T>(request: ModelRequest<T>): Promise<unknown> {
      requests.push(request as ModelRequest<unknown>);
      let out: unknown;
      if (request.promptVersion.includes("scope")) out = dispatch.scope;
      else if (request.promptVersion.includes("discovery")) out = dispatch.discovery;
      else if (request.promptVersion.includes("consolidation")) out = dispatch.consolidation;
      else if (request.promptVersion.includes("findings")) out = dispatch.findings;
      else if (request.promptVersion.includes("planning")) out = dispatch.planning;
      else if (request.promptVersion.includes("tests")) out = dispatch.tests;
      else out = { topics: [] };
      return request.schema.parse(out);
    },
  };
}

/** Parses the corpus exactly like a live run, returning the prepared reviews. */
async function prepareCorpus(corpus: string[]) {
  const { parseAppleRssJson } = await import("@/server/sources/apple-rss-parser");
  const { prepareReviews } = await import("@/domain/reviews/prepare");
  const parsed = parseAppleRssJson(await (await fetchStub(corpus)(new Request("https://x"))).text());
  const prepared = prepareReviews({ kind: "collected", reviews: parsed.reviews, rawRefs: parsed.rawRefs, limitations: [] });
  return prepared.reviews.filter((r) => r.includedInAnalysis);
}

/** Dispatch map that cites a single sample member so every stage validates. */
function buildDispatch(rid: string, quote: string, scopeFilters: unknown) {
  return {
    scope: { interpretation: "Broad", filters: scopeFilters, explicitLimitations: [] },
    discovery: { topics: [{ id: "topic-candidate-1", label: "Pricing", description: "d", supportingReviewIds: [rid], quote }] },
    consolidation: { topics: [{ id: "topic-1", label: "Pricing", description: "d", candidateIds: ["topic-candidate-1"] }] },
    findings: {
      findings: [{ id: "finding-1", topicIds: ["topic-1"], title: "x", summary: "y", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: quote }], conflictingReviewIds: [], uncertainties: [], limitations: [] }],
    },
    planning: {
      title: "Release plan",
      overview: "o",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "s", rationale: "r", requirementIds: ["req-1"] }],
      requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "t", description: "d", priority: "P1", acceptanceCriteria: ["c"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "medium", dependencyRequirementIds: [], rationale: "r" } }],
      assumptions: [],
    },
    tests: { tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "p", steps: ["s"], expectedResult: "r" }] },
  };
}

describe("executeRun with a 500-review corpus (stratified sampling)", () => {
  let dir: string;
  let store: RunStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pipeline-sample-"));
    store = new RunStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not sample when the scope keeps ≤200 reviews, but records full stats", async () => {
    const corpus = makeCorpus(500);
    const reviews = await prepareCorpus(corpus);
    // Scope to rating 5 only (~100 reviews, well under the 200 limit).
    const target = reviews.find((r) => r.bodyNormalized.includes("en 5")) ?? reviews[0];
    const model = stubModel(buildDispatch(target.reviewId, target.bodyNormalized, { rating: [5], versions: [], languages: [], minDate: null, maxDate: null }));
    const deps = makeDeps(model, corpus);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing concerns", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "ANALYSIS_SAMPLE_APPLIED")).toBe(false);
    // Full stats always cover the whole corpus, not the scope or the sample.
    const stats = (await store.readArtifact(runId, "stats", 1)) as { includedCount: number };
    expect(stats.includedCount).toBe(500);
  });

  it("samples 500 eligible reviews to 200, keeps full-set stats, and stays traceable without a revision", async () => {
    const corpus = makeCorpus(500);
    const reviews = await prepareCorpus(corpus);
    // The model cites a review that is GUARANTEED to be in the sample: recompute
    // the sample the same way the orchestrator does and cite its first member.
    const { sampleReviews } = await import("@/domain/reviews/sample");
    const deterministic = sampleReviews(reviews);
    const cited = deterministic.selected[0];
    const model = stubModel(buildDispatch(cited.reviewId, cited.bodyNormalized, { rating: [], versions: [], languages: [], minDate: null, maxDate: null }));
    const deps = makeDeps(model, corpus);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing broadly", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");

    // The sampling limitation and artifact exist with the expected counts.
    expect(manifest.limitations.some((l) => l.code === "ANALYSIS_SAMPLE_APPLIED")).toBe(true);
    const sampleArtifact = (await store.readArtifact(runId, "analysis-sample", 1)) as {
      eligibleCount: number;
      selectedCount: number;
      limit: number;
      selectedReviewIds: string[];
    };
    expect(sampleArtifact.eligibleCount).toBe(500);
    expect(sampleArtifact.selectedCount).toBe(200);
    expect(sampleArtifact.selectedReviewIds).toHaveLength(200);

    // Every review the model stages saw (each topics discovery input) is a
    // sample member, and at most 200 per chunk is guaranteed by sampling.
    const discoveryRequests = model.requests.filter((r) => r.promptVersion.includes("discovery"));
    expect(discoveryRequests.length).toBeGreaterThan(0);
    const sampleSet = new Set(sampleArtifact.selectedReviewIds);
    for (const req of discoveryRequests) {
      const input = JSON.parse(String(req.user)) as { reviews: { reviewId: string }[] };
      expect(input.reviews.length).toBeLessThanOrEqual(200);
      for (const r of input.reviews) expect(sampleSet.has(r.reviewId)).toBe(true);
    }

    // The cited review survived sampling (it was the deterministic sample's
    // first member) and traceability passed cleanly.
    expect(sampleSet.has(cited.reviewId)).toBe(true);
    const trace = (await store.readArtifact(runId, "traceability", 1)) as { valid: boolean };
    expect(trace.valid).toBe(true);
    // No unrelated revision ran: traceability was valid on the first pass.
    expect(model.requests.some((r) => r.promptVersion.includes("revision"))).toBe(false);
  });
});
