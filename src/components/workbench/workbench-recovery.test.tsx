import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Workbench } from "./workbench";
import { LAST_RUN_ID_KEY } from "@/hooks/use-run-stream";

function event(seq: number, type: string, overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "1",
    sequence: seq,
    eventId: `e${seq}`,
    runId: "run-a",
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type,
    data: {},
    ...overrides,
  };
}

const prdDraft = { requirements: [], versions: [], assumptions: [] };
const prdFinal = { requirements: [{ id: "req-final", title: "Final requirement" }], versions: [], assumptions: [] };

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Workbench refresh recovery and attempt handling", () => {
  it("restores the latest running run on mount", async () => {
    // A stored last-run-id points at run-old, but run-live is running: recovery
    // must prefer the running run.
    localStorage.setItem(LAST_RUN_ID_KEY, "run-old");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            runs: [
              { runId: "run-old", status: "completed" },
              { runId: "run-live", status: "running" },
            ],
          }),
        };
      }
      if (url.includes("/api/runs/run-live/events")) {
        return {
          ok: true,
          json: async () => ({
            runId: "run-live",
            status: "running",
            events: [event(1, "run.accepted", { runId: "run-live" })],
            lastSequence: 1,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Workbench />);

    // The workbench polls the running run's events (not the stale last-viewed).
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/runs/run-live/events"), expect.anything());
    });
  });

  it("fetches attempt 2 over attempt 1 when a revised artifact is announced", async () => {
    localStorage.setItem(LAST_RUN_ID_KEY, "run-a");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs" && !init?.method) {
        return { ok: true, json: async () => ({ runs: [{ runId: "run-a", status: "running" }] }) };
      }
      if (url.includes("/api/runs/run-a/events")) {
        return {
          ok: true,
          json: async () => ({
            runId: "run-a",
            status: "completed",
            events: [
              event(1, "run.accepted"),
              event(2, "artifact.available", { data: { artifact: "prd", attempt: 1 } }),
              event(3, "artifact.available", { data: { artifact: "prd", attempt: 2 } }),
              event(4, "run.completed"),
            ],
            lastSequence: 4,
          }),
        };
      }
      const m = url.match(/\/api\/runs\/run-a\/artifacts\/prd\?attempt=(\d+)/);
      if (m) {
        const attempt = Number(m[1]);
        return { ok: true, json: async () => (attempt === 1 ? prdDraft : prdFinal) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Workbench />);

    // The recovery path loads run-a; the revised PRD is fetched at attempt 2,
    // never left on a stale attempt-1 draft.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/runs/run-a/artifacts/prd?attempt=2"), expect.anything());
    });
  });
});
