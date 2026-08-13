import { describe, it, expect, vi } from "vitest";
import { modelProgressRelay } from "./dependencies";

describe("modelProgressRelay", () => {
  it("maps a heartbeat to a human-readable in-progress message", () => {
    const onProgress = vi.fn();
    const relay = modelProgressRelay(onProgress)!;
    relay({ kind: "heartbeat", elapsedMs: 5000 });
    expect(onProgress).toHaveBeenCalledWith("model generation in progress (5s)");
  });

  it("maps a retry to a retry-visible message", () => {
    const onProgress = vi.fn();
    const relay = modelProgressRelay(onProgress)!;
    relay({ kind: "retry", attempt: 2, maxAttempts: 3, delayMs: 1000, reason: "MODEL_HTTP_ERROR" });
    expect(onProgress).toHaveBeenCalledWith("model retry 2/3 in 1s (MODEL_HTTP_ERROR)");
  });

  it("returns undefined when the stage has no progress callback", () => {
    expect(modelProgressRelay(undefined)).toBeUndefined();
  });
});
