/**
 * Builds a real, model-driven cached run for the offline demo.
 *
 * Usage:
 *   MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... npm run demo:capture
 *
 * Pipeline:
 *  1. Collects real US App Store reviews — SerpApi Apple Reviews first (when
 *     SERPAPI_API_KEY is configured), with an explicit Apple RSS fallback —
 *     using the same collectors as the live pipeline.
 *  2. Feeds those reviews into the pipeline's preview source path so the
 *     source-evidence artifact records the true provider.
 *  3. Runs the full model-driven pipeline (scope -> topics -> findings ->
 *     planning -> tests -> traceability).
 *  4. Writes a complete, replayable run into fixtures/demo-runs/<FIXTURE_NAME>.
 *
 * Parameterized via env so any app can be captured without code changes:
 *   APP_ID        (default 839285684 — "Workout for Women")
 *   APP_NAME      (default "Workout for Women")
 *   FIXTURE_NAME  (default "run-workout-for-women-us")
 *   GOAL          (analysis goal fed to the pipeline)
 *   OUTPUT_LOCALE (en | zh-CN, default "en")
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { RunStore } from "../src/server/runs/run-store";
import { EventPublisher } from "../src/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps, type AppStoreReviewSourceSummary } from "../src/server/pipeline/orchestrator";
import { OpenAiCompatibleClient } from "../src/server/model/openai-compatible-client";
import { loadConfig, readEnvLocal } from "../src/server/config";
import { collectSerpApiReviews } from "../src/server/sources/serpapi-collector";
import { collectAppleReviews } from "../src/server/sources/apple-rss-collector";
import type { Limitation } from "../src/server/sources/source-types";
import type { RawReview } from "../src/domain/contracts/review";

const DEFAULT_APP_ID = "839285684";
const DEFAULT_APP_NAME = "Workout for Women";
const DEFAULT_FIXTURE_NAME = "run-workout-for-women-us";
const DEFAULT_OUTPUT_LOCALE = "en";
const DEFAULT_GOAL =
  "Analyze the most impactful problems and opportunities from US App Store reviews. " +
  "Identify the most polarizing features — loved by some users, disliked by others — " +
  "especially around subscription value and workout usability. Capture conflicting " +
  "feedback explicitly instead of discarding it.";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function buildRealDemo(): Promise<string> {
  // `tsx` does not auto-load `.env.local` (that is Next.js behavior), so merge
  // it into the process env first. Explicit command-line env wins over the file.
  for (const [k, v] of Object.entries(readEnvLocal())) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  const cfg = loadConfig();
  if (!cfg.modelBaseUrl || !cfg.modelName) {
    throw new Error("MODEL_BASE_URL and MODEL_NAME are required");
  }

  const appId = process.env.APP_ID ?? DEFAULT_APP_ID;
  const appName = process.env.APP_NAME ?? DEFAULT_APP_NAME;
  const fixtureName = process.env.FIXTURE_NAME ?? DEFAULT_FIXTURE_NAME;
  const outputLocale = (process.env.OUTPUT_LOCALE === "zh-CN" ? "zh-CN" : DEFAULT_OUTPUT_LOCALE) as "en" | "zh-CN";
  const goal = process.env.GOAL?.trim() || DEFAULT_GOAL;
  const canonicalUrl = `https://apps.apple.com/us/app/id${appId}`;
  const now = () => new Date().toISOString();

  // Collect reviews through the same provider-first logic as the live preview:
  // SerpApi when configured and it returns reviews, otherwise Apple RSS. This
  // matters because some apps (e.g. workout-for-women) return an empty RSS feed
  // but have live reviews via SerpApi.
  const collectedAt = now();
  let provider: "serpapi" | "apple-rss";
  let reviews: RawReview[];
  let rawRefs: string[];
  let limitations: Limitation[];
  let status: "complete" | "suspect-empty" | "partial" | "failed";
  let requestCount: number;
  let searchCount: number;
  let searchId: string | null;
  let forcedRefresh: boolean;

  if (cfg.serpApiKey) {
    const serp = await collectSerpApiReviews({
      fetchFn: fetch,
      now,
      baseUrl: cfg.serpApiBaseUrl,
      apiKey: cfg.serpApiKey,
      appId,
      timeoutMs: cfg.serpApiTimeoutMs,
    });
    if (serp.reviews.length > 0) {
      provider = "serpapi";
      reviews = serp.reviews;
      rawRefs = serp.rawRefs;
      limitations = serp.limitations;
      status = serp.status;
      requestCount = serp.evidence.requestCount;
      searchCount = serp.evidence.requestCount;
      searchId = serp.evidence.searchIds.at(-1) ?? null;
      forcedRefresh = true;
    } else {
      // Preserve every SerpApi limitation before falling back to RSS.
      const rss = await collectAppleReviews({
        fetchFn: fetch,
        sleep,
        now,
        baseUrl: cfg.appleRssBaseUrl,
        appId,
        maxPages: cfg.appleRssMaxPages,
        pageDelayMs: cfg.appleRssPageDelayMs,
        timeoutMs: cfg.appleRssTimeoutMs,
      });
      provider = "apple-rss";
      reviews = rss.reviews;
      rawRefs = rss.rawRefs;
      limitations = [...serp.limitations, ...rss.limitations];
      status = rss.status;
      requestCount = rss.pages.reduce((n, p) => n + p.attempt, 0);
      searchCount = 0;
      searchId = null;
      forcedRefresh = false;
    }
  } else {
    const rss = await collectAppleReviews({
      fetchFn: fetch,
      sleep,
      now,
      baseUrl: cfg.appleRssBaseUrl,
      appId,
      maxPages: cfg.appleRssMaxPages,
      pageDelayMs: cfg.appleRssPageDelayMs,
      timeoutMs: cfg.appleRssTimeoutMs,
    });
    provider = "apple-rss";
    reviews = rss.reviews;
    rawRefs = rss.rawRefs;
    limitations = rss.limitations;
    status = rss.status;
    requestCount = rss.pages.reduce((n, p) => n + p.attempt, 0);
    searchCount = 0;
    searchId = null;
    forcedRefresh = false;
  }

  if (reviews.length === 0) {
    throw new Error(`No reviews collected for app ${appId} (status: ${status}); cannot build a demo fixture`);
  }

  const sourceSummary: AppStoreReviewSourceSummary = {
    kind: "app-store-reviews",
    provider,
    appId,
    storefront: "US",
    status,
    selection: "live",
    liveCount: reviews.length,
    stableCount: 0,
    reviewCount: reviews.length,
    collectedAt,
    forcedRefresh,
    providerCached: false,
    requestCount,
    searchCount,
    searchId,
  };

  const store = new RunStore(cfg.runsDir);
  const runId = store.createRunId();
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
        previewId: `demo-${appId}`,
        appId,
        canonicalUrl,
        selection: "live",
        reviews,
        rawRefs,
        limitations,
        sourceSummary,
      },
    },
    fetchFn: fetch,
    sleep,
    now,
    pageDelayMs: cfg.appleRssPageDelayMs,
    maxPages: cfg.appleRssMaxPages,
    timeoutMs: cfg.appleRssTimeoutMs,
  };
  const metadata = { appName, appUrl: canonicalUrl };

  console.log(`Collecting + analyzing app ${appId} (${appName}, ${provider}, ${reviews.length} reviews) -> ${runId}`);
  await executeRun(runId, goal, outputLocale, deps, publisher, store, "live", true, metadata);

  const manifest = await store.readManifest(runId);
  console.log("Run status:", manifest.status);
  if (manifest.status !== "completed") {
    console.log("Limitations:", JSON.stringify(manifest.limitations, null, 2));
    throw new Error(`Run did not complete (status: ${manifest.status}); fixture not written`);
  }

  // Materialize the completed run into the bundled fixture so the offline demo
  // (fixtures/demo-runs/<FIXTURE_NAME>) is reproducible from this command.
  const fixtureDir = path.join(process.cwd(), "fixtures", "demo-runs", fixtureName);
  const sourceDir = store.resolveRunDir(runId);
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.cp(sourceDir, fixtureDir, { recursive: true });

  // Rebase the fixture run id to the stable demo id so the offline demo is
  // deterministic (events still carry the original author run id inside, which
  // replay re-stamps anyway).
  const manifestPath = path.join(fixtureDir, "manifest.json");
  const current = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await fs.writeFile(manifestPath, JSON.stringify({ ...current, runId: fixtureName }, null, 2), "utf8");

  // Write the provenance declaration the fixture requires: it records the real
  // data source, storefront, privacy minimization, and the model analysis.
  const promptVersions = [...new Set((manifest.promptVersions ?? []) as string[])];
  const provenance = {
    provenance: {
      schemaVersion: "1",
      reviewData: provider === "serpapi" ? "serpapi-apple-reviews-real" : "apple-rss-real",
      storefront: "us",
      appId,
      capturedAt: collectedAt,
      captureMethod:
        provider === "serpapi"
          ? "SerpApi Apple Reviews engine (country=us, sort=mostrecent, no_cache=true)"
          : "Apple Customer Reviews RSS (sequential, max 10 pages, >=500ms delay)",
      privacyMinimization:
        "reviewer nickname, author URI, and sensitive headers removed; review id/rating/title/body/version/updatedAt retained",
    },
    analysis: {
      executionMode: "live",
      outputLocale,
      goal,
      modelProvider: "OpenAI-compatible endpoint",
      modelName: cfg.modelName,
      temperature: 0.1,
      promptVersions,
    },
  };
  await fs.writeFile(path.join(fixtureDir, "provenance.json"), JSON.stringify(provenance, null, 2), "utf8");

  console.log("Bundled fixture updated:", fixtureDir);
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
