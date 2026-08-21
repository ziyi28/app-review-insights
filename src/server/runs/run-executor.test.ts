import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import {
  executeAnalysisTask,
  executeReplayTask,
  registerActive,
  unregisterActive,
  isRunActive,
  resetActiveRuns,
  cancelActiveRun,
  claimRunFinalization,
} from "./run-executor";
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
      goal: "Keep replay metadata",
      appName: "Example App",
      appUrl: "https://apps.apple.com/us/app/example/id123456789",
      fileName: "reviews.csv",
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

  it("atomically lets cancellation or finalization claim a running run", () => {
    const cancelledRun = store.createRunId();
    const completedRun = store.createRunId();
    const cancelledController = new AbortController();
    const completedController = new AbortController();
    registerActive(cancelledRun, cancelledController);
    registerActive(completedRun, completedController);

    expect(cancelActiveRun(cancelledRun)).toBe(true);
    expect(claimRunFinalization(cancelledRun)).toBe(false);
    expect(cancelledController.signal.aborted).toBe(true);

    expect(claimRunFinalization(completedRun)).toBe(true);
    expect(cancelActiveRun(completedRun)).toBe(false);
    expect(completedController.signal.aborted).toBe(false);
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

  it("writes a failed terminal state when completion event publishing fails", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const task = importTask(runId);
    const publish = task.publisher.publish.bind(task.publisher);
    vi.spyOn(task.publisher, "publish").mockImplementation(async (input) => {
      if (input.type === "run.completed") throw new Error("terminal event write failed");
      await publish(input);
    });

    await executeAnalysisTask(task);

    expect(isRunActive(runId)).toBe(false);
    expect((await store.readManifest(runId)).status).toBe("failed");
  });

  it("retries the claimed completion manifest without publishing a conflicting failure", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const task = importTask(runId);
    const writeManifest = store.writeManifest.bind(store);
    let failedOnce = false;
    vi.spyOn(store, "writeManifest").mockImplementation(async (targetRunId, manifest) => {
      if (manifest.status === "completed" && !failedOnce) {
        failedOnce = true;
        throw new Error("transient manifest write failed");
      }
      await writeManifest(targetRunId, manifest);
    });

    await executeAnalysisTask(task);

    expect((await store.readManifest(runId)).status).toBe("completed");
    const events = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8"));
    expect(events).toContain('"type":"run.completed"');
    expect(events).not.toContain('"type":"run.failed"');
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

  it("writes a failed replay state when completion event publishing fails", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay");
    const publish = publisher.publish.bind(publisher);
    vi.spyOn(publisher, "publish").mockImplementation(async (input) => {
      if (input.type === "run.completed") throw new Error("terminal event write failed");
      await publish(input);
    });

    await executeReplayTask({ runId, store, bundle: replayBundle("src-run"), delayMs: 0, publisher });

    expect(isRunActive(runId)).toBe(false);
    expect((await store.readManifest(runId)).status).toBe("failed");
  });

  it("retries the claimed replay manifest without publishing a conflicting failure", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay");
    const writeManifest = store.writeManifest.bind(store);
    let failedOnce = false;
    vi.spyOn(store, "writeManifest").mockImplementation(async (targetRunId, manifest) => {
      if (manifest.status === "completed" && !failedOnce) {
        failedOnce = true;
        throw new Error("transient manifest write failed");
      }
      await writeManifest(targetRunId, manifest);
    });

    await executeReplayTask({ runId, store, bundle: replayBundle("src-run"), delayMs: 0, publisher });

    expect((await store.readManifest(runId)).status).toBe("completed");
    const events = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8"));
    expect(events).toContain('"type":"run.completed"');
    expect(events).not.toContain('"type":"run.failed"');
  });

  it("copies archived source files into the new run and rejects disallowed paths", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const bundle = replayBundle("src-run");
    bundle.sourceFiles = [
      { relativePath: "sources/apple/page-01.attempt-01.json", content: "{\"raw\":true}" },
      { relativePath: "sources/import/input.csv", content: "id,body\n" },
      // A manifest-named path outside the allowed trees must be rejected.
      { relativePath: "../outside.txt", content: "evil" },
    ];
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay");
    await executeReplayTask({ runId, store, bundle, delayMs: 0, publisher });

    expect(isRunActive(runId)).toBe(false);
    // The replay itself fails (bad path), so the manifest is failed, NOT the
    // two valid files surviving half-written.
    const manifest = await store.readManifest(runId).catch(() => null);
    expect(manifest?.status ?? "failed").toBe("failed");
    // Even so, no source file may escape the run directory.
    const outside = path.join(dir, "outside.txt");
    expect(await import("node:fs").then((fs) => fs.existsSync(outside))).toBe(false);
  });

  it("copies allowed archived source files when every path is valid", async () => {
    const runId = store.createRunId();
    registerActive(runId);
    const bundle = replayBundle("src-run");
    bundle.sourceFiles = [
      { relativePath: "sources/apple/page-01.attempt-01.json", content: "{\"raw\":true}" },
      { relativePath: "sources/import/input.csv", content: "id,body,rating,updatedAt\n" },
      { relativePath: "sources/cache/reviews.attempt-01.json", content: '{"schemaVersion":"1","reviews":[]}' },
    ];
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay");
    await executeReplayTask({ runId, store, bundle, delayMs: 0, publisher });

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("completed");
    const readF = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "sources", "apple", "page-01.attempt-01.json"), "utf8"));
    expect(readF).toBe("{\"raw\":true}");
    const readC = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "sources", "import", "input.csv"), "utf8"));
    expect(readC).toBe("id,body,rating,updatedAt\n");
    const readCache = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "sources", "cache", "reviews.attempt-01.json"), "utf8"));
    expect(readCache).toBe('{"schemaVersion":"1","reviews":[]}');
  });

  it("cancels an in-flight analysis task when cancelActiveRun is invoked", async () => {
    const runId = store.createRunId();
    const controller = new AbortController();
    registerActive(runId, controller);
    expect(isRunActive(runId)).toBe(true);

    // Cancel before or during execution
    cancelActiveRun(runId);
    expect(controller.signal.aborted).toBe(true);

    await executeAnalysisTask({
      ...importTask(runId),
      signal: controller.signal,
    });

    expect(isRunActive(runId)).toBe(false);
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("cancelled");
    expect(manifest.limitations.some((l) => l.code === "RUN_CANCELLED")).toBe(true);
    const events = await import("node:fs").then((fs) => fs.readFileSync(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8"));
    expect(events.split("\n").some((line) => line.includes('"type":"run.failed"') && line.includes('"cancelled":true'))).toBe(true);
  });

  it("cancels an in-flight replay task when cancelActiveRun is invoked", async () => {
    const runId = store.createRunId();
    const controller = new AbortController();
    registerActive(runId, controller);

    const bundle = replayBundle("src-run");
    const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay");

    cancelActiveRun(runId);

    await executeReplayTask({
      runId,
      store,
      bundle,
      delayMs: 10,
      publisher,
      signal: controller.signal,
    });

    expect(isRunActive(runId)).toBe(false);
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("cancelled");
    expect(manifest.limitations.some((l) => l.code === "RUN_CANCELLED")).toBe(true);
    expect(manifest).toMatchObject({
      goal: bundle.manifest.goal,
      appName: bundle.manifest.appName,
      appUrl: bundle.manifest.appUrl,
      fileName: bundle.manifest.fileName,
    });
  });

  it("keeps cancellation as the terminal outcome after an in-flight replay operation is released", async () => {
    const runId = store.createRunId();
    const controller = new AbortController();
    registerActive(runId, controller);
    const bundle = replayBundle("src-run");
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const writeArtifact = store.writeArtifact.bind(store);
    vi.spyOn(store, "writeArtifact").mockImplementation(async (...args) => {
      if (args[0] === runId) entered.resolve();
      await released.promise;
      return writeArtifact(...args);
    });

    const task = executeReplayTask({
      runId,
      store,
      bundle,
      delayMs: 0,
      publisher: new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay"),
      signal: controller.signal,
    });
    await entered.promise;
    expect(cancelActiveRun(runId)).toBe(true);
    released.resolve();
    await task;

    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("cancelled");
    expect(manifest.limitations.some((l) => l.code === "RUN_CANCELLED")).toBe(true);
  });

  it("cancels run A without aborting an in-flight run B", async () => {
    const runA = store.createRunId();
    const runB = store.createRunId();
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    registerActive(runA, controllerA);
    registerActive(runB, controllerB);
    const bundleA = replayBundle("src-a");
    const bundleB = replayBundle("src-b");
    const enteredA = Promise.withResolvers<void>();
    const enteredB = Promise.withResolvers<void>();
    const releaseA = Promise.withResolvers<void>();
    const releaseB = Promise.withResolvers<void>();
    const writeArtifact = store.writeArtifact.bind(store);
    vi.spyOn(store, "writeArtifact").mockImplementation(async (...args) => {
      const targetRunId = args[0];
      if (targetRunId === runA) {
        enteredA.resolve();
        await releaseA.promise;
      } else if (targetRunId === runB) {
        enteredB.resolve();
        await releaseB.promise;
      }
      return writeArtifact(...args);
    });

    const taskA = executeReplayTask({
      runId: runA,
      store,
      bundle: bundleA,
      delayMs: 0,
      publisher: new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay"),
      signal: controllerA.signal,
    });
    const taskB = executeReplayTask({
      runId: runB,
      store,
      bundle: bundleB,
      delayMs: 0,
      publisher: new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "cached-replay"),
      signal: controllerB.signal,
    });
    await Promise.all([enteredA.promise, enteredB.promise]);
    expect(cancelActiveRun(runA)).toBe(true);
    expect(controllerA.signal.aborted).toBe(true);
    expect(controllerB.signal.aborted).toBe(false);
    expect(isRunActive(runB)).toBe(true);
    releaseA.resolve();
    releaseB.resolve();
    await Promise.all([taskA, taskB]);

    expect((await store.readManifest(runA)).status).toBe("cancelled");
    expect((await store.readManifest(runB)).status).toBe("completed");
  });
});
