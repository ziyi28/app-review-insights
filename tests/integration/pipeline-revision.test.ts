import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ImportParseShape } from "@/server/pipeline/orchestrator";
import { ScriptedModelClient } from "@/server/model/scripted-client";
import { prepareReviews } from "@/domain/reviews/prepare";
import { parseImportedReviews } from "@/server/sources/import-parser";

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
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", requirementIds: ["req-1"] }],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1" }],
        assumptions: [],
      }),
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
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1" }],
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
        title: "Plan", overview: "x", versions: [], requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null }],
        assumptions: [],
      }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision: same insufficient finding, still requests P1.
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null }],
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
        title: "Plan", overview: "x", versions: [], requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null }],
        assumptions: [],
      }),
      // tests cite a ghost review -> traceability fails -> revision runs
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["ghost-review"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
      // revision still leaves the requirement uncovered (empty tests)
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: null }],
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
});
