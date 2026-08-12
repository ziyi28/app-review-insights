import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunCatalog } from "./run-catalog";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "catalog-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedManifest(runId: string, overrides: Partial<Record<string, unknown>> = {}): void {
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
      stages: {},
      artifacts: {},
      limitations: [],
      canReplay: true,
      ...overrides,
    }),
  );
}

describe("RunCatalog", () => {
  it("lists runs across multiple roots and sorts by createdAt desc", async () => {
    seedManifest("run-a", { createdAt: "2026-08-01T00:00:00Z" });
    seedManifest("run-b", { createdAt: "2026-08-03T00:00:00Z" });
    const second = path.join(dir, "second");
    mkdirSync(second, { recursive: true });
    const runC = path.join(second, "run-c");
    mkdirSync(runC, { recursive: true });
    writeFileSync(path.join(runC, "manifest.json"), JSON.stringify({ runId: "run-c", status: "completed", executionMode: "live", createdAt: "2026-08-02T00:00:00Z", updatedAt: "", stages: {}, artifacts: {}, limitations: [], canReplay: true }));

    const entries = await new RunCatalog([dir, second]).list();
    expect(entries.map((e) => e.runId)).toEqual(["run-b", "run-c", "run-a"]);
  });

  it("skips a corrupt manifest and a missing root", async () => {
    seedManifest("run-ok");
    mkdirSync(path.join(dir, "run-bad"), { recursive: true });
    writeFileSync(path.join(dir, "run-bad", "manifest.json"), "{ not json");
    const missing = path.join(dir, "does-not-exist");
    const entries = await new RunCatalog([dir, missing]).list();
    expect(entries.map((e) => e.runId)).toEqual(["run-ok"]);
  });

  it("includes running/failed runs as catalog entries (they are listed, replay rejects them)", async () => {
    seedManifest("run-done");
    seedManifest("run-failed", { status: "failed", canReplay: false });
    const entries = await new RunCatalog([dir]).list();
    const ids = entries.map((e) => e.runId);
    expect(ids).toContain("run-done");
    expect(ids).toContain("run-failed");
  });
});
