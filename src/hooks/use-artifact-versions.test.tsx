import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useArtifactVersions } from "./use-artifact-versions";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(value: unknown) {
  return Promise.resolve({ ok: true, json: async () => value });
}

describe("useArtifactVersions", () => {
  it("does not fetch anything before the run is terminal", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useArtifactVersions("run-1", false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the manifest then attempt 1 and latest when terminal", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (/\/api\/runs\/run-[^/]+$/.test(String(url)) && !String(url).includes("artifacts")) {
        return jsonResponse({ runId: "run-1", artifacts: { prd: { attempt: 2 } } });
      }
      if (String(url).includes("attempt=1")) {
        return jsonResponse({ phase: "draft" });
      }
      if (String(url).includes("attempt=2")) {
        return jsonResponse({ phase: "final" });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useArtifactVersions("run-1", true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.manifest).toEqual({ runId: "run-1", artifacts: { prd: { attempt: 2 } } });
    expect(result.current.prd).toEqual({ draft: { phase: "draft" }, final: { phase: "final" }, revised: true });
  });

  it("marks revised=false and requests only once when latest attempt is 1", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (/\/api\/runs\/run-[^/]+$/.test(String(url)) && !String(url).includes("artifacts")) {
        return jsonResponse({ runId: "run-1", artifacts: { prd: { attempt: 1 } } });
      }
      if (String(url).includes("attempt=1")) {
        return jsonResponse({ phase: "draft" });
      }
      if (String(url).includes("attempt=2")) {
        return jsonResponse({ phase: "final" });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useArtifactVersions("run-1", true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prd).toEqual({ draft: { phase: "draft" }, final: null, revised: false });
    const manifestCalls = fetchMock.mock.calls.filter(([u]) => /\/api\/runs\/run-[^/]+$/.test(String(u)) && !String(u).includes("artifacts"));
    const attemptCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("attempt="));
    expect(manifestCalls).toHaveLength(1);
    // attempt=1 served; attempt=2 must NOT be requested.
    expect(attemptCalls.every(([u]) => String(u).includes("attempt=1"))).toBe(true);
  });

  it("does not let a stale run overwrite a newer run's state", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (/\/api\/runs\/run-[^/]+$/.test(String(url)) && !String(url).includes("artifacts")) {
        return jsonResponse({ runId: String(url).includes("run-stale") ? "run-stale" : "run-new", artifacts: { prd: { attempt: 1 } } });
      }
      return jsonResponse({ phase: "draft" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ runId }) => useArtifactVersions(runId, true), { initialProps: { runId: "run-stale" } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.manifest?.runId).toBe("run-stale");
    rerender({ runId: "run-new" });
    await waitFor(() => expect(result.current.manifest?.runId).toBe("run-new"));
  });
});
