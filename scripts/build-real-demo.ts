/**
 * Builds a real, model-driven cached run for the offline demo.
 *
 * Usage:
 *   MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... npm run demo:capture
 *
 * Pipeline:
 *  1. Reads the captured Apple RSS snapshot (data/runs/<captured>/sources/apple/snapshot.json).
 *  2. Feeds those real reviews into the app's own import path.
 *  3. Runs the full model-driven pipeline (scope -> topics -> findings -> planning -> tests -> traceability).
 *  4. Writes a complete, replayable run into data/runs/<runId>.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RunStore } from "../src/server/runs/run-store";
import { EventPublisher } from "../src/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps, type ImportParseShape } from "../src/server/pipeline/orchestrator";
import { OpenAiCompatibleClient } from "../src/server/model/openai-compatible-client";
import { loadConfig } from "../src/server/config";

const RUNS_DIR = path.join(process.cwd(), "data", "runs");

async function findCapturedSnapshot(): Promise<string | null> {
  const { readdir } = await import("node:fs/promises");
  const runs = await readdir(RUNS_DIR).catch(() => []);
  for (const runId of runs.sort().reverse()) {
    const p = path.join(RUNS_DIR, runId, "sources", "apple", "snapshot.json");
    const ok = await readFile(p, "utf8").catch(() => null);
    if (ok) return p;
  }
  return null;
}

export async function buildRealDemo(): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.modelBaseUrl || !cfg.modelName) {
    throw new Error("MODEL_BASE_URL and MODEL_NAME are required");
  }

  // Locate the captured snapshot (we saved its path during capture).
  const capturedPath = await findCapturedSnapshot();
  if (!capturedPath) {
    throw new Error("No captured snapshot found; run sample:capture first");
  }
  const snapshot = JSON.parse(await readFile(capturedPath, "utf8")) as {
    reviews: { sourceReviewId: string; rating: number; title: string; body: string; version: string | null; updatedAt: string | null }[];
  };

  // Convert to the import shape the pipeline expects.
  const parse: ImportParseShape = {
    reviews: snapshot.reviews.map((r) => ({
      sourceReviewId: r.sourceReviewId,
      source: "json-import" as const,
      title: r.title,
      body: r.body,
      rating: r.rating,
      version: r.version,
      updatedAt: r.updatedAt,
    })),
    rawRefs: snapshot.reviews.map((_, i) => `import:real-demo#row-${i + 1}`),
    errors: [],
    warnings: [],
    duplicateIndices: [],
    conflictIndices: [],
    evidence: { fileName: "real-snapshot.json", mediaType: "application/json", byteLength: 0, sha256: "real", schemaVersion: "1" },
  };

  const store = new RunStore(RUNS_DIR);
  const runId = store.createRunId();
  const publisher = new EventPublisher(store, () => new Date().toISOString(), "live");
  const model = new OpenAiCompatibleClient({
    baseUrl: cfg.modelBaseUrl,
    apiKey: cfg.modelApiKey ?? "",
    model: cfg.modelName,
    jsonMode: cfg.modelJsonMode,
  });
  const deps: ExecuteDeps = { model, source: { kind: "import", parse } };

  console.log(`Running real pipeline on ${snapshot.reviews.length} reviews -> ${runId}`);
  await executeRun(runId, "Identify the most impactful product problems and opportunities from real user reviews", "en", deps, publisher, store);

  const manifest = await store.readManifest(runId);
  console.log("Run status:", manifest.status);
  if (manifest.status !== "completed") {
    console.log("Limitations:", JSON.stringify(manifest.limitations, null, 2));
  }

  // Materialize the completed run into the bundled fixture so the offline demo
  // (fixtures/demo-runs/run-workout-for-women-us) is reproducible from this
  // command. Copying a directory tree under a fixed fixture name keeps the
  // shipped snapshot in sync with a fresh real capture+analysis.
  if (manifest.status === "completed") {
    const { cp, rm, mkdir } = await import("node:fs/promises");
    const fixtureDir = path.join(process.cwd(), "fixtures", "demo-runs", "run-workout-for-women-us");
    const sourceDir = store.resolveRunDir(runId);
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(fixtureDir, { recursive: true });
    await cp(sourceDir, fixtureDir, { recursive: true });
    // Rebase the fixture run id to the stable demo id so the offline demo is
    // deterministic (events still carry the original author run id inside,
    // which replay re-stamps anyway).
    const manifestPath = path.join(fixtureDir, "manifest.json");
    const { readFile, writeFile } = await import("node:fs/promises");
    const current = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...current, runId: "run-workout-for-women-us" }, null, 2), "utf8");
    console.log("Bundled fixture updated:", fixtureDir);
  }

  return runId;
}

// Run when invoked directly.
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/build-real-demo.ts")) {
  buildRealDemo()
    .then((runId) => console.log("DONE:", runId))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
