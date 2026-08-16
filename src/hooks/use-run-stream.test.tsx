import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRunStream, LAST_RUN_ID_KEY } from "./use-run-stream";

function makeEvent(seq: number, type: string, runId = "run-x"): unknown {
  return {
    protocolVersion: "1",
    sequence: seq,
    eventId: `e${seq}`,
    runId,
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type,
    data: {},
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  if (typeof localStorage !== "undefined") localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs fetch: POST /api/runs returns 202 {runId:"run-x"}, and the events
 *  endpoint serves events with sequence > afterSequence (matching any run id). */
function mockIncremental(runId: string, events: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs" && init?.method === "POST") {
        return { ok: true, json: async () => ({ runId, status: "running", eventsUrl: `/api/runs/${runId}/events` }) };
      }
      const m = url.match(new RegExp(`/api/runs/${runId}/events\\?afterSequence=(\\d+)`));
      if (m) {
        const after = Number(m[1]);
        const typed = events as { sequence: number; type: string }[];
        const page = typed.filter((e) => e.sequence > after);
        const terminal = page.some((e) => e.type === "run.completed" || e.type === "run.failed");
        const status = terminal ? "completed" : "running";
        const lastSequence = page.reduce((max, e) => Math.max(max, e.sequence), after);
        return { ok: true, json: async () => ({ runId, status, events: page, lastSequence }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe("useRunStream", () => {
  it("starts a run (202) and accumulates events via incremental polling", async () => {
    mockIncremental("run-x", [makeEvent(1, "run.accepted"), makeEvent(2, "run.completed")]);
    const { result } = renderHook(() => useRunStream());

    await act(async () => {
      await result.current.start({ mode: "cached-replay", sourceRunId: "r" });
    });

    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.runId).toBe("run-x");
    expect(result.current.lastEvent?.type).toBe("run.completed");
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.status).toBe("completed");
  });

  it("dedupes a duplicate sequence within a single batch (legacy snapshot)", async () => {
    // A pre-fix snapshot can carry two events with the same sequence (e.g. a
    // run.accepted colliding with the first stage event). They arrive in one
    // poll response and must be collapsed so the renderer never sees a
    // duplicate key.
    mockIncremental("run-x", [makeEvent(1, "run.accepted"), makeEvent(1, "stage.started"), makeEvent(2, "run.completed")]);
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("drops events that do not conform to the event protocol", async () => {
    const bad = { protocolVersion: "1", sequence: 1, eventId: "bad", runId: "run-x", timestamp: "not-a-date", deliveryMode: "live", type: "run.accepted", data: {} };
    mockIncremental("run-x", [bad, makeEvent(2, "run.accepted"), makeEvent(3, "run.completed")]);
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.lastEvent?.type).toBe("run.completed");
  });

  it("surfaces an error on a non-ok start response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ detail: "model not configured" }) })),
    );
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.error).toContain("model not configured"));
    expect(result.current.running).toBe(false);
  });

  it("keeps retrying on a transient poll failure, not failing the run", async () => {
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/runs" && init?.method === "POST") {
          return { ok: true, json: async () => ({ runId: "run-x" }) };
        }
        polls += 1;
        if (polls <= 2) throw new Error("network down");
        return { ok: true, json: async () => ({ runId: "run-x", status: "completed", events: [makeEvent(1, "run.completed")], lastSequence: 1 }) };
      }),
    );
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.reconnecting).toBe(true));
    expect(result.current.error).toBeNull();
    // The run must not be misreported as failed while reconnecting.
    expect(result.current.status).not.toBe("failed");

    await waitFor(() => expect(result.current.status).toBe("completed"), { timeout: 4000 });
    expect(result.current.error).toBeNull();
  });

  it("loadHistory switches to an existing run and records it as last-run-id", async () => {
    mockIncremental("run-history", [makeEvent(1, "run.accepted", "run-history"), makeEvent(2, "run.completed", "run-history")]);
    const { result } = renderHook(() => useRunStream());
    act(() => {
      result.current.loadHistory("run-history");
    });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.running).toBe(false);
    expect(localStorage.getItem(LAST_RUN_ID_KEY)).toBe("run-history");
  });

  it("reset clears state and stops polling", async () => {
    mockIncremental("run-x", [makeEvent(1, "run.accepted")]);
    const { result } = renderHook(() => useRunStream());
    await act(async () => {
      await result.current.start({});
    });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    act(() => result.current.reset());
    expect(result.current.events).toHaveLength(0);
    expect(result.current.running).toBe(false);
    expect(result.current.runId).toBeNull();
  });
});
