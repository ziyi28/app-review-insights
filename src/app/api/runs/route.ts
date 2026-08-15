import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { RunStartRequestSchema, type AnalyzeRequest } from "@/domain/contracts/run";
import { RunStore } from "@/server/runs/run-store";
import { RunCatalog } from "@/server/runs/run-catalog";
import { loadReplayRun } from "@/server/runs/replay";
import { executeAnalysisTask, executeReplayTask, registerActive, isRunActive } from "@/server/runs/run-executor";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { type ExecuteDeps, type ImportParseShape, type RunMetadata } from "@/server/pipeline/orchestrator";
import { OpenAiCompatibleClient } from "@/server/model/openai-compatible-client";
import { loadConfig, isModelConfigured } from "@/server/config";
import { parseImportedReviews } from "@/server/sources/import-parser";
import type { Limitation } from "@/server/sources/apple-rss-collector";
import { readPreview, isPreviewExpired, buildPreviewSnapshot, type SourcePreview } from "@/server/sources/source-preview";
import { extractAppNameFromUrl, parseAppStoreUrl } from "@/server/sources/app-store-url";

export const runtime = "nodejs";

// The background pipeline can run for tens of minutes; allow the route (and its
// `after()` callback) up to an hour on platforms that enforce maxDuration.
export const maxDuration = 3600;

