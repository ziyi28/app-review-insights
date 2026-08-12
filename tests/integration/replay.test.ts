import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "@/server/runs/run-store";
import { RunCatalog } from "@/server/runs/run-catalog";
import { loadReplayRun } from "@/server/runs/replay";

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "replay-"));
  store = new RunStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(runId: string, status = "completed"): void {
  const runDir = path.join(dir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify({
      runId,
      status,
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

describe("cached replay", () => {
  it("lists replayable runs from the store", async () => {
    const runId = store.createRunId();
    seed(runId);
    const catalog = new RunCatalog([dir]);
    const entries = await catalog.list();
    expect(entries.some((e) => e.runId === runId)).toBe(true);
  });

  it("replays a run without constructing source or model clients", async () => {
    const runId = store.createRunId();
    seed(runId);
    const bundle = await loadReplayRun([dir], runId);
    expect(bundle.manifest.status).toBe("completed");
    expect(bundle.events).toHaveLength(1);
    expect(bundle.artifacts.findings).toEqual({ ok: true });
  });

  it("refuses to replay an incomplete run", async () => {
    const runId = store.createRunId();
    seed(runId, "failed");
    await expect(loadReplayRun([dir], runId)).rejects.toThrow(/not completed/i);
  });

  it("refuses to replay a corrupt artifact", async () => {
    const runId = store.createRunId();
    seed(runId);
    writeFileSync(path.join(dir, runId, "artifacts", "findings.attempt-01.json"), "{ nope");
    await expect(loadReplayRun([dir], runId)).rejects.toThrow(/corrupt/i);
  });
});
