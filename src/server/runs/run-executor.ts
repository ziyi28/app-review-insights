import type { RunEvent } from "@/domain/contracts/events";
import type { AnalyzeRequest } from "@/domain/contracts/run";
import type { RunStore } from "./run-store";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { executeRun, type ExecuteDeps, type RunMetadata } from "@/server/pipeline/orchestrator";
import { loadReplayRun, type ReplayBundle } from "./replay";

/**
 * In-process registry of the runs currently being executed. A run is registered
 * before the 202 response is returned and unregistered when its background task
 * settles (success, failure, or error). The registry is what distinguishes a
 * genuinely running task from a persisted `running` manifest left behind by a
 * process restart: the former is active, the latter is `interrupted`.
 *
 * It is intentionally process-local: the project is a single-process local app,
 * and no cross-process task store is introduced.
 */
type ActiveRunPhase = "running" | "cancelling" | "finalizing";
type ActiveRun = { controller: AbortController; phase: ActiveRunPhase };

const activeRuns = new Map<string, ActiveRun>();

export function registerActive(runId: string, controller = new AbortController()): void {
  activeRuns.set(runId, { controller, phase: controller.signal.aborted ? "cancelling" : "running" });
}

export function unregisterActive(runId: string): void {
  activeRuns.delete(runId);
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export function cancelActiveRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active || active.phase !== "running") return false;
  if (active.controller.signal.aborted) {
    active.phase = "cancelling";
    return false;
  }
  active.phase = "cancelling";
  active.controller.abort();
  return true;
}

/** Claims the only terminal completion/failure slot for a still-running task. */
export function claimRunFinalization(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active || active.phase !== "running") return false;
  if (active.controller.signal.aborted) {
    active.phase = "cancelling";
    return false;
  }
  active.phase = "finalizing";
  return true;
}

export function activeRunIdsSnapshot(): string[] {
  return [...activeRuns.keys()];
}

/** Clears the registry (test-only: isolates assertions across test files). */
export function resetActiveRuns(): void {
  for (const { controller } of activeRuns.values()) {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }
  activeRuns.clear();
}

function activeRunSignal(runId: string): AbortSignal | undefined {
  return activeRuns.get(runId)?.controller.signal;
}

export type AnalysisTaskInput = {
  runId: string;
  request: AnalyzeRequest;
  deps: ExecuteDeps;
  store: RunStore;
  executionMode: "live" | "import";
  modelConfigured: boolean;
  metadata: RunMetadata;
  publisher: EventPublisher;
  signal?: AbortSignal;
};

export type ReplayTaskInput = {
  runId: string;
  store: RunStore;
  bundle: ReplayBundle;
  delayMs: number;
  publisher: EventPublisher;
  signal?: AbortSignal;
};

/**
 * Executes a live/import analysis in the background. `executeRun` owns the
 * normal failure surface (it writes the terminal event and manifest for every
 * pipeline outcome), so this wrapper only guarantees two things beyond it:
 * the registry is always cleared when the task settles, and a fatal error
 * escaping `executeRun` (which should not happen) still produces a terminal
 * event + terminal manifest rather than a silent hang.
 */
export async function executeAnalysisTask(input: AnalysisTaskInput): Promise<void> {
  const { runId, request, deps, store, executionMode, modelConfigured, metadata, publisher } = input;
  const signal = input.signal ?? activeRunSignal(runId);
  try {
    await executeRun(
      runId,
      request.goal,
      request.outputLocale,
      deps,
      publisher,
      store,
      executionMode,
      modelConfigured,
      metadata,
      signal,
      () => claimRunFinalization(runId),
    );
  } catch (err) {
    const isCancelled = signal?.aborted || (err instanceof Error && err.message === "RUN_CANCELLED");
    const message = isCancelled ? "Analysis was cancelled by user" : (err instanceof Error ? err.message : String(err));
    if (isCancelled || claimRunFinalization(runId)) {
      try {
        await publisher.publish({ type: "run.failed", runId, data: { error: message, cancelled: isCancelled } });
      } catch {
        // publisher already failed
      }
      try {
        await store.writeManifest(runId, {
          runId,
          status: isCancelled ? "cancelled" : "failed",
          executionMode,
          goal: request.goal,
          appName: metadata?.appName,
          appUrl: metadata?.appUrl,
          fileName: metadata?.fileName,
          startRequest: request,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stages: {},
          artifacts: {},
          limitations: [{ code: isCancelled ? "RUN_CANCELLED" : "PIPELINE_ERROR", message, params: { detail: message } }],
          canReplay: false,
        });
      } catch {
        // manifest already written; leave the last known state
      }
    }
  } finally {
    unregisterActive(runId);
  }
}

/**
 * Replays a cached run into a fresh, fully materialized run — as a background
 * task. Unlike the legacy one-shot replay, the manifest stays `running` while
 * the source events are replayed in order: an artifact is copied into the new
 * run directory and an `artifact.available` event is published only when the
 * source event stream reaches it, so consumers never see an artifact before its
 * stage has been replayed. Compatible artifacts the source events never
 * referenced are materialized just before the terminal event, and the
 * `completed` manifest is written only after every event has been replayed.
 */
