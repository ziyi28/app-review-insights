import path from "node:path";
import { NextResponse } from "next/server";
import { RunStartRequestSchema, type AnalyzeRequest } from "@/domain/contracts/run";
import { RunStore } from "@/server/runs/run-store";
import { RunCatalog } from "@/server/runs/run-catalog";
import { loadReplayRun } from "@/server/runs/replay";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps, type ImportParseShape } from "@/server/pipeline/orchestrator";
import { OpenAiCompatibleClient } from "@/server/model/openai-compatible-client";
import { loadConfig, isModelConfigured } from "@/server/config";
import { parseImportedReviews } from "@/server/sources/import-parser";
import { encodeNdjsonLine } from "@/server/streaming/ndjson";
import type { RunEvent } from "@/domain/contracts/events";

export const runtime = "nodejs";

/** Hard cap on the raw request body read before JSON parsing (bounds memory). */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const cfg = loadConfig();
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];
  const catalog = new RunCatalog(roots);
  const runs = await catalog.list();
  return NextResponse.json({ runs: runs.map((r) => ({ runId: r.runId, status: r.manifest.status, createdAt: r.manifest.createdAt, canReplay: r.manifest.canReplay })) }, { headers: { "cache-control": "no-store" } });
}

/**
 * Starts an analysis run or replays a cached one. The response is a streamed
 * NDJSON sequence of RunEvents; request-shape errors are returned as problem
 * JSON before the stream starts.
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
    const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];
    return replayRun(request.sourceRunId, store, cfg.replayEventDelayMs, roots);
  }

  return startAnalysis(request, store, cfg, req);
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
 * Replays a cached run into a fresh, fully materialized run: artifacts are
 * copied into the new run directory, a completed+canReplay manifest is written
 * (so the artifact API works), and the event stream is re-emitted re-stamped
 * with the new run id and deliveryMode=cached-replay. The source snapshot is
 * never re-collected and the model is never called.
 */
