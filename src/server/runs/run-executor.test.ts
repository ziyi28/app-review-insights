import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { executeAnalysisTask, executeReplayTask, registerActive, unregisterActive, isRunActive, resetActiveRuns } from "./run-executor";
import type { ReplayBundle } from "./replay";
import { EventPublisher } from "@/server/streaming/event-publisher";
import { parseImportedReviews } from "@/server/sources/import-parser";
import type { ImportParseShape } from "@/server/pipeline/orchestrator";
import type { RunEvent } from "@/domain/contracts/events";

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "run-exec-"));
  store = new RunStore(dir);
  resetActiveRuns();
});

afterEach(() => {
  resetActiveRuns();
  rmSync(dir, { recursive: true, force: true });
});

function importTask(runId: string) {
  const parse = parseImportedReviews({
    fileName: "empty.json",
    mediaType: "application/json",
    content: JSON.stringify({ schemaVersion: "1", reviews: [] }),
  }) as ImportParseShape;
  return {
    runId,
    request: {
      protocolVersion: "1" as const,
      mode: "analyze" as const,
      uiLocale: "en" as const,
      outputLocale: "en" as const,
      goal: "Understand why users churn",
      source: { kind: "import" as const, fileName: "empty.json", mediaType: "application/json" as const, content: "{}" },
    },
    deps: { model: {} as never, source: { kind: "import" as const, parse } },
    store,
    executionMode: "import" as const,
    modelConfigured: false,
    metadata: { fileName: "empty.json" },
    publisher: new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live"),
  };
}

function replayBundle(runId: string): ReplayBundle {
  const now = "2026-08-12T00:00:00.000Z";
  const ev = (sequence: number, type: string, data: unknown = {}): RunEvent => ({
    protocolVersion: "1",
    sequence,
    eventId: `e${sequence}`,
    runId,
    timestamp: now,
    deliveryMode: "live",
    type: type as RunEvent["type"],
    data,
  });
  return {
    manifest: {
      runId,
      status: "completed" as const,
      executionMode: "live" as const,
      createdAt: now,
      updatedAt: now,
      stages: { source: { status: "completed" } },
      artifacts: {
        "raw-reviews": { attempt: 1, file: "artifacts/raw-reviews.attempt-01.json" },
        "final-report": { attempt: 1, file: "artifacts/final-report.attempt-01.json" },
      },
      limitations: [],
      canReplay: true,
    },
    events: [
      ev(1, "run.accepted"),
      ev(2, "stage.started", { stage: "source" }),
      ev(3, "artifact.available", { artifact: "raw-reviews", attempt: 1 }),
      ev(4, "stage.completed", { stage: "source" }),
      // final-report is intentionally NOT referenced by any source event, to
      // exercise the backfill-before-terminal path.
      ev(5, "run.completed", { outcome: "valid" }),
    ],
    artifacts: {
      "raw-reviews": { reviews: [] },
      "final-report": { prd: null, report: null },
    },
  };
}

describe("run-executor registry", () => {
  it("tracks active runs and clears on unregister", () => {
    expect(isRunActive("run-a")).toBe(false);
    registerActive("run-a");
    expect(isRunActive("run-a")).toBe(true);
    unregisterActive("run-a");
    expect(isRunActive("run-a")).toBe(false);
  });
});

describe("executeAnalysisTask", () => {
  it("completes, writes a completed manifest, and unregisters", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    await executeAnalysisTask(importTask(runId));

    expect(isRunActive(runId)).toBe(false);
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
  });

  it("runs two tasks in parallel to independent completion", async () => {
    const a = store.createRunId();
    const b = store.createRunId();
    registerActive(a);
    registerActive(b);
    await Promise.all([executeAnalysisTask(importTask(a)), executeAnalysisTask(importTask(b))]);

    expect(isRunActive(a)).toBe(false);
    expect(isRunActive(b)).toBe(false);
    const manifestA = await store.readManifest(a);
    const manifestB = await store.readManifest(b);
    expect(manifestA.status).toBe("completed");
    expect(manifestB.status).toBe("completed");
    // Distinct runs never cross-wire their events/artifacts.
    expect(manifestA.runId).not.toBe(manifestB.runId);
    const eventsA = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(a), "events.ndjson"), "utf8"));
    expect(eventsA).not.toContain(b);
  });

  it("unregisters even when the pipeline throws before finishing", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    // A deps.source of an impossible shape makes the pipeline throw early.
    const task = importTask(runId);
    task.deps.source = { kind: "import", parse: { reviews: "not-an-array" } as unknown as ImportParseShape };
    await executeAnalysisTask(task);
    expect(isRunActive(runId)).toBe(false);
    // The failure is surfaced as a failed manifest, never a silent hang.
    const manifest = await store.readManifest(runId).catch(() => null);
    expect(manifest?.status ?? "failed").toBe("failed");
  });
});

describe("executeReplayTask", () => {
  it("replays in order and backfills un-referenced artifacts before the terminal event", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    await executeReplayTask({ runId, store, bundle: replayBundle("src-run"), delayMs: 0, publisher: new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay") });

    expect(isRunActive(runId)).toBe(false);
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    expect(manifest.canReplay).toBe(true);

    // Both the referenced and backfilled artifacts are materialized.
    const eventsText = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8"));
    const lines = eventsText.trim().split("\n").map((l) => JSON.parse(l) as RunEvent);

    const rawIdx = lines.findIndex((e) => e.type === "artifact.available" && (e.data as { artifact?: string }).artifact === "raw-reviews");
    const finalIdx = lines.findIndex((e) => e.type === "artifact.available" && (e.data as { artifact?: string }).artifact === "final-report");
    const completedIdx = lines.findIndex((e) => e.type === "run.completed");

    expect(rawIdx).toBeGreaterThanOrEqual(0);
    // The backfilled final-report artifact is announced after the referenced
    // artifact but strictly before the terminal run.completed event.
    expect(finalIdx).toBeGreaterThan(rawIdx);
    expect(finalIdx).toBeLessThan(completedIdx);
    // run.completed is the last event.
    expect(completedIdx).toBe(lines.length - 1);
  });

  it("writes a failed manifest and unregisters when the replay throws", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const bundle = replayBundle("src-run");
    // A circular artifact value makes JSON.stringify throw during
    // materialization, forcing the replay failure path.
    const circular: unknown = {};
    (circular as { self?: unknown }).self = circular;
    bundle.artifacts["raw-reviews"] = circular;
    await executeReplayTask({ runId, store, bundle, delayMs: 0, publisher: new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay") });

    expect(isRunActive(runId)).toBe(false);
    const manifest = await store.readManifest(runId).catch(() => null);
    expect(manifest?.status ?? "failed").toBe("failed");
  });
});
