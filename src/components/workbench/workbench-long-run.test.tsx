import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { Workbench } from "./workbench";
import { getDictionary } from "@/i18n";

const tEn = getDictionary("en");

// A live run whose artifacts are published long after the run started, with
// `run.completed` arriving even later. The frontend must keep polling for
// artifacts until the run terminates — it must NOT give up on a fixed attempt
// ceiling while the run is still healthy (a real run took ~25min, with topics
// alone ~17min).
function event(seq: number, type: string, overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "1",
    sequence: seq,
    eventId: `e${seq}`,
    runId: "run-long",
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type,
    data: {},
    ...overrides,
  };
}

function previewResponse() {
  return {
    protocolVersion: "1",
    previewId: "preview-long",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/x/id839285684",
    createdAt: "2026-08-12T00:00:00.000Z",
    expiresAt: "2026-08-12T00:30:00.000Z",
    live: {
      provider: "apple-rss",
      forcedRefresh: false,
      cached: null,
      collectedAt: "2026-08-12T00:00:00.000Z",
      status: "complete",
      reviewCount: 1,
      pageCount: 1,
      requestCount: 1,
      dateRange: { earliest: null, latest: null },
      limitations: [],
      creditsUsed: null,
      requestId: null,
    },
    stable: { available: false, reviewCount: 0, cacheUpdatedAt: null, dateRange: { earliest: null, latest: null }, bootstrapRunId: null },
    recommendedSelection: "live",
  };
}

const availableArtifacts: Record<string, unknown> = {};

beforeEach(() => {
  availableArtifacts["cleaned-reviews"] = {
    stats: { rawCount: 350, includedCount: 300, duplicateCount: 50, identityConflictCount: 0, ratingDistribution: {} },
    reviews: [],
  };
  availableArtifacts["scope"] = { explicitLimitations: [], filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null } };
  vi.useFakeTimers();
  // Route /api/runs POST returns a stream that emits the initial events then
  // stays open (the run keeps running); artifact GETs resolve against a map
  // that gains entries over "time" — simulating late-published artifacts.
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/source-previews") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => previewResponse() });
      }
      if (url === "/api/runs" && init?.method === "POST") {
        const initial = [
          event(1, "run.accepted", { runId: "run-long" }),
          event(2, "stage.started", { stage: "scope", data: { stage: "scope" } }),
        ];
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const e of initial) controller.enqueue(new TextEncoder().encode(JSON.stringify(e) + "\n"));
            // Do NOT close: the run stays in flight.
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }
      if (url === "/api/runs") {
        return Promise.resolve({ ok: true, json: async () => ({ runs: [] }) });
      }
      const m = url.match(/^\/api\/runs\/run-long\/artifacts\/([a-z-]+)$/);
      if (m) {
        const name = m[1];
        if (name in availableArtifacts) {
          return Promise.resolve({ ok: true, json: async () => availableArtifacts[name] });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete availableArtifacts["topics"];
});

describe("Workbench long-running artifact polling", () => {
  it("keeps polling for artifacts beyond a fixed attempt ceiling while the run is still running", async () => {
    render(<Workbench />);

    // Start a live run (RunForm is in live mode by default with a prefilled
    // URL). The analysis goal must be long enough for the Start button to enable.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(tEn.goal), { target: { value: "Understand why users love the app" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.checkSample }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.analyzeFresh }));
    });

    // Advance WELL past the old attempt ceiling (1000 × 800ms ≈ 13.3min).
    // With the old ceiling the poller has now stopped entirely; the topics
    // artifact is only published *after* that point.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 * 800 + 100);
    });
    availableArtifacts["topics"] = { topics: [{ id: "topic-1", label: "Pricing", description: "cost complaints", reviewIds: [] }] };

    // Give the poller one more tick. A poller that stopped at the ceiling will
    // never pick the artifact up; a poller that only stops on run termination
    // will.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    // Open the topics tab; the late artifact must be shown.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.topics }));
    });

    expect(screen.getByText(/Pricing/)).toBeInTheDocument();
  });

  it("auto-advances to the topics tab when the topics artifact lands (no manual click)", async () => {
    render(<Workbench />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(tEn.goal), { target: { value: "Understand why users love the app" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.checkSample }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.analyzeFresh }));
    });

    // Publish the topics artifact; the UI should follow it to the topics tab
    // automatically without the user clicking the tab.
    availableArtifacts["topics"] = { topics: [{ id: "topic-1", label: "Pricing", description: "cost complaints", reviewIds: [] }] };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    // No manual tab click: the topics panel content must be visible already.
    expect(screen.getByText(/Pricing/)).toBeInTheDocument();
  });
});
