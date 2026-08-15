import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRunArtifacts } from "./use-run-artifacts";
import type { RunEvent } from "@/domain/contracts/events";

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEvent(seq: number, type: RunEvent["type"], artifact?: string, attempt = 1): RunEvent {
  return {
    protocolVersion: "1",
    sequence: seq,
    eventId: `e${seq}`,
    runId: "run-1",
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type,
    data: artifact ? { artifact, attempt } : {},
  } as RunEvent;
}


describe("useRunArtifacts", () => {
  it("initializes with empty cache and default draft phases", () => {
    const { result } = renderHook(() =>
      useRunArtifacts({
        runId: null,
        status: null,
        events: [],
        running: false,
        tab: "overview",
        userNavigatedRef: { current: false },
      }),
    );
    expect(result.current.cache).toEqual({ runId: null });
    expect(result.current.prdPhase).toBe("draft");
    expect(result.current.activePrd).toBeNull();
  });

  it("fetches announced artifacts when artifact.available event arrives", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/runs/run-1/artifacts/topics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ topics: [{ id: "t1", label: "Topic 1", description: "Desc", reviewIds: [] }] }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onAutoAdvanceTab = vi.fn();
    const events = [makeEvent(1, "artifact.available", "topics", 1)];

    const { result } = renderHook(() =>
      useRunArtifacts({
        runId: "run-1",
        status: "running",
        events,
        running: true,
        tab: "overview",
        userNavigatedRef: { current: false },
        onAutoAdvanceTab,
      }),
    );

    await waitFor(() => {
      expect(result.current.cache.topics).toBeDefined();
    });

    expect(result.current.cache.topics?.topics[0].id).toBe("t1");
    expect(onAutoAdvanceTab).toHaveBeenCalledWith("topics");
  });

  it("resets artifacts cache and phases when resetArtifacts is called or runId clears", async () => {
    const { result, rerender } = renderHook(
      ({ runId }) =>
        useRunArtifacts({
          runId,
          status: runId ? "running" : null,
          events: [],
          running: Boolean(runId),
          tab: "overview",
          userNavigatedRef: { current: false },
        }),
      { initialProps: { runId: "run-1" as string | null } },
    );

    act(() => {
      result.current.setPrdPhase("final");
    });
    expect(result.current.prdPhase).toBe("final");

    rerender({ runId: null });
    expect(result.current.cache).toEqual({ runId: null });
    expect(result.current.prdPhase).toBe("draft");
  });

});
