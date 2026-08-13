import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { GET } from "./route";

let baseDir: string;
let store: RunStore;
let runId: string;
const saved = { ...process.env };

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "artifact-route-"));
  process.env = { ...saved };
  process.env.RUNS_DIR = path.join(baseDir, "runs");
  store = new RunStore(process.env.RUNS_DIR);
  runId = store.createRunId();
});

afterEach(() => {
  process.env = saved;
  rmSync(baseDir, { recursive: true, force: true });
});

async function writePrdAttempts() {
  await store.writeArtifact(runId, "prd", 1, { phase: "draft" });
  await store.writeArtifact(runId, "prd", 2, { phase: "final" });
  await store.writeManifest(runId, {
    runId,
    status: "completed",
    executionMode: "live",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: {},
    artifacts: { prd: { attempt: 2, file: "artifacts/prd.attempt-02.json" } },
    limitations: [],
    canReplay: true,
  });
}

describe("GET /api/runs/:runId/artifacts/:artifactName", () => {
  it("serves a specific attempt via ?attempt", async () => {
    await writePrdAttempts();
    const context = {
      params: Promise.resolve({ runId, artifactName: "prd" }),
    };
    const get = (attempt: string) => GET(
      new Request(`http://localhost/api/runs/${runId}/artifacts/prd?attempt=${attempt}`),
      context,
    );
    const draft = await get("1");
    const final = await get("2");
    expect(await draft.json()).toEqual({ phase: "draft" });
    expect(await final.json()).toEqual({ phase: "final" });
    expect((await get("0")).status).toBe(422);
    expect((await get("3")).status).toBe(404);
  });

  it("defaults to the manifest latest attempt", async () => {
    await writePrdAttempts();
    const res = await GET(
      new Request(`http://localhost/api/runs/${runId}/artifacts/prd`),
      { params: Promise.resolve({ runId, artifactName: "prd" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phase: "final" });
  });

  it("returns 404 for an unknown artifact", async () => {
    const res = await GET(
      new Request(`http://localhost/api/runs/${runId}/artifacts/nope`),
      { params: Promise.resolve({ runId, artifactName: "nope" }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects a non-integer attempt with 422", async () => {
    await writePrdAttempts();
    const res = await GET(
      new Request(`http://localhost/api/runs/${runId}/artifacts/prd?attempt=abc`),
      { params: Promise.resolve({ runId, artifactName: "prd" }) },
    );
    expect(res.status).toBe(422);
  });

  it("responds with cache-control: no-store", async () => {
    await writePrdAttempts();
    const res = await GET(
      new Request(`http://localhost/api/runs/${runId}/artifacts/prd?attempt=1`),
      { params: Promise.resolve({ runId, artifactName: "prd" }) },
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
