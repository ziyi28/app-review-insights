import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunStore } from "../runs/run-store";
import { EventPublisher } from "./event-publisher";

let dir: string;
let store: RunStore;
let publisher: EventPublisher;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "evpub-"));
  store = new RunStore(dir);
  publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("EventPublisher", () => {
  it("emits a run.accepted event first with sequence 1", async () => {
    const runId = store.createRunId();
    const events: unknown[] = [];
    publisher.onEvent((e) => events.push(e));
    await publisher.publish({ type: "run.accepted", runId, data: {} });
    expect(events).toHaveLength(1);
    expect((events[0] as { sequence: number }).sequence).toBe(1);
    expect((events[0] as { type: string }).type).toBe("run.accepted");
  });

  it("persists the event before enqueueing it", async () => {
    const runId = store.createRunId();
    const events: unknown[] = [];
    publisher.onEvent((e) => {
      // At the moment the subscriber runs, the event must already be on disk.
      const file = path.join(store.resolveRunDir(runId), "events.ndjson");
      expect(store.existsFile(file)).toBe(true);
      events.push(e);
    });
    await publisher.publish({ type: "stage.started", runId, stage: "source", data: {} });
    expect(events).toHaveLength(1);
  });

  it("publishes artifact.available only after the artifact is readable", async () => {
    const runId = store.createRunId();
    const events: unknown[] = [];
    publisher.onEvent((e) => events.push(e));
    await publisher.publishArtifact(runId, "findings", 1, { ok: true });
    expect(await store.readArtifact(runId, "findings", 1)).toEqual({ ok: true });
    const last = events.at(-1) as { type: string };
    expect(last.type).toBe("artifact.available");
  });

  it("increments sequence strictly across publishes", async () => {
    const runId = store.createRunId();
    const events: unknown[] = [];
    publisher.onEvent((e) => events.push(e));
    await publisher.publish({ type: "run.accepted", runId, data: {} });
    await publisher.publish({ type: "stage.started", runId, stage: "source", data: {} });
    await publisher.publish({ type: "run.completed", runId, data: {} });
    const seqs = events.map((e) => (e as { sequence: number }).sequence);
    expect(seqs).toEqual([1, 2, 3]);
  });
});