async function replayRun(sourceRunId: string, store: RunStore, delayMs: number, roots: string[]): Promise<Response> {
  let bundle;
  try {
    bundle = await loadReplayRun(roots, sourceRunId);
  } catch (err) {
    return problem("404", "run not replayable", err instanceof Error ? err.message : String(err));
  }

  const publisher = new EventPublisher(store, () => new Date().toISOString(), "cached-replay");
  const runId = store.createRunId();
  const encoder = new TextEncoder();

  // Materialize every artifact into the new run so consumers can read it via
  // the artifact API under the new run id.
  const artifactsIndex: Record<string, { attempt: number; file: string }> = {};
  for (const [name, value] of Object.entries(bundle.artifacts)) {
    const attempt = bundle.manifest.artifacts[name]?.attempt ?? 1;
    const file = await store.writeArtifact(runId, name, attempt, value);
    artifactsIndex[name] = { attempt, file: path.join("artifacts", path.basename(file)).replace(/\\/g, "/") };
  }
  await store.writeManifest(runId, {
    runId,
    status: "completed",
    executionMode: "cached-replay",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: bundle.manifest.stages,
    artifacts: artifactsIndex,
    limitations: bundle.manifest.limitations,
    canReplay: true,
    modelUsage: bundle.manifest.modelUsage,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      publisher.onEvent((evt) => {
        try {
          controller.enqueue(encoder.encode(encodeNdjsonLine(evt)));
        } catch (err) {
          // client disconnected; the publisher continues writing to disk. Log it:
          // a stream that errors early while disk writes continue would otherwise
          // look like "backend fine, frontend silent".
          console.error("[runs] replay stream enqueue failed", evt.type, err);
        }
      });
      try {
        // Always lead with run.accepted so the UI can derive the run id even
        // if the source snapshot lacked it.
        await publisher.publish({ type: "run.accepted", runId, data: { runId } });

        const sourceEvents = bundle.events as RunEvent[];
        let sawTerminal = false;
        for (const evt of sourceEvents) {
          if (evt.type === "run.accepted") continue; // we emit our own
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
          if (evt.type === "artifact.available") {
            const artifactName = (evt.data as { artifact?: string } | undefined)?.artifact;
            const info = artifactName ? artifactsIndex[artifactName] : undefined;
            if (info) {
              await publisher.publish({ type: "artifact.available", runId, data: { artifact: artifactName, attempt: info.attempt, file: info.file } });
            }
            continue;
          }
          await publisher.publish({ type: evt.type, runId, stage: evt.stage, data: evt.data });
          if (evt.type === "run.completed" || evt.type === "run.failed") sawTerminal = true;
        }
        if (!sawTerminal) {
          await publisher.publish({ type: "run.completed", runId, data: { outcome: "replayed" } });
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

const NDJSON_HEADERS: HeadersInit = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store, no-cache, no-transform",
  "x-accel-buffering": "no",
};

async function startAnalysis(request: AnalyzeRequest, store: RunStore, cfg: ReturnType<typeof loadConfig>, req: Request): Promise<Response> {
  // Without a model, deterministic stages (collect/import, clean, stats) still
  // run and the run completes with a MODEL_NOT_CONFIGURED limitation.
  const modelConfigured = isModelConfigured(cfg);

  // Validate everything that can fail BEFORE the stream starts so request
  // errors are clean 4xx problem responses, not a started-then-failed run.
  let deps: ExecuteDeps;
  let executionMode: "live" | "import";
  const buildModel = () =>
    modelConfigured && cfg.modelBaseUrl && cfg.modelName
      ? new OpenAiCompatibleClient({
          baseUrl: cfg.modelBaseUrl,
          apiKey: cfg.modelApiKey ?? "",
          model: cfg.modelName,
          jsonMode: cfg.modelJsonMode,
          signal: req.signal,
          timeoutMs: cfg.modelTimeoutMs,
        })
      : // No model configured: executeRun short-circuits before any model call.
        ({ generate: async () => { throw new Error("model not configured"); } } as never);
  try {
    if (request.source.kind === "live") {
      const { parseUsAppStoreUrl } = await import("@/server/sources/app-store-url");
      const parsed = parseUsAppStoreUrl(request.source.appStoreUrl);
      executionMode = "live";
      deps = {
        model: buildModel(),
        source: { kind: "apple-rss" as const, appleRssBaseUrl: cfg.appleRssBaseUrl, appId: parsed.appId, canonicalUrl: parsed.canonicalUrl },
        sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        now: () => new Date().toISOString(),
        pageDelayMs: cfg.appleRssPageDelayMs,
        maxPages: cfg.appleRssMaxPages,
        timeoutMs: cfg.appleRssTimeoutMs,
      };
    } else {
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

  const runId = store.createRunId();
  const publisher = new EventPublisher(store, () => new Date().toISOString(), "live");
  const encoder = new TextEncoder();
  let settled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      publisher.onEvent((evt) => {
        try {
          controller.enqueue(encoder.encode(encodeNdjsonLine(evt)));
        } catch (err) {
          // client disconnected; pipeline aborts via cancel() below. Log it so
          // an early stream error is visible server-side instead of silent.
          console.error("[runs] stream enqueue failed", evt.type, err);
        }
      });
      void (async () => {
        try {
          await publisher.publish({ type: "run.accepted", runId, data: { runId } });
          await executeRun(runId, request.goal, request.outputLocale, deps, publisher, store, executionMode, modelConfigured);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            await publisher.publish({ type: "run.failed", runId, data: { error: message } });
          } catch {
            // publisher already failed
          }
          try {
            await store.writeManifest(runId, {
              runId,
              status: "failed",
              executionMode,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              stages: {},
              artifacts: {},
              limitations: [{ code: "PIPELINE_ERROR", message }],
              canReplay: false,
            });
          } catch {
            // manifest already written; leave the last known state
          }
        } finally {
          settled = true;
          try {
            controller.close();
          } catch {
            // already closed/cancelled
          }
        }
      })();
    },
    cancel() {
      // Client disconnected: abort the underlying work. The collector and the
      // model client observe req.signal, so aborting it stops upstream calls
      // and the pipeline short-circuits via AbortError.
      try {
        req.signal.dispatchEvent(new Event("abort"));
      } catch {
        // signal may not be abortable via dispatch; rely on req.signal being
        // already aborted by the runtime when the client disconnects.
      }
      if (settled) return;
      publisher.publish({ type: "run.failed", runId, data: { error: "client disconnected" } }).catch(() => {});
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
