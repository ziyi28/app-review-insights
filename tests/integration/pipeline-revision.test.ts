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
          { id: "b2", body: "Cannot afford the premium price", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
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
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Price", description: "d", supportingReviewIds: [rid], quote: "too expensive" }] }),
      // consolidation
      JSON.stringify({ topics: [{ id: "topic-1", label: "Price", description: "d", candidateIds: ["topic-candidate-1"] }] }),
      // findings (valid, cites the real review id)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      // planning (valid requirement)
      JSON.stringify({
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "Ships the pricing fix first", requirementIds: ["req-1"] }],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      // requirement-evidence: the single candidate review supports req-1.
      JSON.stringify({ requirementId: "req-1", verdicts: [{ reviewId: rid, relation: "direct", confidence: 1, reason: "price complaint" }] }),
      // tests (cites a ghost review -> TEST_REVIEW_OUTSIDE_EVIDENCE -> traceability fails)
      JSON.stringify({
        tests: [
          { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" },
        ],
      }),
      // revision: fixes the test to cite the real review
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        tests: [
          { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" },
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

  it("recomputes P2/null for a requirement whose only finding stays insufficient after revision", async () => {
    const parse = parseImportedReviews({
      fileName: "r.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [{ id: "b1", body: "Subscription is way too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" }],
      }),
    });
    const prepared = prepareReviews({ kind: "import", parse });
    const rid = prepared.reviews[0].reviewId;

    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Price", description: "d", supportingReviewIds: [rid], quote: "too expensive" }] }),
      JSON.stringify({ topics: [{ id: "topic-1", label: "Price", description: "d", candidateIds: ["topic-candidate-1@c0"] }] }),
      // findings (1 support in a 1-review corpus -> insufficient)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      // planning: model wants P1 but the guardrail already pins it to P2/null.
      JSON.stringify({
        title: "Plan", overview: "x", versions: [], requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null, planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      // requirement-evidence: the single candidate review supports req-1.
      JSON.stringify({ requirementId: "req-1", verdicts: [{ reviewId: rid, relation: "direct", confidence: 1, reason: "price complaint" }] }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision: same insufficient finding, still requests P1.
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null, planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }],
        assumptions: [],
        note: "fixed test citation",
      }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;

    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    // The revised PRD (attempt-02) must still carry the deterministic guardrail.
    const revisedPrd = (await store.readArtifact(runId, "prd", 2)) as {
      requirements: { priority: string; versionId: string | null }[];
      findings: { evidenceSufficiency: { status: string } }[];
    };
    expect(revisedPrd.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(revisedPrd.requirements[0]).toMatchObject({ priority: "P2", versionId: null });
  });

  it("fails explicitly (run.failed + manifest failed) when revision leaves traceability invalid", async () => {
    const parse = parseImportedReviews({
      fileName: "r.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [{ id: "b1", body: "Subscription is way too expensive", rating: 1, updatedAt: "2026-07-01T00:00:00Z" }],
      }),
    });
    const prepared = prepareReviews({ kind: "import", parse });
    const rid = prepared.reviews[0].reviewId;

    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Price", description: "d", supportingReviewIds: [rid], quote: "too expensive" }] }),
      JSON.stringify({ topics: [{ id: "topic-1", label: "Price", description: "d", candidateIds: ["topic-candidate-1@c0"] }] }),
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      JSON.stringify({
        title: "Plan", overview: "x", versions: [], requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null, planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      // requirement-evidence: the single candidate review supports req-1.
      JSON.stringify({ requirementId: "req-1", verdicts: [{ reviewId: rid, relation: "direct", confidence: 1, reason: "price complaint" }] }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision still leaves the requirement uncovered (empty tests)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null, planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
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

  it("does not re-upgrade a partial source to complete during revision", async () => {
    // Regression: the revision stage re-normalizes model output, and it must
    // thread the SAME authoritative source status. A partial source that kept a
    // finding insufficient via SOURCE_NOT_COMPLETE cannot be silently upgraded
    // to complete by the revision path, which would let a P2 requirement jump
    // back to P1 with a version.
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
    // The revision ledger is keyed by STABLE reviewId, so the script must cite
    // the stable ids for the three distinct supporting reviews (computed through
    // the same deterministic prepare path the orchestrator uses).
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
      // findings: 3 supports in a 100-review corpus — only the partial source
      // keeps it insufficient.
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
      // planning: model requests P1 in a version; guardrail pins to P2/null.
      JSON.stringify({
        title: "Plan", overview: "x",
        versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "x", requirementIds: ["req-1"] }],
        requirements: [
          { id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } },
        ],
        assumptions: [],
      }),
      // requirement-evidence: all three candidate reviews support req-1.
      JSON.stringify({ requirementId: "req-1", verdicts: [
        { reviewId: rid1, relation: "direct", confidence: 1, reason: "price complaint" },
        { reviewId: rid2, relation: "direct", confidence: 1, reason: "price complaint" },
        { reviewId: rid3, relation: "direct", confidence: 1, reason: "price complaint" },
      ] }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision: fixes the test citation but keeps requesting P1/ver-1. The
      // deterministic re-normalization must still downgrade it to P2/null and
      // the finding must still report SOURCE_NOT_COMPLETE.
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
        requirements: [
          { id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } },
        ],
        tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid1, rid2, rid3], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }],
        assumptions: [],
        note: "fixed test citation",
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

    const events = await collectEvents(runId);
    expect(events.some((e) => (e as { type: string }).type === "revision.started")).toBe(true);
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    // The REVISED finding (attempt-02) must still carry the partial-source
    // insufficiency, and the revised requirement must stay pinned to P2/null.
    const revisedPrd = (await store.readArtifact(runId, "prd", 2)) as {
      requirements: { priority: string; versionId: string | null }[];
      findings: { evidenceSufficiency: { status: string; reasons: string[] } }[];
    };
    expect(revisedPrd.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(revisedPrd.findings[0].evidenceSufficiency.reasons).toContain("SOURCE_NOT_COMPLETE");
    expect(revisedPrd.requirements[0]).toMatchObject({ priority: "P2", versionId: null });
  });
});
