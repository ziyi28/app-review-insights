import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, DELETE } from "./route";
import { RunStore } from "@/server/runs/run-store";
import { registerActive, resetActiveRuns } from "@/server/runs/run-executor";

let baseDir: string;
const saved = { ...process.env };

function del(runId: string): Promise<Response> {
  return DELETE(new Request(`http://localhost/api/runs/${runId}`, { method: "DELETE" }), {
    params: Promise.resolve({ runId }),
  });
}

function get(runId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/runs/${runId}`, { method: "GET" }), {
    params: Promise.resolve({ runId }),
  });
}

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "runs-runid-route-"));
  process.env = { ...saved };
  process.env.RUNS_DIR = path.join(baseDir, "runs");
  resetActiveRuns();
});

afterEach(() => {
  process.env = saved;
  resetActiveRuns();
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

  it("returns 409 for a genuinely running task", async () => {
    const store = new RunStore(process.env.RUNS_DIR!);
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
    registerActive(runId);

    const res = await del(runId);
    expect(res.status).toBe(409);
    // The directory must survive (nothing deleted while the task is active).
    expect(existsSync(store.resolveRunDir(runId))).toBe(true);
  });

  it("allows deleting an interrupted (stale running) run", async () => {
    const store = new RunStore(process.env.RUNS_DIR!);
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
    // No active registration -> interrupted, deletable.
    const res = await del(runId);
    expect(res.status).toBe(204);
    expect(existsSync(store.resolveRunDir(runId))).toBe(false);
  });
});

describe("GET /api/runs/[runId] (bundled fixture viewing)", () => {
  it("returns 200 for a bundled fixture run id", async () => {
    const res = await get("run-x-twitter-us");
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as { runId: string; status: string; goal?: string };
    expect(manifest.runId).toBe("run-x-twitter-us");
    expect(manifest.status).toBe("completed");
  });

  it("returns 200 for the workout fixture", async () => {
    const res = await get("run-workout-for-women-us");
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as { runId: string };
    expect(manifest.runId).toBe("run-workout-for-women-us");
  });

  it("returns 404 for a run id in neither root", async () => {
    const res = await get("run-never-existed");
    expect(res.status).toBe(404);
  });

  it("prefers a runtime run when a fixture shares the same id", async () => {
    // A runtime run with the same id as a fixture must win.
    const store = new RunStore(process.env.RUNS_DIR!);
    await store.writeManifest("run-x-twitter-us", {
      runId: "run-x-twitter-us",
      status: "completed",
      executionMode: "live",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "",
      goal: "RUNTIME WINS",
      stages: {},
      artifacts: {},
      limitations: [],
      canReplay: true,
    });
    const res = await get("run-x-twitter-us");
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as { goal: string };
    expect(manifest.goal).toBe("RUNTIME WINS");
  });

  it("keeps fixture runs read-only: GET works, DELETE still 404", async () => {
    const getRes = await get("run-x-twitter-us");
    expect(getRes.status).toBe(200);
    // The same fixture id must never be deletable even though GET now finds it.
    const delRes = await del("run-x-twitter-us");
    expect(delRes.status).toBe(404);
    // The fixture directory is untouched.
    const fixtureDir = path.join(process.cwd(), "fixtures", "demo-runs", "run-x-twitter-us");
    expect(existsSync(fixtureDir)).toBe(true);
  });
});
