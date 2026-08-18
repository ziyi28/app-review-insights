/**
 * Re-runs the full model-driven pipeline against a previously-collected
 * Goodnotes corpus (offline — reuses the cached raw-reviews/source-evidence,
 * no re-collection). Used to confirm the requirement-evidence fix against the
 * exact corpus that produced the baf6fa3b -> req-2 mismatch.
 *
 * Usage: npx tsx scripts/rerun-goodnotes.ts <source-run-id> [new-run-id]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { RunStore } from "../src/server/runs/run-store";
import { EventPublisher } from "../src/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps, type AppStoreReviewSourceSummary } from "../src/server/pipeline/orchestrator";
import { OpenAiCompatibleClient } from "../src/server/model/openai-compatible-client";
import { loadConfig, readEnvLocal } from "../src/server/config";
import type { RawReview } from "../src/domain/contracts/review";

async function main(): Promise<void> {
  for (const [k, v] of Object.entries(readEnvLocal())) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  const cfg = loadConfig();
  if (!cfg.modelBaseUrl || !cfg.modelName) throw new Error("MODEL_BASE_URL and MODEL_NAME are required");

  const sourceRunId = process.argv[2];
  if (!sourceRunId) throw new Error("usage: rerun-goodnotes.ts <source-run-id> [new-run-id]");

  const sourceDir = path.join(cfg.runsDir, sourceRunId);
  const rawArtifact = JSON.parse(await fs.readFile(path.join(sourceDir, "artifacts", "raw-reviews.attempt-01.json"), "utf8")) as {
    reviews: RawReview[];
    rawRefs: string[];
  };
  const sourceSummary = JSON.parse(await fs.readFile(path.join(sourceDir, "artifacts", "source-evidence.attempt-01.json"), "utf8")) as AppStoreReviewSourceSummary;
  const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8")) as {
    goal?: string;
    appName?: string;
    appUrl?: string;
    startRequest?: { outputLocale?: string; goal?: string };
  };

  const goal = manifest.startRequest?.goal?.trim() || manifest.goal || "Analyze user reviews";
  const outputLocale = manifest.startRequest?.outputLocale === "zh-CN" ? "zh-CN" : "en";
  const canonicalUrl = manifest.appUrl ?? `https://apps.apple.com/us/app/id${sourceSummary.appId}`;

  const store = new RunStore(cfg.runsDir);
  const runId = process.argv[3] ?? store.createRunId();
  const publisher = new EventPublisher(store, () => new Date().toISOString(), "live");
  const model = new OpenAiCompatibleClient({
    baseUrl: cfg.modelBaseUrl,
    apiKey: cfg.modelApiKey ?? "",
    model: cfg.modelName,
    jsonMode: cfg.modelJsonMode,
  });

  const deps: ExecuteDeps = {
    model,
    source: {
      kind: "preview",
      data: {
        previewId: `rerun-${sourceSummary.appId}`,
        appId: sourceSummary.appId,
        canonicalUrl,
        selection: "live",
        reviews: rawArtifact.reviews,
        rawRefs: rawArtifact.rawRefs,
        limitations: [],
        sourceSummary,
      },
    },
  };
  const metadata = { appName: manifest.appName, appUrl: canonicalUrl };

  console.log(`Re-running ${manifest.appName} (${rawArtifact.reviews.length} reviews) -> ${runId}`);
  await executeRun(runId, goal, outputLocale, deps, publisher, store, "live", true, metadata);

  const final = await store.readManifest(runId);
  console.log("Run status:", final.status);
  console.log("Limitations:", JSON.stringify(final.limitations.map((l) => l.code), null, 2));
  console.log("DONE:", runId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
