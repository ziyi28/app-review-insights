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
 * language spread.
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
function stubModel(dispatch: { scope?: unknown; discovery?: unknown; consolidation?: unknown; findings?: unknown; findingsConsolidation?: unknown; planning?: unknown; coverageRepair?: unknown; tests?: unknown }): StubModel {
  const requests: ModelRequest<unknown>[] = [];
  return {
    requests,
    async generate<T>(request: ModelRequest<T>): Promise<unknown> {
      requests.push(request as ModelRequest<unknown>);
      let out: unknown;
      if (request.promptVersion.includes("scope")) out = dispatch.scope;
      else if (request.promptVersion.includes("discovery")) out = dispatch.discovery;
      // findings.consolidation@1 vs topics.consolidation@3 both contain
      // "consolidation"; distinguish by the stage prefix.
      else if (request.promptVersion.includes("findings.consolidation")) out = dispatch.findingsConsolidation;
      else if (request.promptVersion.includes("consolidation")) out = dispatch.consolidation;
      else if (request.promptVersion.includes("findings")) out = dispatch.findings;
      else if (request.promptVersion.includes("coverage-repair")) out = dispatch.coverageRepair;
      else if (request.promptVersion.includes("planning")) out = dispatch.planning;
      else if (request.promptVersion.includes("tests")) out = dispatch.tests;
      else if (request.promptVersion.includes("requirement-evidence")) {
        // Self-consistent stub: mark every candidate review the stage asks about
        // as direct support, so the downstream tests/traceability ledger stays
        // valid for any number of requirements or chunked calls.
        const input = JSON.parse(String(request.user)) as {
          requirement: { id: string };
          candidateReviews: { reviewId: string }[];
        };
        out = {
          requirementId: input.requirement.id,
          verdicts: input.candidateReviews.map((c) => ({ reviewId: c.reviewId, relation: "direct", confidence: 1, reason: "scripted direct support" })),
        };
      }
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

/** Dispatch map that cites a single review so every stage validates. */
function buildDispatch(rid: string, quote: string, scopeFilters: unknown) {
  return {
    scope: { interpretation: "Broad", filters: scopeFilters, explicitLimitations: [], focusAreas: [{ id: "focus-1", label: "Pricing" }] },
    discovery: { topics: [{ id: "topic-candidate-1", label: "Pricing", description: "d", supportingReviewIds: [rid], quote, focusAreaIds: ["focus-1"] }] },
    consolidation: { topics: [{ id: "topic-1", label: "Pricing", description: "d", candidateIds: ["topic-candidate-1"], focusAreaIds: ["focus-1"] }] },
    findings: {
      findings: [{ id: "finding-1", topicIds: ["topic-1"], focusAreaIds: ["focus-1"], title: "x", summary: "y", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: quote }], conflictingReviewIds: [], uncertainties: [], limitations: [] }],
    },
    findingsConsolidation: { groups: [{ id: "finding-1", title: "x", summary: "y", candidateIds: ["finding-1"], focusAreaIds: ["focus-1"] }] },
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

describe("executeRun with a 500-review corpus (full-corpus analysis)", () => {
  let dir: string;
  let store: RunStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pipeline-full-corpus-"));
    store = new RunStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("analyzes the FULL scoped corpus — every scope-matching review reaches the model stages", async () => {
    const corpus = makeCorpus(500);
    const reviews = await prepareCorpus(corpus);
    const target = reviews.find((r) => r.bodyNormalized.includes("en 5")) ?? reviews[0];
    const model = stubModel(buildDispatch(target.reviewId, target.bodyNormalized, { rating: [], versions: [], languages: [], minDate: null, maxDate: null }));
    const deps = makeDeps(model, corpus);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing concerns", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");

    // No sampling limitation or artifact — the full corpus is analyzed.
    expect(manifest.limitations.some((l) => l.code === "ANALYSIS_SAMPLE_APPLIED")).toBe(false);

    // Every review the topics/findings stages saw must be a scope-matching
    // review, and the union of discovery inputs covers ALL 500 reviews.
    const discoveryRequests = model.requests.filter((r) => r.promptVersion.includes("discovery"));
    expect(discoveryRequests.length).toBeGreaterThan(1);
    const fedReviewIds = new Set<string>();
    for (const req of discoveryRequests) {
      const input = JSON.parse(String(req.user)) as { reviews: { reviewId: string }[] };
      for (const r of input.reviews) fedReviewIds.add(r.reviewId);
    }
    const allCorpusReviewIds = new Set(reviews.map((r) => r.reviewId));
    expect(fedReviewIds.size).toBe(500);
    for (const id of allCorpusReviewIds) expect(fedReviewIds.has(id)).toBe(true);

    // The cited review survived (full corpus, no sampling) and traceability
    // passed cleanly.
    expect(allCorpusReviewIds.has(target.reviewId)).toBe(true);
    const trace = (await store.readArtifact(runId, "traceability", 1)) as { valid: boolean };
    expect(trace.valid).toBe(true);
    expect(model.requests.some((r) => r.promptVersion.includes("revision"))).toBe(false);
  });

  it("repairs a goal-coverage gap: first plan omits pricing, repair adds it, tests run once, traceability passes", async () => {
    // A small single-chunk corpus keeps finding ids un-namespaced (finding-1,
    // finding-2) so the planning/repair stubs can reference them directly.
    // 6 pricing reviews + 6 trial reviews + filler, well under the 8k chunk
    // budget. Each finding cites 5+ reviews → sufficient evidence.
    const corpus = [
      ...Array.from({ length: 6 }, (_, i) => `price complaint number ${i} en 5`),
      ...Array.from({ length: 6 }, (_, i) => `trial confusing number ${i} zh 1`),
      ...Array.from({ length: 8 }, (_, i) => `filler review number ${i} en 3`),
    ];
    const reviews = await prepareCorpus(corpus);
    const pricing = reviews.filter((r) => r.bodyNormalized.includes("en 5")).slice(0, 5);
    const trial = reviews.filter((r) => r.bodyNormalized.includes("zh 1")).slice(0, 5);
    const priceRids = pricing.map((r) => r.reviewId);
    const trialRids = trial.map((r) => r.reviewId);
    const priceExcerpts = pricing.map((r) => ({ reviewId: r.reviewId, excerpt: "en 5" }));
    const trialExcerpts = trial.map((r) => ({ reviewId: r.reviewId, excerpt: "zh 1" }));

    const dispatch = {
      scope: { interpretation: "Focus on pricing and trial", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [], focusAreas: [{ id: "focus-1", label: "Pricing" }, { id: "focus-2", label: "Trial" }] },
      discovery: {
        topics: [
          { id: "topic-candidate-1", label: "Pricing", description: "d", supportingReviewIds: priceRids, quote: "en 5", focusAreaIds: ["focus-1"] },
          { id: "topic-candidate-2", label: "Trial", description: "d", supportingReviewIds: trialRids, quote: "zh 1", focusAreaIds: ["focus-2"] },
        ],
      },
      consolidation: {
        topics: [
          { id: "topic-1", label: "Pricing", description: "d", candidateIds: ["topic-candidate-1"], focusAreaIds: ["focus-1"] },
          { id: "topic-2", label: "Trial", description: "d", candidateIds: ["topic-candidate-2"], focusAreaIds: ["focus-2"] },
        ],
      },
      findings: {
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], focusAreaIds: ["focus-1"], title: "Pricing too high", summary: "y", supportingReviewIds: priceRids, evidenceExcerpts: priceExcerpts, conflictingReviewIds: [], uncertainties: [], limitations: [] },
          { id: "finding-2", topicIds: ["topic-2"], focusAreaIds: ["focus-2"], title: "Trial unclear", summary: "y", supportingReviewIds: trialRids, evidenceExcerpts: trialExcerpts, conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      },
      findingsConsolidation: { groups: [{ id: "finding-1", title: "Pricing too high", summary: "y", candidateIds: ["finding-1"], focusAreaIds: ["focus-1"] }, { id: "finding-2", title: "Trial unclear", summary: "y", candidateIds: ["finding-2"], focusAreaIds: ["focus-2"] }] },
      planning: {
        title: "Release plan",
        overview: "o",
        versions: [{ id: "ver-1", name: "1.0.0", summary: "s", rationale: "r", requirementIds: ["req-1"] }],
        // First plan only covers trial (focus-2); pricing (focus-1) is omitted.
        requirements: [{ id: "req-1", findingIds: ["finding-2"], title: "Clarify trial", description: "d", priority: "P1", acceptanceCriteria: ["c"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "medium", dependencyRequirementIds: [], rationale: "r" } }],
        assumptions: [],
      },
      coverageRepair: {
        title: "Release plan",
        overview: "o",
        versions: [{ id: "ver-1", name: "1.0.0", summary: "s", rationale: "r", requirementIds: ["req-1", "req-2"] }],
        // Repair adds the pricing requirement (focus-1).
        requirements: [
          { id: "req-1", findingIds: ["finding-2"], title: "Clarify trial", description: "d", priority: "P1", acceptanceCriteria: ["c"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "medium", dependencyRequirementIds: [], rationale: "r" } },
          { id: "req-2", findingIds: ["finding-1"], title: "Lower price", description: "d", priority: "P1", acceptanceCriteria: ["c"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "medium", dependencyRequirementIds: [], rationale: "r" } },
        ],
        assumptions: [],
      },
      tests: {
        tests: [
          { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [trialRids[0]], testType: "manual", precondition: "p", steps: ["s"], expectedResult: "r" },
          { id: "test-2", requirementIds: ["req-2"], sourceReviewIds: [priceRids[0]], testType: "manual", precondition: "p", steps: ["s"], expectedResult: "r" },
        ],
      },
    };
    const model = stubModel(dispatch);
    const deps = makeDeps(model, corpus);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing and trial friction", "en", deps, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");

    // A coverage-repair call ran and the goal-coverage report is valid.
    expect(model.requests.some((r) => r.promptVersion.includes("coverage-repair"))).toBe(true);
    const coverage = (await store.readArtifact(runId, "goal-coverage", 1)) as {
      valid: boolean;
      items: { focusAreaId: string; status: string; requirementIds: string[] }[];
    };
    expect(coverage.valid).toBe(true);
    const pricingItem = coverage.items.find((i) => i.focusAreaId === "focus-1")!;
    expect(pricingItem.status).toBe("covered");
    expect(pricingItem.requirementIds).toContain("req-2");

    // Tests were generated exactly once, against the final (repaired) plan.
    const testsCalls = model.requests.filter((r) => r.promptVersion.includes("tests"));
    expect(testsCalls).toHaveLength(1);
    const prd = (await store.readArtifact(runId, "prd", 1)) as { requirements: { id: string }[] };
    expect(prd.requirements.map((r) => r.id)).toEqual(["req-1", "req-2"]);

    // Traceability passes (no revision needed).
    const trace = (await store.readArtifact(runId, "traceability", 1)) as { valid: boolean };
    expect(trace.valid).toBe(true);
    expect(model.requests.some((r) => r.promptVersion.includes("revision"))).toBe(false);
  });

  it("records a goal-coverage artifact and classifies a single-finding area as unsupported (no fabricated requirement)", async () => {
    const corpus = makeCorpus(500);
    const reviews = await prepareCorpus(corpus);
    // A single supporting review in a 500-review corpus is insufficient
    // evidence, so the focus area is `unsupported` — the plan must not
    // fabricate a requirement for it and the coverage report stays valid.
    const target = reviews.find((r) => r.bodyNormalized.includes("en 5")) ?? reviews[0];
    const model = stubModel(buildDispatch(target.reviewId, target.bodyNormalized, { rating: [], versions: [], languages: [], minDate: null, maxDate: null }));
    const deps = makeDeps(model, corpus);
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

    await executeRun(runId, "Understand pricing concerns", "en", deps, publisher, store);

    const coverage = (await store.readArtifact(runId, "goal-coverage", 1)) as {
      valid: boolean;
      items: { focusAreaId: string; status: string }[];
    };
    expect(coverage.items[0]).toMatchObject({ focusAreaId: "focus-1", status: "unsupported" });
    // Unsupported is not a gap: the report is valid (nothing to plan).
    expect(coverage.valid).toBe(true);
  });
});
