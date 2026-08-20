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

  it("keeps evidence-validation attempt 1 and attempt 2 separate", async () => {
    const runId = store.createRunId();
    await store.writeArtifact(runId, "evidence-validation", 1, { attempt: 1 });
    await store.writeArtifact(runId, "evidence-validation", 2, { attempt: 2 });
    const a1 = await store.readArtifact(runId, "evidence-validation", 1);
    const a2 = await store.readArtifact(runId, "evidence-validation", 2);
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

  it("deletes a run directory", async () => {
    const runId = store.createRunId();
    await store.writeArtifact(runId, "findings", 1, { ok: true });
    expect(existsSync(store.resolveRunDir(runId))).toBe(true);

    await store.deleteRun(runId);
    expect(existsSync(store.resolveRunDir(runId))).toBe(false);
  });

  it("deleteRun is a no-op for a missing directory", async () => {
    const runId = store.createRunId();
    await expect(store.deleteRun(runId)).resolves.toBeUndefined();
  });

  it("deleteRun rejects a path-traversal id", async () => {
    await expect(store.deleteRun("../evil")).rejects.toThrow(/run id/i);
  });

  it("writes a source file atomically under an allowed sources path", async () => {
    const runId = store.createRunId();
    await store.writeSourceFile(runId, "sources/apple/page-01.attempt-01.json", "{\"ok\":true}");
    const content = await store.readSourceFile(runId, "sources/apple/page-01.attempt-01.json");
    expect(content).toBe("{\"ok\":true}");
  });

  it("writes a cache source file atomically under sources/cache", async () => {
    const runId = store.createRunId();
    await store.writeSourceFile(runId, "sources/cache/reviews.attempt-01.json", "{\"schemaVersion\":\"1\"}");
    const content = await store.readSourceFile(runId, "sources/cache/reviews.attempt-01.json");
    expect(content).toBe("{\"schemaVersion\":\"1\"}");
  });

  it("rejects a source path escaping the run directory", async () => {
    const runId = store.createRunId();
    await expect(store.writeSourceFile(runId, "../outside.txt", "x")).rejects.toThrow(/escapes|not allowed/i);
    await expect(store.writeSourceFile(runId, "sources/apple/../../outside.txt", "x")).rejects.toThrow(/escapes|not allowed/i);
    await expect(store.writeSourceFile(runId, "sources/cache/../../outside.txt", "x")).rejects.toThrow(/escapes|not allowed/i);
    await expect(store.writeSourceFile(runId, "C:/evil.txt", "x")).rejects.toThrow(/escapes|not allowed/i);
  });

  it("rejects an absolute source path", async () => {
    const runId = store.createRunId();
    await expect(store.writeSourceFile(runId, path.join(dir, "evil.txt"), "x")).rejects.toThrow(/escapes|not allowed/i);
  });

  it("rejects a source path outside the allowed sources trees", async () => {
    const runId = store.createRunId();
    await expect(store.writeSourceFile(runId, "sources/other/file.json", "x")).rejects.toThrow(/not allowed/i);
    await expect(store.writeSourceFile(runId, "artifacts/x.json", "x")).rejects.toThrow(/not allowed/i);
  });

  it("never silently overwrites an existing source file", async () => {
    const runId = store.createRunId();
    await store.writeSourceFile(runId, "sources/apple/page-01.attempt-01.json", "first");
    await expect(store.writeSourceFile(runId, "sources/apple/page-01.attempt-01.json", "second")).rejects.toThrow(/already exists/i);
    expect(await store.readSourceFile(runId, "sources/apple/page-01.attempt-01.json")).toBe("first");

    await store.writeSourceFile(runId, "sources/cache/reviews.attempt-01.json", "first-cache");
    await expect(store.writeSourceFile(runId, "sources/cache/reviews.attempt-01.json", "second-cache")).rejects.toThrow(/already exists/i);
    expect(await store.readSourceFile(runId, "sources/cache/reviews.attempt-01.json")).toBe("first-cache");
  });
});
