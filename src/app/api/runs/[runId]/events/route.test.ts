import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET } from "./route";
import { RunStore } from "@/server/runs/run-store";
import { resetActiveRuns, registerActive } from "@/server/runs/run-executor";

let dir: string;
let store: RunStore;

function event(seq: number, type: string): Record<string, unknown> {
  return {
    protocolVersion: "1",
    sequence: seq,
    eventId: `e${seq}`,
    runId: "run-x",
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type,
    data: {},
  };
}

function get(runId: string, after?: number): Promise<Response> {
  const url = new URL(`http://localhost/api/runs/${runId}/events`);
  if (after !== undefined) url.searchParams.set("afterSequence", String(after));
  return GET(new Request(url), { params: Promise.resolve({ runId }) });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "events-route-"));
  store = new RunStore(dir);
  process.env.RUNS_DIR = dir;
  resetActiveRuns();
});

afterEach(() => {
  resetActiveRuns();
  rmSync(dir, { recursive: true, force: true });
});

async function seedEvents(lines: string[]): Promise<void> {
  const runDir = store.resolveRunDir("run-x");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify({ runId: "run-x", status: "running", executionMode: "live", createdAt: "", updatedAt: "", stages: {}, artifacts: {}, limitations: [], canReplay: false }));
  writeFileSync(path.join(runDir, "events.ndjson"), lines.join("\n"));
}

describe("GET /api/runs/[runId]/events", () => {
  it("returns events after a sequence without duplication or loss", async () => {
    await seedEvents([
      JSON.stringify(event(1, "run.accepted")),
      JSON.stringify(event(2, "stage.started")),
      JSON.stringify(event(3, "stage.completed")),
    ]);
    // First poll returns all three.
    const first = (await (await get("run-x")).json()) as { events: { sequence: number }[]; lastSequence: number };
    expect(first.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(first.lastSequence).toBe(3);

    // Incremental poll from the last sequence returns nothing new (no dup, no loss).
    const second = (await (await get("run-x", 3)).json()) as { events: { sequence: number }[]; lastSequence: number };
    expect(second.events).toHaveLength(0);
    expect(second.lastSequence).toBe(3);

    // From sequence 1 returns exactly 2 and 3.
    const third = (await (await get("run-x", 1)).json()) as { events: { sequence: number }[] };
    expect(third.events.map((e) => e.sequence)).toEqual([2, 3]);
  });

  it("tolerates an incomplete trailing line (concurrent append)", async () => {
    await seedEvents([
      JSON.stringify(event(1, "run.accepted")),
      JSON.stringify(event(2, "stage.started")),
    ]);
    // Simulate a partially-flushed line appended mid-write (its own line, so it
    // does not glue onto the preceding complete event).
    appendFileSync(path.join(store.resolveRunDir("run-x"), "events.ndjson"), '\n{"protocolVersion":"1","sequence":3,"eventId":"e3"');

    const res = await get("run-x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { sequence: number }[] };
    // The incomplete line is ignored, the complete events survive.
    expect(body.events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("resolves an active running manifest to running, and a stale one to interrupted", async () => {
    await seedEvents([JSON.stringify(event(1, "run.accepted"))]);

    // No active task -> the persisted running manifest reads as interrupted.
    const interrupted = (await (await get("run-x")).json()) as { status: string };
    expect(interrupted.status).toBe("interrupted");

    // A registered active task -> running.
    registerActive("run-x");
    const running = (await (await get("run-x")).json()) as { status: string };
    expect(running.status).toBe("running");
  });
});
