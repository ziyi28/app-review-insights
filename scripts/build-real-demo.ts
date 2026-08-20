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
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { RunStore } from "../src/server/runs/run-store";
import { EventPublisher } from "../src/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps, type AppStoreReviewSourceSummary, type RunMetadata } from "../src/server/pipeline/orchestrator";
import { OpenAiCompatibleClient } from "../src/server/model/openai-compatible-client";
import { loadConfig, readEnvLocal } from "../src/server/config";
import { collectSerpApiReviews } from "../src/server/sources/serpapi-collector";
import { collectAppleReviews } from "../src/server/sources/apple-rss-collector";
import { AppleReviewCacheStore } from "../src/server/sources/apple-review-cache";
import { archiveCachedFixtureReviews, type CacheFixtureArchiveEvidence } from "../src/server/sources/cache-fixture-archive";
import { validateTraceability } from "../src/domain/traceability/validate";
import { prepareReviews } from "../src/domain/reviews/prepare";
import type { Limitation, SourceFile } from "../src/server/sources/source-types";
import type { RawReview } from "../src/domain/contracts/review";
import type { Prd } from "../src/domain/contracts/analysis";

const DEFAULT_APP_ID = "839285684";
const DEFAULT_APP_NAME = "Workout for Women";
const DEFAULT_FIXTURE_NAME = "run-workout-for-women-us";
const DEFAULT_OUTPUT_LOCALE = "zh-CN";
const DEFAULT_GOAL =
  "分析美国应用商店用户评论中影响最大的问题与改进机会。识别最具争议的功能点（部分用户喜欢但另一部分用户反感），尤其是关于订阅付费价值与健身训练易用性方面。明确记录冲突的反馈而非忽略。";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function buildRealDemo(): Promise<string> {
  // `tsx` does not auto-load `.env.local` (that is Next.js behavior), so merge
  // it into the process env first. Explicit command-line env wins over the file.
  for (const [k, v] of Object.entries(readEnvLocal())) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  const cfg = loadConfig();
  const modelBaseUrl = process.env.MODEL_BASE_URL || cfg.modelBaseUrl;
  const modelApiKey = process.env.MODEL_API_KEY !== undefined ? process.env.MODEL_API_KEY : cfg.modelApiKey;
  const modelName = process.env.MODEL_NAME || cfg.modelName;
  const rawEffort = process.env.MODEL_REASONING_EFFORT;
  const isEffort = (v: string): v is "low" | "medium" | "high" | "max" =>
    ["low", "medium", "high", "max"].includes(v);
  const modelReasoningEffort = rawEffort && isEffort(rawEffort)
    ? rawEffort
    : cfg.modelReasoningEffort;
  const modelTimeoutMs = Number(process.env.MODEL_TIMEOUT_MS) || cfg.modelTimeoutMs || 900_000;

  if (!modelBaseUrl || !modelName) {
    throw new Error("MODEL_BASE_URL and MODEL_NAME are required");
  }

  const appId = process.env.APP_ID ?? DEFAULT_APP_ID;
  const appName = process.env.APP_NAME ?? DEFAULT_APP_NAME;
  const fixtureName = process.env.FIXTURE_NAME ?? DEFAULT_FIXTURE_NAME;
  const outputLocale = (process.env.OUTPUT_LOCALE === "zh-CN" ? "zh-CN" : DEFAULT_OUTPUT_LOCALE) as "en" | "zh-CN";
  const goal = process.env.GOAL?.trim() || DEFAULT_GOAL;
  const canonicalUrl = `https://apps.apple.com/us/app/id${appId}`;
  const now = () => new Date().toISOString();

  const collectedAt = now();
  let provider: "serpapi" | "apple-rss" | "cache";
  let selection: "live" | "stable" = "live";
  let providerCached = false;
  let reviews: RawReview[];
  let rawRefs: string[];
  let sourceFiles: SourceFile[] = [];
  let limitations: Limitation[];
  let status: "complete" | "suspect-empty" | "partial" | "failed";
  let requestCount: number;
  let searchCount: number;
  let searchId: string | null;
  let forcedRefresh: boolean;
  let liveCount = 0;
  let stableCount = 0;
  let cacheEvidence: CacheFixtureArchiveEvidence | undefined;

  const reviewLimit = Number(process.env.DEMO_REVIEW_LIMIT || process.env.REVIEW_LIMIT) || 300;

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
      sourceFiles = [];
      limitations = serp.limitations;
      status = serp.status;
      requestCount = serp.evidence.requestCount;
      searchCount = serp.evidence.requestCount;
      searchId = serp.evidence.searchIds.at(-1) ?? null;
      forcedRefresh = true;
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
      sourceFiles = rss.sourceFiles;
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
    sourceFiles = rss.sourceFiles;
    limitations = rss.limitations;
    status = rss.status;
    requestCount = rss.pages.reduce((n, p) => n + p.attempt, 0);
    searchCount = 0;
    searchId = null;
    forcedRefresh = false;
  }

  liveCount = reviews.length;

  if (reviews.length < reviewLimit) {
    const cacheStore = new AppleReviewCacheStore(cfg.sourceCacheDir);
    const cached = await cacheStore.readCache("us", appId);
    if (cached && cached.reviews && cached.reviews.length >= reviewLimit) {
      const selectedReviews = cached.reviews.slice(0, reviewLimit);
      const archive = archiveCachedFixtureReviews(cached, selectedReviews);
      provider = "cache";
      selection = "stable";
      providerCached = true;
      reviews = selectedReviews;
      rawRefs = archive.rawRefs;
      sourceFiles = archive.sourceFiles;
      cacheEvidence = archive.evidence;
      stableCount = selectedReviews.length;
      status = "complete";
      requestCount = Math.ceil(reviews.length / 50);
      searchCount = 0;
      searchId = null;
      forcedRefresh = false;
      limitations.push({
        code: "LOCAL_HISTORY_SELECTED",
        message: `Live review collection was short of limit (${liveCount}/${reviewLimit}); selected verified local cache snapshot of ${stableCount} reviews`,
        stage: "source",
      });
      console.log(`Using archived local cache reviews for app ${appId}: ${reviews.length} reviews (limit: ${reviewLimit})`);
    } else {
      throw new Error(
        `Insufficient reviews for app ${appId} (live: ${liveCount}, cache: ${cached?.reviews?.length ?? 0}, required: ${reviewLimit}); cannot build demo fixture`,
      );
    }
  }

  if (reviews.length > reviewLimit) {
    reviews = reviews.slice(0, reviewLimit);
    rawRefs = rawRefs.slice(0, reviewLimit);
  }

  if (reviews.length !== reviewLimit || rawRefs.length !== reviewLimit) {
    throw new Error(`Target fixture must have exactly ${reviewLimit} reviews and rawRefs, got ${reviews.length}/${rawRefs.length}`);
  }

  const sourceSummary: AppStoreReviewSourceSummary = {
    kind: "app-store-reviews",
    provider,
    appId,
    storefront: "US",
    status,
    selection,
    liveCount,
    stableCount,
    reviewCount: reviews.length,
    reviewLimit,
    collectedAt,
    forcedRefresh,
    providerCached,
    requestCount,
    searchCount,
    searchId,
    cache: cacheEvidence,
  };

  const store = new RunStore(cfg.runsDir);
  const runId = store.createRunId();
  const publisher = new EventPublisher(store, () => new Date().toISOString(), "live");
  const model = new OpenAiCompatibleClient({
    baseUrl: modelBaseUrl,
    apiKey: modelApiKey ?? "",
    model: modelName,
    jsonMode: cfg.modelJsonMode,
    reasoningEffort: modelReasoningEffort,
    timeoutMs: modelTimeoutMs,
  });

  const deps: ExecuteDeps = {
    model,
    source: {
      kind: "preview",
      data: {
        previewId: `demo-${appId}`,
        appId,
        canonicalUrl,
        selection,
        reviews,
        rawRefs,
        limitations,
        sourceSummary,
        sourceFiles,
      },
    },
    fetchFn: fetch,
    sleep,
    now,
    pageDelayMs: cfg.appleRssPageDelayMs,
    maxPages: cfg.appleRssMaxPages,
    timeoutMs: cfg.appleRssTimeoutMs,
  };
  const metadata: RunMetadata = {
    appName,
    appUrl: canonicalUrl,
    startRequest: {
      protocolVersion: "1",
      mode: "analyze",
      uiLocale: "zh-CN",
      outputLocale,
      goal,
      source: { kind: "live", appStoreUrl: canonicalUrl, reviewLimit: reviews.length >= 500 ? 500 : reviews.length >= 300 ? 300 : 100 },
    },
  };

  console.log(`Collecting + analyzing app ${appId} (${appName}, ${provider}, ${reviews.length} reviews, model: ${modelName}, reasoning: ${modelReasoningEffort}) -> ${runId}`);
  await executeRun(runId, goal, outputLocale, deps, publisher, store, "live", true, metadata);

  const manifest = await store.readManifest(runId);
  console.log("Run status:", manifest.status);
  if (manifest.status !== "completed") {
    console.log("Limitations:", JSON.stringify(manifest.limitations, null, 2));
    throw new Error(`Run did not complete (status: ${manifest.status}); fixture not written`);
  }

  // Validate traceability using the authoritative domain validator before saving fixture
  const finalReport = (await store.readArtifact(runId, "final-report", manifest.artifacts["final-report"]?.attempt ?? 1)) as { prd: Prd };
  const prepared = prepareReviews({ kind: "collected", reviews, rawRefs, limitations });
  const reviewMap = new Map(prepared.reviews.map((r) => [r.reviewId, r]));
  const traceReport = validateTraceability(finalReport.prd, prepared.reviews.map((r) => r.reviewId), reviewMap);
  console.log("Traceability valid:", traceReport.valid, "closureStatus:", traceReport.closureStatus, "violations:", traceReport.violations.length);
  if (!traceReport.valid) {
    throw new Error(`Traceability invalid: ${JSON.stringify(traceReport.violations, null, 2)}`);
  }

  // Materialize the completed run into the bundled fixture so the offline demo
  // (fixtures/demo-runs/<FIXTURE_NAME>) is reproducible from this command.
  const fixtureDir = path.join(process.cwd(), "fixtures", "demo-runs", fixtureName);
  const sourceDir = store.resolveRunDir(runId);
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.cp(sourceDir, fixtureDir, { recursive: true });

  // Rebase the fixture run id to the stable demo id and rewrite events.ndjson
  const manifestPath = path.join(fixtureDir, "manifest.json");
  const current = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await fs.writeFile(manifestPath, JSON.stringify({ ...current, runId: fixtureName }, null, 2), "utf8");

  const eventsPath = path.join(fixtureDir, "events.ndjson");
  if (existsSync(eventsPath)) {
    const rawEvents = await fs.readFile(eventsPath, "utf8");
    const rewritten = rawEvents
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const ev = JSON.parse(line) as { sequence: number; runId: string; eventId?: string };
        ev.runId = fixtureName;
        ev.eventId = `${fixtureName}-${ev.sequence}`;
        return JSON.stringify(ev);
      })
      .join("\n") + "\n";
    await fs.writeFile(eventsPath, rewritten, "utf8");
  }

  let reviewData: string;
  let captureMethod: string;
  if (provider === "serpapi") {
    reviewData = "serpapi-apple-reviews-real";
    captureMethod = "SerpApi Apple Reviews engine (country=us, sort=mostrecent, no_cache=true)";
  } else if (provider === "apple-rss") {
    reviewData = "apple-rss-real";
    captureMethod = "Apple Customer Reviews RSS (sequential, max 10 pages, >=500ms delay)";
  } else {
    const distinctSources = Object.keys(cacheEvidence?.sourceCounts ?? {});
    reviewData = distinctSources.length > 1 ? "local-cache-real-mixed" : "local-cache-real";
    captureMethod = `Verified local immutable cache archive (${cacheEvidence?.rawFile}, sha256=${cacheEvidence?.sha256})`;
  }

  // Write the provenance declaration the fixture requires: it records the real
  // data source, storefront, privacy minimization, and the model analysis.
  const promptVersions = [...new Set((manifest.promptVersions ?? []) as string[])];
  const provenance = {
    provenance: {
      schemaVersion: "1",
      reviewData,
      storefront: "us",
      appId,
      capturedAt: collectedAt,
      captureMethod,
      privacyMinimization:
        "reviewer nickname, author URI, and sensitive headers removed; review id/rating/title/body/version/updatedAt retained",
      ...(cacheEvidence
        ? {
            cache: {
              rawFile: cacheEvidence.rawFile,
              byteLength: cacheEvidence.byteLength,
              sha256: cacheEvidence.sha256,
              cacheUpdatedAt: cacheEvidence.cacheUpdatedAt,
              bootstrapRunId: cacheEvidence.bootstrapRunId,
              sourceCounts: cacheEvidence.sourceCounts,
            },
          }
        : {}),
    },
    analysis: {
      executionMode: "live",
      outputLocale,
      goal,
      modelProvider: "OpenAI-compatible endpoint",
      modelName,
      reasoningEffort: modelReasoningEffort,
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
