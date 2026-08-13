import { describe, it, expect } from "vitest";
import { RunEventSchema } from "./events";

describe("run event contract", () => {
  const base = {
    protocolVersion: "1",
    sequence: 1,
    eventId: "evt-1",
    runId: "run-1",
    timestamp: "2026-08-12T00:00:00Z",
    deliveryMode: "live" as const,
  };

  it("accepts a run.accepted event", () => {
    expect(RunEventSchema.parse({ ...base, type: "run.accepted", data: {} }).type).toBe("run.accepted");
  });

  it("rejects an unknown event type", () => {
    expect(() => RunEventSchema.parse({ ...base, type: "mystery", data: {} })).toThrow();
  });

  it("rejects a non-string protocol version", () => {
    expect(() =>
      RunEventSchema.parse({ ...base, protocolVersion: 2, type: "run.accepted", data: {} }),
    ).toThrow();
  });

  it("accepts a stage.started event with a stage name", () => {
    const evt = RunEventSchema.parse({ ...base, type: "stage.started", stage: "source", data: {} });
    expect(evt.stage).toBe("source");
  });

  it("accepts the evidence-validation stage in events", () => {
    const evt = RunEventSchema.parse({ ...base, type: "stage.started", stage: "evidence-validation", data: {} });
    expect(evt.stage).toBe("evidence-validation");
  });

  it("rejects an unknown stage name", () => {
    expect(() =>
      RunEventSchema.parse({ ...base, type: "stage.started", stage: "nope", data: {} }),
    ).toThrow();
  });
});
