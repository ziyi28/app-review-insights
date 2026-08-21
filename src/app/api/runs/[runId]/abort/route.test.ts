import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { registerActive, resetActiveRuns, isRunActive } from "@/server/runs/run-executor";

function postAbort(runId: string): Promise<Response> {
  return POST(new Request(`http://localhost/api/runs/${runId}/abort`, { method: "POST" }), {
    params: Promise.resolve({ runId }),
  });
}

beforeEach(() => {
  resetActiveRuns();
});

afterEach(() => {
  resetActiveRuns();
});

describe("POST /api/runs/[runId]/abort", () => {
  it("aborts an active run and cancels its AbortController", async () => {
    const controller = new AbortController();
    registerActive("test-run-123", controller);
    expect(isRunActive("test-run-123")).toBe(true);
    expect(controller.signal.aborted).toBe(false);

    const res = await postAbort("test-run-123");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; runId: string; cancelled: boolean };
    expect(json.ok).toBe(true);
    expect(json.runId).toBe("test-run-123");
    expect(json.cancelled).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("returns ok with cancelled=false if the run was not active", async () => {
    const res = await postAbort("inactive-run-456");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; runId: string; cancelled: boolean };
    expect(json.ok).toBe(true);
    expect(json.runId).toBe("inactive-run-456");
    expect(json.cancelled).toBe(false);
  });
});
