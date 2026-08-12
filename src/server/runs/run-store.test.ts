import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "./run-store";

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "runstore-"));
  store = new RunStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RunStore", () => {
  it("creates a valid run id directory and writes artifacts", async () => {
    const runId = store.createRunId();
    expect(runId).toMatch(/^run-[0-9a-z-]+$/);
    const path_ = store.resolveRunDir(runId);
    expect(existsSync(path_)).toBe(false);

    await store.writeArtifact(runId, "findings", 1, { ok: true });
    const found = await store.readArtifact(runId, "findings", 1);
    expect(found).toEqual({ ok: true });
  });

  it("rejects path traversal in run id", async () => {
    expect(() => store.resolveRunDir("../evil")).toThrow(/run id/i);
  });

  it("rejects path traversal in artifact name", async () => {
    const runId = store.createRunId();
    await expect(store.writeArtifact(runId, "../../etc", 1, {})).rejects.toThrow(/artifact/i);
  });

  it("does not overwrite attempt 1 with attempt 2", async () => {
    const runId = store.createRunId();
    await store.writeArtifact(runId, "findings", 1, { attempt: 1 });
    await store.writeArtifact(runId, "findings", 2, { attempt: 2 });
    const a1 = await store.readArtifact(runId, "findings", 1);
    const a2 = await store.readArtifact(runId, "findings", 2);
    expect(a1).toEqual({ attempt: 1 });
    expect(a2).toEqual({ attempt: 2 });
  });

  it("appends events and maintains sequence", async () => {
    const runId = store.createRunId();
    await store.appendEvent(runId, JSON.stringify({ sequence: 1, payload: "a" }));
    await store.appendEvent(runId, JSON.stringify({ sequence: 2, payload: "b" }));
    const events = readFileSync(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("returns an empty list when the store root does not exist", async () => {
    const missing = new RunStore(path.join(dir, "does-not-exist"));
    expect(await missing.listRuns()).toEqual([]);
  });

  it("writes and reads a manifest with updatedAt", async () => {
    const runId = store.createRunId();
    await store.writeManifest(runId, {
      runId,
      status: "running",
      executionMode: "live",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "",
      stages: {},
      artifacts: {},
      limitations: [],
      canReplay: false,
    });
    const manifest = await store.readManifest(runId);
    expect(manifest.status).toBe("running");
    expect(manifest.updatedAt).toBeTruthy();
  });
});