export async function executeReplayTask(input: ReplayTaskInput): Promise<void> {
  const { runId, store, bundle, delayMs, publisher } = input;
  const signal = input.signal ?? activeRunSignal(runId);
  const artifactsIndex: Record<string, { attempt: number; file: string }> = {};
  let finalizationClaimed = false;
  let terminalEventPublished = false;
  const writeCompletedManifest = () => store.writeManifest(runId, {
    runId,
    status: "completed" as const,
    executionMode: "cached-replay" as const,
    goal: bundle.manifest.goal,
    appName: bundle.manifest.appName,
    appUrl: bundle.manifest.appUrl,
    fileName: bundle.manifest.fileName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: bundle.manifest.stages,
    artifacts: artifactsIndex,
    limitations: bundle.manifest.limitations,
    canReplay: true,
    modelUsage: bundle.manifest.modelUsage,
  });
  try {
    // run.accepted is published by the caller before this task is scheduled; the
    // same publisher is reused so the sequence stays strictly monotonic across
    // the whole run rather than restarting at 1 (which would duplicate keys).
    const sourceEvents = bundle.events as RunEvent[];
    const referenced = new Set<string>();
    let terminalEvent: RunEvent | null = null;

    // Replay source events in order. Terminal events are deferred so that any
    // un-referenced-but-compatible artifacts can be backfilled ahead of them.
    for (const evt of sourceEvents) {
      if (signal?.aborted) {
        throw new Error("RUN_CANCELLED");
      }
      if (evt.type === "run.accepted") continue; // we emit our own
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (signal?.aborted) {
        throw new Error("RUN_CANCELLED");
      }
      if (evt.type === "run.completed" || evt.type === "run.failed") {
        terminalEvent = evt;
        break;
      }
      if (evt.type === "artifact.available") {
        const artifactName = (evt.data as { artifact?: string } | undefined)?.artifact;
        const value = artifactName ? bundle.artifacts[artifactName] : undefined;
        if (artifactName && value !== undefined) {
          const attempt = bundle.manifest.artifacts[artifactName]?.attempt ?? 1;
          const file = await store.writeArtifact(runId, artifactName, attempt, value);
          const relativeFile = `artifacts/${file.split(/[\\/]/).at(-1)}`;
          artifactsIndex[artifactName] = { attempt, file: relativeFile };
          referenced.add(artifactName);
          await publisher.publish({ type: "artifact.available", runId, data: { artifact: artifactName, attempt, file: relativeFile } });
        }
        continue;
      }
      await publisher.publish({ type: evt.type, runId, stage: evt.stage, data: evt.data });
    }

    if (signal?.aborted) {
      throw new Error("RUN_CANCELLED");
    }

    // Backfill compatible artifacts the source events never referenced (legacy
    // snapshots whose manifest indexed artifacts without an event).
    for (const [name, value] of Object.entries(bundle.artifacts)) {
      if (signal?.aborted) {
        throw new Error("RUN_CANCELLED");
      }
      if (referenced.has(name)) continue;
      const attempt = bundle.manifest.artifacts[name]?.attempt ?? 1;
      const file = await store.writeArtifact(runId, name, attempt, value);
      const relativeFile = `artifacts/${file.split(/[\\/]/).at(-1)}`;
      artifactsIndex[name] = { attempt, file: relativeFile };
      await publisher.publish({ type: "artifact.available", runId, data: { artifact: name, attempt, file: relativeFile } });
    }

    // Re-materialize the source run's archived raw files. writeSourceFile only
    // accepts safe sources/apple|import|cache paths and rejects overwrites, so a
    // malicious bundle can never plant or clobber files outside those trees.
    for (const file of bundle.sourceFiles ?? []) {
      if (signal?.aborted) {
        throw new Error("RUN_CANCELLED");
      }
      await store.writeSourceFile(runId, file.relativePath, file.content);
    }

    // Emit the terminal event (or a synthetic completion when the source lacked
    // one), then finalize the manifest as completed + replayable.
    if (signal?.aborted || !claimRunFinalization(runId)) {
      throw new Error("RUN_CANCELLED");
    }
    finalizationClaimed = true;
    if (terminalEvent) {
      await publisher.publish({ type: terminalEvent.type, runId, stage: terminalEvent.stage, data: terminalEvent.data });
    } else {
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "replayed" } });
    }
    terminalEventPublished = true;

    await writeCompletedManifest();
  } catch (err) {
    if (finalizationClaimed && terminalEventPublished) {
      await writeCompletedManifest();
      return;
    }

    const isCancelled = !finalizationClaimed
      && (signal?.aborted || (err instanceof Error && err.message === "RUN_CANCELLED"));
    const message = isCancelled ? "Replay was cancelled by user" : (err instanceof Error ? err.message : String(err));
    if (isCancelled || finalizationClaimed || claimRunFinalization(runId)) {
      try {
        await publisher.publish({ type: "run.failed", runId, data: { error: message, cancelled: isCancelled } });
      } catch {
        // publisher already failed
      }
      try {
        await store.writeManifest(runId, {
          runId,
          status: isCancelled ? "cancelled" : "failed",
          executionMode: "cached-replay",
          goal: bundle.manifest.goal,
          appName: bundle.manifest.appName,
          appUrl: bundle.manifest.appUrl,
          fileName: bundle.manifest.fileName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stages: {},
          artifacts: artifactsIndex,
          limitations: [{ code: isCancelled ? "RUN_CANCELLED" : "REPLAY_ERROR", message }],
          canReplay: false,
        });
      } catch {
        // manifest already written; leave the last known state
      }
    }
  } finally {
    unregisterActive(runId);
  }
}

export { loadReplayRun };
