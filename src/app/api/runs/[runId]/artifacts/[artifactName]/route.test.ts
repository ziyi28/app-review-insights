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

describe("GET artifact (bundled fixture viewing)", () => {
  it("serves a fixture's raw-reviews artifact", async () => {
    const res = await GET(
      new Request("http://localhost/api/runs/run-x-twitter-us/artifacts/raw-reviews"),
      { params: Promise.resolve({ runId: "run-x-twitter-us", artifactName: "raw-reviews" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: unknown[]; rawRefs?: string[] };
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(body.reviews.length).toBeGreaterThan(0);
  });

  it("serves a fixture's prd and final-report", async () => {
    for (const name of ["prd", "final-report"]) {
      const res = await GET(
        new Request(`http://localhost/api/runs/run-x-twitter-us/artifacts/${name}`),
        { params: Promise.resolve({ runId: "run-x-twitter-us", artifactName: name }) },
      );
      expect(res.status).toBe(200);
    }
  });

  it("honors the fixture manifest's declared attempt", async () => {
    const manifest = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(path.join(process.cwd(), "fixtures", "demo-runs", "run-x-twitter-us", "manifest.json"), "utf8"))) as { artifacts: Record<string, { attempt: number }> };
    const prdAttempt = manifest.artifacts.prd.attempt;
    const res = await GET(
      new Request(`http://localhost/api/runs/run-x-twitter-us/artifacts/prd?attempt=${prdAttempt}`),
      { params: Promise.resolve({ runId: "run-x-twitter-us", artifactName: "prd" }) },
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for a fixture artifact that does not exist", async () => {
    const res = await GET(
      new Request("http://localhost/api/runs/run-x-twitter-us/artifacts/does-not-exist"),
      { params: Promise.resolve({ runId: "run-x-twitter-us", artifactName: "does-not-exist" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown attempt on a fixture", async () => {
    const res = await GET(
      new Request("http://localhost/api/runs/run-x-twitter-us/artifacts/prd?attempt=99"),
      { params: Promise.resolve({ runId: "run-x-twitter-us", artifactName: "prd" }) },
    );
    expect(res.status).toBe(404);
  });

  it("still serves a live runtime artifact with no fixture fallback", async () => {
    await store.writeArtifact(runId, "scope", 1, { interpretation: "live-only" });
    await store.writeManifest(runId, {
      runId,
      status: "completed",
      executionMode: "live",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stages: {},
      artifacts: { scope: { attempt: 1, file: "artifacts/scope.attempt-01.json" } },
      limitations: [],
      canReplay: true,
    });
    const res = await GET(
      new Request(`http://localhost/api/runs/${runId}/artifacts/scope`),
      { params: Promise.resolve({ runId, artifactName: "scope" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interpretation: "live-only" });
  });
});
