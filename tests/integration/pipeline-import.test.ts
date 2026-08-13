import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ImportParseShape } from "@/server/pipeline/orchestrator";
import { ScriptedModelClient } from "@/server/model/scripted-client";
import { parseImportedReviews } from "@/server/sources/import-parser";
import { prepareReviews } from "@/domain/reviews/prepare";

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pimp-"));
  store = new RunStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("executeRun (import with mixed languages, duplicates, conflicts)", () => {
  it("dedupes imported duplicates, keeps conflicts, and completes", async () => {
    const parse = parseImportedReviews({
      fileName: "mixed.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [
          { id: "a1", body: "Love the workout variety", rating: 5, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "a2", body: "Love the workout variety", rating: 5, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "a1", body: "Changed my mind, too expensive", rating: 1, updatedAt: "2026-07-02T00:00:00Z" },
        ],
      }),
    });

    const prepared = prepareReviews({ kind: "import", parse });
    const included = prepared.reviews.filter((r) => r.includedInAnalysis);
    expect(prepared.stats.duplicateCount).toBe(1);
    expect(prepared.stats.identityConflictCount).toBe(2);

    const rid = included.find((r) => r.bodyNormalized.includes("too expensive"))!.reviewId;
    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Understand pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Pricing", description: "d", supportingReviewIds: [rid], quote: "too expensive" }] }),
      JSON.stringify({ topics: [{ id: "topic-1", label: "Pricing", description: "d", candidateIds: ["topic-candidate-1"] }] }),
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "Users find it costly", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      JSON.stringify({
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "Ships the pricing fix first", requirementIds: ["req-1"] }],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      JSON.stringify({
        tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }],
      }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;

    await executeRun(runId, "Understand why users churn", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store);

    const manifest = await store.readManifest(runId);
    if (manifest.status !== "completed") {
      const file = path.join(store.resolveRunDir(runId), "events.ndjson");
      const { readFileSync } = await import("node:fs");
      const events = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const failed = events.find((e) => e.type === "run.failed");
      console.log("IMPORT FAILED:", JSON.stringify(failed?.data ?? {}).slice(0, 800));
      console.log("LIMITATIONS:", JSON.stringify(manifest.limitations).slice(0, 500));
    }
    expect(manifest.status).toBe("completed");
  });

  it("records executionMode import in the manifest (not live)", async () => {
    const parse = parseImportedReviews({
      fileName: "one.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [{ id: "r1", body: "The price is too high for me", rating: 1, updatedAt: "2026-07-01T00:00:00Z" }],
      }),
    });
    const prepared = prepareReviews({ kind: "import", parse });
    const rid = prepared.reviews[0].reviewId;
    const model = new ScriptedModelClient([
      JSON.stringify({ interpretation: "Pricing", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] }),
      JSON.stringify({ topics: [{ id: "topic-candidate-1", label: "Price", description: "d", supportingReviewIds: [rid], quote: "too high" }] }),
      JSON.stringify({ topics: [{ id: "topic-1", label: "Price", description: "d", candidateIds: ["topic-candidate-1@c0"] }] }),
      JSON.stringify({
        findings: [
          { id: "finding-1", topicIds: ["topic-1"], title: "Too expensive", summary: "x", supportingReviewIds: [rid], evidenceExcerpts: [{ reviewId: rid, excerpt: "too high" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        ],
      }),
      JSON.stringify({
        title: "Plan", overview: "x", versions: [{ id: "ver-1", name: "1.0.0", summary: "x", rationale: "Ships the pricing fix first", requirementIds: ["req-1"] }],
        requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "Lower price", description: "x", priority: "P1", acceptanceCriteria: ["cheaper"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact, small scope" } }],
        assumptions: [],
      }),
      JSON.stringify({
        tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }],
      }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;
    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.executionMode).toBe("import");
  });

  it("runs deterministic import+clean without a model and completes with a MODEL_NOT_CONFIGURED limitation", async () => {
    const parse = parseImportedReviews({
      fileName: "no-model.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [{ id: "r1", body: "The price is too high", rating: 1, updatedAt: "2026-07-01T00:00:00Z" }],
      }),
    });
    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;
    // A throwing model proves it is never called.
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));

    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store, "import", false);

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.limitations.some((l) => l.code === "MODEL_NOT_CONFIGURED")).toBe(true);
    // Deterministic artifacts exist even without a model.
    expect(await store.readArtifact(runId, "cleaned-reviews", 1)).toBeDefined();
    // Model was never called.
    expect(model.callIndex).toBe(0);
  });
});
