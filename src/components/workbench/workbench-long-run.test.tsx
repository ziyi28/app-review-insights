import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { Workbench } from "./workbench";
import { getDictionary } from "@/i18n";

const tZh = getDictionary("zh-CN");

// A live run whose artifacts are announced long after the run started, with
// `run.completed` arriving even later. The frontend must keep polling events and
// fetch an artifact only once its `artifact.available` event arrives — it must
// NOT give up on a fixed attempt ceiling while the run is still healthy (a real
// run took ~25min, with topics alone ~17min).
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
      searchCount: 0,
      searchId: null,
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
  // POST /api/runs returns 202 {runId}; the events endpoint serves a growing
  // list (as artifact.available events land) keyed by afterSequence; artifact
  // GETs resolve against a map that gains entries over "time".
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/source-previews") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => previewResponse() });
      }
      if (url === "/api/runs" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ runId: "run-long", status: "running", eventsUrl: "/api/runs/run-long/events" }) });
      }
      if (url === "/api/runs" && !init?.method) {
        return Promise.resolve({ ok: true, json: async () => ({ runs: [] }) });
      }
      const ev = url.match(/\/api\/runs\/run-long\/events\?afterSequence=(\d+)/);
      if (ev) {
        const after = Number(ev[1]);
        const events = [
          event(1, "run.accepted", { runId: "run-long" }),
          event(2, "stage.started", { stage: "scope", data: { stage: "scope" } }),
        ];
        if (availableArtifacts["topics"]) {
          events.push(event(3, "artifact.available", { data: { artifact: "topics", attempt: 1 } }));
        }
        const page = events.filter((e) => (e as { sequence: number }).sequence > after);
        const lastSequence = (events.at(-1) as { sequence: number } | undefined)?.sequence ?? 0;
        return Promise.resolve({ ok: true, json: async () => ({ runId: "run-long", status: "running", events: page, lastSequence }) });
      }
      const m = url.match(/^\/api\/runs\/run-long\/artifacts\/([a-z-]+)(?:\?attempt=(\d+))?$/);
      if (m) {
        const name = m[1];
        if (name in availableArtifacts) {
          return Promise.resolve({ ok: true, json: async () => availableArtifacts[name] });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, serpApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete availableArtifacts["topics"];
});

/** Walk the wizard to a live confirm, then start the live run. */
async function startLiveRun() {
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(tZh.liveMode) }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tZh.useExampleApp }));
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText(tZh.goal), { target: { value: "理解用户为什么喜欢这个应用" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tZh.next }));
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    if (screen.queryByRole("button", { name: tZh.analyzeFresh })) break;
  }
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tZh.analyzeFresh }));
  });
}

/** Advance time in small steps, flushing microtasks/effects between, until the
 *  predicate passes or the step budget is exhausted. */
async function advanceUntil(predicate: () => boolean, maxSteps = 20): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    if (predicate()) return;
  }
}

describe("Workbench long-running artifact polling", () => {
  it("keeps polling events and loads an artifact announced far later, past a fixed ceiling", async () => {
    render(<Workbench />);
    await startLiveRun();

    // Advance WELL past the old artifact-poll attempt ceiling (~13min). The
    // topics artifact is only announced (via its artifact.available event) after
    // that point.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 * 800 + 100);
    });
    availableArtifacts["topics"] = { topics: [{ id: "topic-1", label: "Pricing", description: "cost complaints", reviewIds: [] }] };

    // One more event-poll tick announces the topics artifact; the client then
    // fetches it. A client that stopped at a ceiling would never pick it up.
    await advanceUntil(() => screen.queryByRole("tab", { name: tZh.topics }) !== null, 3);
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: tZh.topics }));
    });

    expect(screen.getByText(/Pricing/)).toBeInTheDocument();
  }, 20000);

  it("auto-advances to the topics tab when the topics artifact lands (no manual click)", async () => {
    render(<Workbench />);
    await startLiveRun();

    availableArtifacts["topics"] = { topics: [{ id: "topic-1", label: "Pricing", description: "cost complaints", reviewIds: [] }] };
    await advanceUntil(() => screen.queryByText(/Pricing/) !== null);

    // No manual tab click: the topics panel content must be visible already.
    expect(screen.getByText(/Pricing/)).toBeInTheDocument();
  }, 10000);
});
