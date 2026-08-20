import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
      new Request("http://localhost/api/runs/run-workout-for-women-us/artifacts/raw-reviews"),
      { params: Promise.resolve({ runId: "run-workout-for-women-us", artifactName: "raw-reviews" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: unknown[]; rawRefs?: string[] };
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(body.reviews.length).toBeGreaterThan(0);
  });

  it("serves a fixture's prd and final-report", async () => {
    for (const name of ["prd", "final-report"]) {
      const res = await GET(
        new Request(`http://localhost/api/runs/run-workout-for-women-us/artifacts/${name}`),
        { params: Promise.resolve({ runId: "run-workout-for-women-us", artifactName: name }) },
      );
      expect(res.status).toBe(200);
    }
  });

  it("honors the fixture manifest's declared attempt", async () => {
    const manifest = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(path.join(process.cwd(), "fixtures", "demo-runs", "run-workout-for-women-us", "manifest.json"), "utf8"))) as { artifacts: Record<string, { attempt: number }> };
    const prdAttempt = manifest.artifacts.prd.attempt;
    const res = await GET(
      new Request(`http://localhost/api/runs/run-workout-for-women-us/artifacts/prd?attempt=${prdAttempt}`),
      { params: Promise.resolve({ runId: "run-workout-for-women-us", artifactName: "prd" }) },
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for a fixture artifact that does not exist", async () => {
    const res = await GET(
      new Request("http://localhost/api/runs/run-workout-for-women-us/artifacts/does-not-exist"),
      { params: Promise.resolve({ runId: "run-workout-for-women-us", artifactName: "does-not-exist" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown attempt on a fixture", async () => {
    const res = await GET(
      new Request("http://localhost/api/runs/run-workout-for-women-us/artifacts/prd?attempt=99"),
      { params: Promise.resolve({ runId: "run-workout-for-women-us", artifactName: "prd" }) },
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

  it("does not fall back to fixture artifacts after a runtime manifest owns the run id", async () => {
    const collidingRunId = "run-workout-for-women-us";

    await store.writeManifest(collidingRunId, {
      runId: collidingRunId,
      status: "completed",
      executionMode: "live",
      createdAt: new Date().toISOString(),
      updatedAt: "",
      goal: "RUNTIME-SHADOW",
      stages: {},
      artifacts: {},
      limitations: [],
      canReplay: false,
    });

    const res = await GET(
      new Request(
        `http://localhost/api/runs/${collidingRunId}/artifacts/raw-reviews`,
      ),
      {
        params: Promise.resolve({
          runId: collidingRunId,
          artifactName: "raw-reviews",
        }),
      },
    );

    expect(res.status).toBe(404);
  });

  it("serves the runtime artifact, not the fixture, once a same-named run owns the id", async () => {
    const collidingRunId = "run-workout-for-women-us";

    await store.writeArtifact(collidingRunId, "raw-reviews", 1, {
      reviews: [{ id: "runtime-only" }],
    });
    await store.writeManifest(collidingRunId, {
      runId: collidingRunId,
      status: "completed",
      executionMode: "live",
      createdAt: new Date().toISOString(),
      updatedAt: "",
      goal: "RUNTIME-SHADOW",
      stages: {},
      artifacts: { "raw-reviews": { attempt: 1, file: "artifacts/raw-reviews.attempt-01.json" } },
      limitations: [],
      canReplay: false,
    });

    const res = await GET(
      new Request(`http://localhost/api/runs/${collidingRunId}/artifacts/raw-reviews`),
      { params: Promise.resolve({ runId: collidingRunId, artifactName: "raw-reviews" }) },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: { id: string }[] };
    expect(body.reviews).toEqual([{ id: "runtime-only" }]);
  });

  it("still serves an early-run artifact before the manifest is written", async () => {
    // No manifest yet: the run was accepted and the first artifact landed, but
    // the manifest write raced or the process died before finalize. The
    // attempt-01 artifact must still be readable, both by default and when
    // attempt 1 is requested explicitly.
    await store.writeArtifact(runId, "scope", 1, { interpretation: "early" });

    const get = (suffix = "") =>
      GET(
        new Request(`http://localhost/api/runs/${runId}/artifacts/scope${suffix}`),
        { params: Promise.resolve({ runId, artifactName: "scope" }) },
      );

    expect((await get()).status).toBe(200);
    expect((await get("?attempt=1")).status).toBe(200);
    expect(await (await get("?attempt=1")).json()).toEqual({ interpretation: "early" });
  });

  it("rejects attempts after 1 when no manifest exists in any root", async () => {
    // No manifest in any root: only an early attempt-01 may be served. A later
    // attempt must be a 404 even if the file itself exists.
    await store.writeArtifact(runId, "scope", 2, {
      interpretation: "orphan later attempt",
    });

    const res = await GET(
      new Request(
        `http://localhost/api/runs/${runId}/artifacts/scope?attempt=2`,
      ),
      {
        params: Promise.resolve({
          runId,
          artifactName: "scope",
        }),
      },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "artifact attempt not found",
    });
  });

  it("ignores an orphan runtime artifact without a manifest and serves the fixture owner", async () => {
    // A same-named run id whose artifact landed but whose manifest was never
    // written must NOT claim ownership: the fixture's manifest owns the id, so
    // the fixture artifact is served and the orphan is ignored.
    const collidingRunId = "run-workout-for-women-us";
    await store.writeArtifact(collidingRunId, "raw-reviews", 1, {
      reviews: [{ id: "runtime-orphan" }],
    });

    const res = await GET(
      new Request(`http://localhost/api/runs/${collidingRunId}/artifacts/raw-reviews`),
      { params: Promise.resolve({ runId: collidingRunId, artifactName: "raw-reviews" }) },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: { sourceReviewId?: string; id?: string }[] };
    expect(body.reviews.length).toBeGreaterThan(0);
    expect(body.reviews.some((r) => r.id === "runtime-orphan")).toBe(false);
    expect(body.reviews.some((r) => r.sourceReviewId === "14444266843")).toBe(true);
  });

  it("returns 500 for a corrupted runtime manifest instead of falling back to fixture", async () => {
    const collidingRunId = "run-workout-for-women-us";
    const runDir = store.resolveRunDir(collidingRunId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "manifest.json"), "{ not valid json", "utf8");

    const res = await GET(
      new Request(`http://localhost/api/runs/${collidingRunId}/artifacts/raw-reviews`),
      { params: Promise.resolve({ runId: collidingRunId, artifactName: "raw-reviews" }) },
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});
