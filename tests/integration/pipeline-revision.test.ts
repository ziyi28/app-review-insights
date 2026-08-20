import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ImportParseShape, type ExecuteDeps } from "@/server/pipeline/orchestrator";
import { ScriptedModelClient } from "@/server/model/scripted-client";
import { prepareReviews } from "@/domain/reviews/prepare";
import { parseImportedReviews } from "@/server/sources/import-parser";
import type { RawReview } from "@/domain/contracts/review";

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prev-"));
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
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("executeRun (revision path)", () => {
  it("runs one constrained revision when traceability fails, then completes", async () => {
    const parse = parseImportedReviews({
      fileName: "r.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [
          { id: "b1", body: "Subscription is way too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b2", body: "Cannot afford the premium price, it is too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b3", body: "Far too expensive for a basic app", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
        ],
      }),
    });
    const prepared = prepareReviews({ kind: "import", parse });
    const rids = prepared.reviews.filter((r) => r.includedInAnalysis).map((r) => r.reviewId);
    const rid = rids[0];

    const model = new ScriptedModelClient([
      // scope
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      // discovery
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Price", description: "d", supportingReviewIds: rids, quote: "too expensive" }] }),
      // consolidation
      JSON.stringify({ topics: [{ id: "topic-1", label: "Price", description: "d", candidateIds: ["topic-candidate-1"] }] }),
      // findings (valid, cites the real review id)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: rids, evidenceExcerpts: rids.map((id) => ({ reviewId: id, excerpt: "too expensive" })), conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      // planning (valid requirement)
      JSON.stringify({
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "Ships the pricing fix first", requirementIds: ["req-1"] }],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      // requirement-evidence: the candidate reviews support req-1.
      JSON.stringify({ requirementId: "req-1", verdicts: rids.map((id) => ({ reviewId: id, relation: "direct", confidence: 1, reason: "price complaint" })) }),
      // tests (cites a ghost review -> TEST_REVIEW_OUTSIDE_EVIDENCE -> traceability fails)
      JSON.stringify({
        tests: [
          { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" },
        ],
      }),
      // revision: fixes the test to cite the real reviews
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: rids, evidenceExcerpts: rids.map((id) => ({ reviewId: id, excerpt: "too expensive" })), conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        tests: [
          { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: rids, testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" },
        ],
        assumptions: [],
        note: "fixed test citation",
      }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;

    await executeRun(runId, "Understand pricing complaints", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store);

    const events = await collectEvents(runId);
    expect(events.some((e) => (e as { type: string }).type === "validation.failed")).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === "revision.started")).toBe(true);
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    // Evidence-validation and version-plan both carry attempt 1 and attempt 2;
    // the manifest points at the latest.
    for (const name of ["evidence-validation", "version-plan", "prd", "tests", "traceability"] as const) {
      const a1 = await store.readArtifact(runId, name, 1);
      const a2 = await store.readArtifact(runId, name, 2);
      expect(a1).toBeDefined();
      expect(a2).toBeDefined();
      expect(manifest.artifacts[name].attempt).toBe(2);
    }
  });

  it("rejects an insufficient finding requirement and converts it to assumption during revision", async () => {
    const parse = parseImportedReviews({
      fileName: "r.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [
          { id: "b1", body: "Subscription is way too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b2", body: "Cannot afford the premium price, it is too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b3", body: "Far too expensive for a basic app", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b4", body: "Random crash on open once", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
        ],
      }),
    });
    const prepared = prepareReviews({ kind: "import", parse });
    const rids = prepared.reviews.filter((r) => r.includedInAnalysis).map((r) => r.reviewId);
    const rid1 = rids[0];
    const rid2 = rids[1];
    const rid3 = rids[2];
    const rid4 = rids[3];

    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({
        topics: [
          { id: "topic-candidate-1", label: "App issues", description: "d", supportingReviewIds: rids, quote: "too expensive" },
        ],
      }),
      JSON.stringify({
        topics: [
          { id: "topic-1", label: "App issues", description: "d", candidateIds: ["topic-candidate-1@c0"] },
        ],
      }),
      // findings discovery
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid1, rid2, rid3], evidenceExcerpts: [{ reviewId: rid1, excerpt: "too expensive" }, { reviewId: rid2, excerpt: "too expensive" }, { reviewId: rid3, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
          { id: "finding-2", topicIds: ["topic-1"], title: "Rare complaint", summary: "x", supportingReviewIds: [rid1], evidenceExcerpts: [{ reviewId: rid1, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      // findings consolidation
      JSON.stringify({
        groups: [
          { id: "finding-1", title: "Too expensive", summary: "x", candidateIds: ["finding-1"] },
          { id: "finding-2", title: "Rare complaint", summary: "x", candidateIds: ["finding-2"] },
        ],
      }),
      // planning: req-1 points to finding-1 (sufficient)
      JSON.stringify({
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "x", requirementIds: ["req-1"] }],
        requirements: [
          { id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } },
        ],
        assumptions: [],
      }),
      // requirement-evidence
      JSON.stringify({
        requirementId: "req-1",
        verdicts: [
          { reviewId: rid1, relation: "direct", confidence: 1, reason: "price complaint" },
          { reviewId: rid2, relation: "direct", confidence: 1, reason: "price complaint" },
          { reviewId: rid3, relation: "direct", confidence: 1, reason: "price complaint" },
        ],
      }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision: includes req-1 (sufficient) and introduces req-2 (citing insufficient finding-2)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid1, rid2, rid3], evidenceExcerpts: [{ reviewId: rid1, excerpt: "too expensive" }, { reviewId: rid2, excerpt: "too expensive" }, { reviewId: rid3, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
          { id: "finding-2", topicIds: ["topic-1"], title: "Rare complaint", summary: "x", supportingReviewIds: [rid1], evidenceExcerpts: [{ reviewId: rid1, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [
          { id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } },
          { id: "req-2", findingIds: ["finding-2"], title: "Fix rare issue", description: "x", priority: "P1", acceptanceCriteria: ["fixed"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "Fix rare" } },
        ],
        tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid1, rid2, rid3], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }],
        assumptions: [],
        note: "fixed test citation and added rare requirement",
      }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;

    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    // The revised PRD (attempt-02) must reject req-2 (backed only by insufficient finding-2)
    // and convert it to a rejected-requirement assumption, keeping req-1.
    const revisedPrd = (await store.readArtifact(runId, "prd", 2)) as {
      requirements: { id: string; priority: string; versionId: string | null }[];
      findings: { id: string; evidenceSufficiency: { status: string } }[];
      assumptions: { id: string; origin?: string }[];
    };
    expect(revisedPrd.requirements).toHaveLength(1);
    expect(revisedPrd.requirements[0].id).toBe("req-1");
    expect(revisedPrd.assumptions.some((a) => a.id === "asm-rejected-req-2")).toBe(true);
    expect(revisedPrd.assumptions.some((a) => a.id === "asm-insufficient-finding-2")).toBe(true);
  });

  it("fails explicitly (run.failed + manifest failed) when revision leaves traceability invalid", async () => {
    const parse = parseImportedReviews({
      fileName: "r.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [
          { id: "b1", body: "Subscription is way too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b2", body: "Cannot afford the premium price, it is too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "b3", body: "Far too expensive for a basic app", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
        ],
      }),
    });
    const prepared = prepareReviews({ kind: "import", parse });
    const rids = prepared.reviews.filter((r) => r.includedInAnalysis).map((r) => r.reviewId);
    const rid = rids[0];

    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Price", description: "d", supportingReviewIds: rids, quote: "too expensive" }] }),
      JSON.stringify({ topics: [{ id: "topic-1", label: "Price", description: "d", candidateIds: ["topic-candidate-1@c0"] }] }),
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: rids, evidenceExcerpts: rids.map((id) => ({ reviewId: id, excerpt: "too expensive" })), conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      JSON.stringify({
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "x", requirementIds: ["req-1"] }],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      // requirement-evidence: candidate reviews support req-1.
      JSON.stringify({ requirementId: "req-1", verdicts: rids.map((id) => ({ reviewId: id, relation: "direct", confidence: 1, reason: "price complaint" })) }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision still leaves the requirement uncovered (empty tests -> REQUIREMENT_UNTESTED violation)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: rids, evidenceExcerpts: rids.map((id) => ({ reviewId: id, excerpt: "too expensive" })), conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        tests: [],
        assumptions: [],
        note: "could not fix",
      }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;
    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store);

    const events = await collectEvents(runId);
    // Terminal event must be run.failed, not run.completed.
    const last = events.at(-1) as { type: string };
    expect(last.type).toBe("run.failed");
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("failed");
    expect(manifest.canReplay).toBe(false);
    expect(manifest.limitations.some((l) => l.code === "TRACEABILITY_INVALID_AFTER_REVISION")).toBe(true);
  });

  it("keeps partial source findings insufficient with SOURCE_NOT_COMPLETE and produces assumption-only PRD", async () => {
    const rawReviews: RawReview[] = Array.from({ length: 100 }, (_, i) => ({
      sourceReviewId: `rev-${i + 1}`,
      source: "apple-rss",
      title: "",
      body:
        i === 0
          ? "the price is too high for me, cannot afford"
          : i === 1
            ? "price is too high compared to competitors"
            : i === 2
              ? "I cancelled because the price is too high"
              : `review body number ${i + 1}`,
      rating: 1,
      version: null,
      updatedAt: "2026-07-01T10:00:00Z",
    }));
    const prepared = prepareReviews({
      kind: "collected",
      reviews: rawReviews,
      rawRefs: rawReviews.map((r) => `sources/apple/page-01.json#${r.sourceReviewId}`),
      limitations: [],
    });
    const bySource = new Map(prepared.reviews.map((r) => [r.sourceReviewId, r.reviewId]));
    const rid1 = bySource.get("rev-1")!;
    const rid2 = bySource.get("rev-2")!;
    const rid3 = bySource.get("rev-3")!;

    const model = new ScriptedModelClient([
      // scope
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      // topic discovery
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Pricing", description: "d", supportingReviewIds: [rid1, rid2, rid3], quote: "price is too high" }] }),
      // topic consolidation
      JSON.stringify({ topics: [{ id: "topic-1", label: "Pricing", description: "d", candidateIds: ["topic-candidate-1"] }] }),
      // findings: 3 supports in a 100-review corpus — the partial source keeps it insufficient.
      JSON.stringify({
        findings: [
          {
            id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x",
            supportingReviewIds: [rid1, rid2, rid3],
            evidenceExcerpts: [
              { reviewId: rid1, excerpt: "price is too high" },
              { reviewId: rid2, excerpt: "price is too high" },
              { reviewId: rid3, excerpt: "price is too high" },
            ],
            conflictingReviewIds: [], uncertainties: [], limitations: [],
          },
        ],
      }),
    ]);

    const deps: ExecuteDeps = {
      model,
      source: {
        kind: "preview",
        data: {
          previewId: "preview-rev-partial",
          appId: "839285684",
          canonicalUrl: "https://apps.apple.com/us/app/workout/id839285684",
          selection: "live",
          reviews: rawReviews,
          rawRefs: rawReviews.map((r) => `sources/apple/page-01.json#${r.sourceReviewId}`),
          limitations: [{ code: "SERPAPI_PARTIAL", message: "SerpApi pagination ended early", stage: "source" }],
          sourceSummary: {
            kind: "app-store-reviews",
            provider: "serpapi",
            appId: "839285684",
            storefront: "US",
            status: "partial",
            selection: "live",
            liveCount: 100,
            stableCount: 0,
            reviewCount: 100,
            collectedAt: "2026-08-12T00:00:00.000Z",
            forcedRefresh: true,
            providerCached: false,
            requestCount: 2,
            searchCount: 2,
            searchId: "search-1",
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
    expect(manifest.limitations.some((l) => l.code === "SERPAPI_PARTIAL")).toBe(true);
    expect(manifest.limitations.some((l) => l.code === "INSUFFICIENT_EVIDENCE")).toBe(true);

    const prd = (await store.readArtifact(runId, "prd", 1)) as {
      requirements: unknown[];
      findings: { evidenceSufficiency: { status: string; reasons: string[] } }[];
      assumptions: { id: string; origin?: string }[];
    };
    expect(prd.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(prd.findings[0].evidenceSufficiency.reasons).toContain("SOURCE_NOT_COMPLETE");
    expect(prd.requirements).toHaveLength(0);
    expect(prd.assumptions.some((a) => a.id === "asm-insufficient-finding-1")).toBe(true);
  });
});