/** Hard cap on the raw request body read before JSON parsing (bounds memory). */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const cfg = loadConfig();
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];
  const catalog = new RunCatalog(roots);
  const runs = await catalog.list();
  const populated = await Promise.all(
    runs.map(async (r) => {
      let appName = r.manifest.appName;
      let appUrl = r.manifest.appUrl;
      let fileName = r.manifest.fileName;

      // Backward-compatible fallback for runs created before appName/appUrl were persisted in manifest
      if (!appName && !appUrl && !fileName) {
        const store = new RunStore(r.root);
        try {
          const evidence = (await store.readArtifact(r.runId, "source-evidence", 1)) as
            | { kind?: string; appId?: string; canonicalUrl?: string; fileName?: string }
            | undefined;
          if (evidence?.kind === "app-store-reviews" && evidence.appId) {
            appUrl = evidence.canonicalUrl || `https://apps.apple.com/us/app/id${evidence.appId}`;
            appName = extractAppNameFromUrl(appUrl) || `App ${evidence.appId}`;
          } else if (evidence?.kind === "import" && evidence.fileName) {
            fileName = evidence.fileName;
          }
        } catch {
          // ignore artifact read error on corrupt or incomplete runs
        }
      }

      // A persisted `running` manifest whose task is no longer active in this
      // process is a run interrupted by a restart — surfaced as `interrupted`,
      // never as a live `running` job.
      const effectiveStatus = r.manifest.status === "running" && !isRunActive(r.runId) ? "interrupted" : r.manifest.status;

      return {
        runId: r.runId,
        status: effectiveStatus,
        createdAt: r.manifest.createdAt,
        canReplay: r.manifest.canReplay,
        canRetry: Boolean(r.manifest.startRequest && effectiveStatus !== "running"),
        goal: r.manifest.goal,
        executionMode: r.manifest.executionMode,
        appName,
        appUrl,
        fileName,
        // Only runs in the runtime store are deletable; bundled fixtures (demo
        // runs) are read-only and the UI hides their delete button.
        deletable: r.root === cfg.runsDir,
      };
    })
  );
  return NextResponse.json(
    {
      runs: populated,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

/**
 * Starts an analysis run or a cached replay as a background task. The response
 * is an immediate `202` carrying the run id and its re-connectable event URL;
 * the pipeline then executes detached from the request via `after()`, so a page
 * refresh or browser disconnect never aborts the analysis. Request-shape errors
 * are returned as problem JSON before any task is registered.
 */
export async function POST(req: Request) {
  const cfg = loadConfig();
  const store = new RunStore(cfg.runsDir);

  // Read the raw body with a byte cap before JSON.parse so a huge request
  // cannot exhaust memory first and only then get rejected.
  let raw: string;
  try {
    raw = await readBodyWithLimit(req.body, MAX_REQUEST_BYTES);
  } catch (err) {
    return problem("413", "request body too large", err instanceof Error ? err.message : String(err));
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return problem("400", "invalid JSON body");
  }

  const result = RunStartRequestSchema.safeParse(parsedBody);
  if (!result.success) {
    return problem("422", "invalid request", result.error.issues[0]?.message);
  }
  const request = result.data;

  if (request.mode === "cached-replay") {
    return startReplay(request.sourceRunId, store, cfg);
  }

  return startAnalysis(request, store, cfg);
}

function problem(status: string, title: string, detail?: string): NextResponse {
  return NextResponse.json({ type: "about:blank", title, status, detail }, { status: Number(status), headers: { "content-type": "application/problem+json" } });
}

async function readBodyWithLimit(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Loads and validates a preview snapshot for a preview-backed live run.
 * Returns the snapshot, or a problem descriptor when the preview is expired,
 * belongs to a different app, or the requested dataset is unavailable.
 */
async function loadValidPreview(
  previewsDir: string,
  previewId: string,
  requestedAppId: string,
  selection: "live" | "stable",
): Promise<SourcePreview | { problem: string; title: string; detail: string }> {
  const preview = await readPreview(previewsDir, previewId);
  if (!preview) {
    return { problem: "404", title: "preview not found", detail: `No preview snapshot exists for ${previewId}` };
  }
  const now = new Date().toISOString();
  if (isPreviewExpired(preview, now)) {
    return { problem: "422", title: "preview expired", detail: `Preview ${previewId} expired at ${preview.expiresAt}; re-check the sample` };
  }
  if (preview.appId !== requestedAppId) {
    return { problem: "422", title: "preview app mismatch", detail: `Preview ${previewId} belongs to app ${preview.appId}, not ${requestedAppId}` };
  }
  const available = selection === "live" ? preview.live.reviewCount > 0 : preview.stable.available && preview.stable.reviewCount > 0;
  if (!available) {
    return { problem: "422", title: "dataset unavailable", detail: `The ${selection} dataset is empty for this preview; choose the other sample or re-check` };
  }
  return preview;
}

async function startAnalysis(request: AnalyzeRequest, store: RunStore, cfg: ReturnType<typeof loadConfig>): Promise<Response> {
  let deps: ExecuteDeps;
  let executionMode: "live" | "import";
  let appName: string | undefined;
  let appUrl: string | undefined;
  let fileName: string | undefined;

  // Validate everything that can fail BEFORE the task is registered so request
  // errors are clean 4xx problem responses, not a started-then-failed run.
  const modelConfigured = isModelConfigured(cfg);
  const buildModel = () =>
    modelConfigured && cfg.modelBaseUrl && cfg.modelName
      ? new OpenAiCompatibleClient({
          baseUrl: cfg.modelBaseUrl,
          apiKey: cfg.modelApiKey ?? "",
          model: cfg.modelName,
          jsonMode: cfg.modelJsonMode,
          timeoutMs: cfg.modelTimeoutMs,
        })
      : ({ generate: async () => { throw new Error("model not configured"); } } as never);

  try {
    if (request.source.kind === "live") {
      const parsed = parseAppStoreUrl(request.source.appStoreUrl);
      appName = extractAppNameFromUrl(request.source.appStoreUrl) ?? `App ${parsed.appId}`;
      appUrl = parsed.canonicalUrl;
      executionMode = "live";
      const hasPreview = request.source.previewId !== undefined || request.source.reviewSelection !== undefined;
      if (request.source.previewId !== undefined && request.source.reviewSelection === undefined) {
        return problem("422", "previewId and reviewSelection must be provided together");
      }
      if (request.source.reviewSelection !== undefined && request.source.previewId === undefined) {
        return problem("422", "previewId and reviewSelection must be provided together");
      }
      let selected: SourcePreview;
      let selection: "live" | "stable";

      if (hasPreview) {
        const preview = await loadValidPreview(cfg.sourcePreviewsDir, request.source.previewId!, parsed.appId, request.source.reviewSelection!);
        if ("problem" in preview) {
          return problem(preview.problem, preview.title, preview.detail);
        }
        selected = preview;
        selection = request.source.reviewSelection!;
      } else {
        // Direct or historical retry without preview snapshot: build a fresh preview snapshot with dual-source fallback & local cache
        const previewId = `preview-${randomUUID()}`;
        const now = new Date().toISOString();
        const reviewLimit = request.source.reviewLimit ?? 500;
        selected = await buildPreviewSnapshot({
          previewId,
          appId: parsed.appId,
          canonicalUrl: parsed.canonicalUrl,
          now,
          reviewLimit,
          serpApiCollector: cfg.serpApiKey
            ? {
                fetchFn: fetch,
                now: () => new Date().toISOString(),
                baseUrl: cfg.serpApiBaseUrl,
                apiKey: cfg.serpApiKey,
                appId: parsed.appId,
                timeoutMs: cfg.serpApiTimeoutMs,
              }
            : null,
          rssCollector: {
            fetchFn: fetch,
            sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
            now: () => new Date().toISOString(),
            baseUrl: cfg.appleRssBaseUrl,
            appId: parsed.appId,
            maxPages: cfg.appleRssMaxPages,
            pageDelayMs: cfg.appleRssPageDelayMs,
            timeoutMs: cfg.appleRssTimeoutMs,
          },
          previewsDir: cfg.sourcePreviewsDir,
          cacheDir: cfg.sourceCacheDir,
          historyRoots: [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")],
          runsDir: cfg.runsDir,
        });

        if (selected.live.reviewCount > 0) {
          selection = selected.recommendedSelection ?? "live";
        } else if (selected.stable.available && selected.stable.reviewCount > 0) {
          selection = "stable";
        } else {
          selection = "live";
        }
      }

      const effectiveLimit = request.source.reviewLimit ?? selected.reviewLimit;
      const fullReviews = selection === "live" ? selected.live.reviews : selected.stable.reviews;
      const fullRawRefs = selection === "live" ? selected.live.rawRefs : selected.stable.reviews.map((r) => `cache:${r.sourceReviewId}`);
      const reviews = fullReviews.slice(0, effectiveLimit);
      const rawRefs = fullRawRefs.slice(0, effectiveLimit);
      const limitations: Limitation[] = [...selected.live.limitations];
      if (selection === "stable") {
        limitations.push({
          code: "LOCAL_HISTORY_SELECTED",
          message: "Analysis used the stable local-history review sample; it was not re-collected and is not freshly forced",
          stage: "source",
        });
      }
      // The run's source status comes from the preview's authoritative live
      // collection status — never re-derived from limitation codes. A stable
      // (local-history) selection with a previously-complete live collection
      // stays complete: the cached sample is valid even though it was not
      // re-collected. A stable selection over a partial/failed live can never
      // be upgraded to complete.
      const status: "complete" | "suspect-empty" | "partial" | "failed" =
        selection === "live"
          ? selected.live.status
          : selected.live.status === "complete"
            ? "complete"
            : "partial";
      deps = {
        model: buildModel(),
        source: {
          kind: "preview",
          data: {
            previewId: selected.previewId,
            appId: parsed.appId,
            canonicalUrl: parsed.canonicalUrl,
            selection,
            reviews,
            rawRefs,
            limitations,
            sourceFiles: selected.live.sourceFiles,
            sourceSummary: {
              kind: "app-store-reviews",
              provider: selected.live.provider,
              appId: parsed.appId,
              storefront: "US",
              status,
              selection,
              liveCount: selected.live.reviewCount,
              stableCount: selected.stable.reviewCount,
              reviewCount: reviews.length,
              reviewLimit: effectiveLimit,
              collectedAt: selected.live.collectedAt,
              forcedRefresh: selected.live.forcedRefresh,
              providerCached: selected.live.cached,
              requestCount: selected.live.requestCount,
              searchCount: "searchIds" in selected.live.evidence ? selected.live.evidence.requestCount : 0,
              searchId: "searchIds" in selected.live.evidence ? (selected.live.evidence.searchIds.at(-1) ?? null) : null,
              ...("pages" in selected.live.evidence && selected.live.evidence.pages
                ? { pages: selected.live.evidence.pages }
                : {}),
            },
          },
        },
        sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        now: () => new Date().toISOString(),
        pageDelayMs: cfg.appleRssPageDelayMs,
        maxPages: cfg.appleRssMaxPages,
        timeoutMs: cfg.appleRssTimeoutMs,
      };
    } else {
      fileName = request.source.fileName;
      const parseResult = parseImportedReviews({
        fileName: request.source.fileName,
        mediaType: request.source.mediaType,
        content: request.source.content,
      });
      executionMode = "import";
      deps = {
        model: buildModel(),
        source: { kind: "import", parse: parseResult as ImportParseShape },
      };
    }
  } catch (err) {
    return problem("422", "invalid source", err instanceof Error ? err.message : String(err));
  }

  const metadata: RunMetadata = {
    appName,
    appUrl,
    fileName,
    startRequest: request,
  };

  const runId = store.createRunId();
  const publisher = new EventPublisher(store, () => new Date().toISOString(), "live");

  // Persist a running manifest and a run.accepted event before returning so the
  // run is identifiable and listable the instant the client reconnects.
  await store.writeManifest(runId, {
    runId,
    status: "running",
    executionMode,
    goal: request.goal,
    appName,
    appUrl,
    fileName,
    startRequest: request,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: {},
    artifacts: {},
    limitations: [],
    canReplay: false,
  });
  await publisher.publish({ type: "run.accepted", runId, data: { runId } });

  registerActive(runId);
  after(() => executeAnalysisTask({ runId, request, deps, store, executionMode, modelConfigured, metadata, publisher }));

  return NextResponse.json(
    { runId, status: "running", eventsUrl: `/api/runs/${runId}/events` },
    { status: 202, headers: { "cache-control": "no-store" } }
  );
}

async function startReplay(sourceRunId: string, store: RunStore, cfg: ReturnType<typeof loadConfig>): Promise<Response> {
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];
  let bundle;
  try {
    bundle = await loadReplayRun(roots, sourceRunId);
  } catch (err) {
    return problem("404", "run not replayable", err instanceof Error ? err.message : String(err));
  }

  const runId = store.createRunId();
  const publisher = new EventPublisher(store, () => new Date().toISOString(), "cached-replay");

  await store.writeManifest(runId, {
    runId,
    status: "running",
    executionMode: "cached-replay",
    goal: bundle.manifest.goal,
    appName: bundle.manifest.appName,
    appUrl: bundle.manifest.appUrl,
    fileName: bundle.manifest.fileName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: {},
    artifacts: {},
    limitations: [],
    canReplay: false,
  });
  await publisher.publish({ type: "run.accepted", runId, data: { runId } });

  registerActive(runId);
  after(() => executeReplayTask({ runId, store, bundle, delayMs: cfg.replayEventDelayMs, publisher }));

  return NextResponse.json(
    { runId, status: "running", eventsUrl: `/api/runs/${runId}/events` },
    { status: 202, headers: { "cache-control": "no-store" } }
  );
}
