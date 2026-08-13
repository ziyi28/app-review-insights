import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRunStream } from "./use-run-stream";

function makeEvent(seq: number, type: string): unknown {
  return {
    protocolVersion: "1",
    sequence: seq,
    eventId: `e${seq}`,
    runId: "r",
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type,
    data: {},
  };
}

function mockFetchWithEvents(events: unknown[]): void {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(e) + "\n"));
      }
      controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("useRunStream", () => {
  it("accumulates events as they stream in", async () => {
    mockFetchWithEvents([makeEvent(1, "run.accepted"), makeEvent(2, "run.completed")]);
    const { result } = renderHook(() => useRunStream());

    await act(async () => {
      await result.current.start({ mode: "cached-replay", sourceRunId: "r" });
    });

    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.lastEvent?.type).toBe("run.completed");
    expect(result.current.running).toBe(false);
  });

  it("drops events that do not conform to the event protocol", async () => {
    // sequence 0 and missing protocolVersion violate RunEventSchema.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchWithEvents([
      { protocolVersion: "1", sequence: 0, eventId: "bad", runId: "r", timestamp: "x", deliveryMode: "live", type: "run.accepted", data: {} },
      makeEvent(1, "run.accepted"),
      makeEvent(2, "run.completed"),
    ]);
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.lastEvent?.type).toBe("run.completed");
    // The dropped event is counted and logged, not silently swallowed.
    expect(result.current.droppedEvents).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("surfaces an error on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "model not configured" }), { status: 503 })));
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.error).toContain("model not configured"));
  });

  it("reset clears state", async () => {
    mockFetchWithEvents([makeEvent(1, "run.accepted")]);
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    act(() => result.current.reset());
    expect(result.current.events).toHaveLength(0);
    expect(result.current.running).toBe(false);
  });
});
