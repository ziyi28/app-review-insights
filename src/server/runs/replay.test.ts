import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "./run-store";
import { RunCatalog } from "./run-catalog";
import { loadReplayRun } from "./replay";

let dir: string;
let store: RunStore;
let catalog: RunCatalog;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "replay-"));
  store = new RunStore(dir);
  catalog = new RunCatalog([dir]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedRun(runId: string): Promise<void> {
  const runDir = path.join(dir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify({
      runId,
      status: "completed",
      executionMode: "live",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "2026-08-12T00:00:01Z",
      stages: { source: { status: "completed" } },
      artifacts: { findings: { attempt: 1, file: "artifacts/findings.attempt-01.json" } },
      limitations: [],
      canReplay: true,
    }),
  );
  mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
  writeFileSync(path.join(runDir, "artifacts", "findings.attempt-01.json"), JSON.stringify({ ok: true }));
  writeFileSync(
    path.join(runDir, "events.ndjson"),
    '{"protocolVersion":"1","sequence":1,"eventId":"e1","runId":"' + runId + '","timestamp":"2026-08-12T00:00:00Z","deliveryMode":"live","type":"run.accepted","data":{}}\n',
  );
}

describe("RunCatalog", () => {
  it("lists replayable runs from the runtime store", async () => {
    await seedRun(store.createRunId());
    const runs = await catalog.list();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]).toHaveProperty("manifest");
  });

  it("rejects a run with a malformed manifest", async () => {
    const runId = store.createRunId();
    const runDir = path.join(dir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "manifest.json"), "{ not json");
    const runs = await catalog.list();
    expect(runs).toHaveLength(0);
  });
});

describe("loadReplayRun", () => {
  it("loads a complete cached run and rejects corrupt artifacts", async () => {
    const runId = store.createRunId();
    await seedRun(runId);
    const loaded = await loadReplayRun([dir], runId);
    expect(loaded.manifest.status).toBe("completed");
    expect(loaded.events).toHaveLength(1);
    expect(loaded.artifacts.findings).toEqual({ ok: true });
  });

  it("refuses to replay a run whose artifact is corrupt", async () => {
    const runId = store.createRunId();
    await seedRun(runId);
    const runDir = path.join(dir, runId);
    writeFileSync(path.join(runDir, "artifacts", "findings.attempt-01.json"), "{ nope");
    await expect(loadReplayRun([dir], runId)).rejects.toThrow();
  });

  it("ignores a manifest file path that escapes the run directory", async () => {
    // A malicious manifest pointing findings at ../run-victim/secret.json must
    // NOT be followed: replay reads through RunStore.readArtifact which only
    // resolves inside the run directory. The escape path is discarded and the
    // in-run artifact is read instead.
    const runId = store.createRunId();
    await seedRun(runId);
    mkdirSync(path.join(dir, "run-victim"), { recursive: true });
    writeFileSync(path.join(dir, "run-victim", "secret.json"), JSON.stringify({ secret: true }));
    const runDir = path.join(dir, runId);
    writeFileSync(
      path.join(runDir, "manifest.json"),
      JSON.stringify({
        runId,
        status: "completed",
        executionMode: "live",
        createdAt: "2026-08-12T00:00:00Z",
        updatedAt: "2026-08-12T00:00:01Z",
        stages: {},
        artifacts: { findings: { attempt: 1, file: "../run-victim/secret.json" } },
        limitations: [],
        canReplay: true,
      }),
    );
    const loaded = await loadReplayRun([dir], runId);
    // The escape path must not leak the victim file; the in-run artifact wins.
    expect(loaded.artifacts.findings).toEqual({ ok: true });
  });

  it("refuses to replay a run marked canReplay=false", async () => {
    const runId = store.createRunId();
    await seedRun(runId);
    const runDir = path.join(dir, runId);
    const manifest = JSON.parse(readFileSync(path.join(runDir, "manifest.json"), "utf8")) as { canReplay: boolean };
    manifest.canReplay = false;
    writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest));
    await expect(loadReplayRun([dir], runId)).rejects.toThrow(/canReplay/i);
  });
});
