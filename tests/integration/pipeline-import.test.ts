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

  it("records each import parse error exactly once in the manifest limitations", async () => {
    const parse = parseImportedReviews({
      fileName: "partial.json",
      mediaType: "application/json",
      content: JSON.stringify({
        schemaVersion: "1",
        reviews: [
          { id: "r1", body: "The price is too high", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
          { id: "r2", rating: 5, updatedAt: "2026-07-02T00:00:00Z" }, // missing body
        ],
      }),
    });
    expect(parse.errors.length).toBeGreaterThan(0);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    const importParse = parse as ImportParseShape;
    const model = new ScriptedModelClient([], new Error("MODEL should not be called"));

    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: importParse } }, publisher, store, "import", false);

    const manifest = await store.readManifest(runId);
    // The same error used to be pushed by both the source and prepare stages.
    expect(manifest.limitations.filter((l) => l.code === "IMPORT_ERROR")).toHaveLength(1);
    const keys = manifest.limitations.map((l) => `${l.code} ${l.message}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("archives the original import file and records full parse evidence", async () => {
    const content = JSON.stringify({
      schemaVersion: "1",
      reviews: [
        { id: "r1", body: "Love the workout variety", rating: 5, updatedAt: "2026-07-01T00:00:00Z" },
        { id: "r2", body: "Too expensive now", rating: 1, updatedAt: "not-a-date" },
      ],
    });
    const parse = parseImportedReviews({ fileName: "user-supplied-name.json", mediaType: "application/json", content });
    const prepared = prepareReviews({ kind: "import", parse });
    const rid = prepared.reviews.find((r) => r.includedInAnalysis)!.reviewId;

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
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: parse as ImportParseShape } }, publisher, store);

    const runDir = store.resolveRunDir(runId);
    const { createHash } = await import("node:crypto");
    const sha = (t: string) => createHash("sha256").update(t).digest("hex");
    // The original file is archived byte-for-byte at the fixed safe path.
    const archived = await import("node:fs").then((fs) => fs.readFileSync(path.join(runDir, "sources", "import", "input.json"), "utf8"));
    expect(archived).toBe(content);
    expect(sha(archived)).toBe(parse.evidence.sha256);
    // source-evidence carries the full parse evidence.
    const evidence = (await store.readArtifact(runId, "source-evidence", 1)) as {
      kind: string;
      reviewCount: number;
      evidence: { fileName: string; mediaType: string; byteLength: number; sha256: string; schemaVersion: string | null };
      errors: string[];
      duplicateIndices: number[];
      conflictIndices: number[];
    };
    expect(evidence.kind).toBe("import");
    expect(evidence.evidence.fileName).toBe("user-supplied-name.json");
    expect(evidence.evidence.mediaType).toBe("application/json");
    expect(evidence.evidence.byteLength).toBe(Buffer.byteLength(content, "utf8"));
    expect(evidence.evidence.sha256).toBe(parse.evidence.sha256);
    expect(evidence.evidence.schemaVersion).toBe("1");
    expect(evidence.errors.some((e) => e.includes("invalid updatedAt"))).toBe(true);
    // The archived file is only ever referenced by its safe path; the user's
    // original filename appears only as evidence metadata.
    const raw = (await store.readArtifact(runId, "raw-reviews", 1)) as { rawRefs: string[] };
    for (const ref of raw.rawRefs) {
      expect(ref).toMatch(/^sources\/import\/input\.json#row-/);
      expect(ref).not.toContain("user-supplied-name.json");
    }
  });

  it("archives a CSV import to input.csv and warns on unknown columns", async () => {
    const content = [
      "id,title,body,rating,version,updatedAt,language,deviceModel",
      "csv-1,Great,Love the workout,5,3.2.1,2026-07-01T10:00:00Z,en,iPhone",
      "csv-2,Other,Too expensive,1,3.2.0,2026-07-02T10:00:00Z,en,Android",
    ].join("\n");
    const parse = parseImportedReviews({ fileName: "user.csv", mediaType: "text/csv", content });
    expect(parse.warnings.some((w) => w.includes("CSV unknown column ignored: deviceModel"))).toBe(true);
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
      JSON.stringify({ tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: [rid], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok" }] }),
    ]);

    const runId = store.createRunId();
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
    await executeRun(runId, "Understand pricing", "en", { model, source: { kind: "import", parse: parse as ImportParseShape } }, publisher, store);

    const runDir = store.resolveRunDir(runId);
    const archived = await import("node:fs").then((fs) => fs.readFileSync(path.join(runDir, "sources", "import", "input.csv"), "utf8"));
    expect(archived).toBe(content);
    const raw = (await store.readArtifact(runId, "raw-reviews", 1)) as { rawRefs: string[] };
    for (const ref of raw.rawRefs) expect(ref).toMatch(/^sources\/import\/input\.csv#row-/);
  });
});
