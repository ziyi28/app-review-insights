import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DELETE } from "./route";
import { RunStore } from "@/server/runs/run-store";

let baseDir: string;
const saved = { ...process.env };

function del(runId: string): Promise<Response> {
  return DELETE(new Request(`http://localhost/api/runs/${runId}`, { method: "DELETE" }), {
    params: Promise.resolve({ runId }),
  });
}

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "runs-runid-route-"));
  process.env = { ...saved };
  process.env.RUNS_DIR = path.join(baseDir, "runs");
});

afterEach(() => {
  process.env = saved;
  rmSync(baseDir, { recursive: true, force: true });
});

describe("DELETE /api/runs/[runId]", () => {
  it("deletes an existing run and returns 204", async () => {
    const store = new RunStore(process.env.RUNS_DIR!);
    const runId = store.createRunId();
    await store.writeManifest(runId, {
      runId,
      status: "completed",
      executionMode: "live",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "",
      stages: {},
      artifacts: {},
      limitations: [],
      canReplay: true,
    });
    expect(existsSync(store.resolveRunDir(runId))).toBe(true);

    const res = await del(runId);
    expect(res.status).toBe(204);
    expect(existsSync(store.resolveRunDir(runId))).toBe(false);
  });

  it("returns 404 for a run that does not exist", async () => {
    const res = await del("run-does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a path-traversal id without deleting anything", async () => {
    const res = await del("../evil");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a bundled fixture id (fixtures are not deletable)", async () => {
    const res = await del("run-x-twitter-us");
    expect(res.status).toBe(404);
  });
});
