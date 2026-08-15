import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workbench } from "./workbench";
import { getDictionary } from "@/i18n";

const tEn = getDictionary("en");
const tZh = getDictionary("zh-CN");

function stubConfigFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/runs") {
        return Promise.resolve({ ok: true, json: async () => ({ runs: [] }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, serpApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    }),
  );
}

function previewResponse() {
  return {
    protocolVersion: "1",
    previewId: "preview-wb",
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

// A live-run POST stream that leads with run.accepted and stays open, so the
// run is in-flight but the very first event may not have arrived yet.
function startStreamingPost() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/source-previews") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => previewResponse() });
      }
      if (url === "/api/runs" && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start() {
                // Intentionally emit nothing yet: the client is waiting for the
                // first event. The stream stays open (run in flight).
              },
            }),
            { status: 200 },
          ),
        );
      }
      if (url === "/api/runs") {
        return Promise.resolve({ ok: true, json: async () => ({ runs: [] }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, serpApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    }),
  );
}

describe("Workbench settings integration", () => {
  it("defaults to the Chinese interface", () => {
    stubConfigFetch();
    render(<Workbench />);
    expect(screen.getByRole("heading", { name: tZh.appTitle })).toBeInTheDocument();
  });

  it("opens the settings panel from the header button", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);
    await user.click(screen.getByRole("button", { name: tZh.settings }));
    expect(await screen.findByRole("dialog", { name: tZh.settings })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(tZh.modelBaseUrl)).toBeInTheDocument();
    });
  });

  it("shows the settings panel in English after switching the UI locale", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);
    // Switch the header language select to English.
    const langSelect = screen.getByRole("combobox", { name: tZh.language });
    await user.selectOptions(langSelect, "en");
    await user.click(screen.getByRole("button", { name: tEn.settings }));
    expect(await screen.findByRole("dialog", { name: tEn.settings })).toBeInTheDocument();
    expect(screen.getByLabelText(tEn.modelBaseUrl)).toBeInTheDocument();
    expect(screen.getByLabelText(tEn.modelName)).toBeInTheDocument();
  });

  it("switches to a 'starting' state the moment a run starts, before any event arrives", async () => {
    startStreamingPost();
    render(<Workbench />);

    // Walk the three-step wizard: live mode → fill URL + goal → confirm, then
    // choose the live dataset to start the run. The stream stays open but emits
    // nothing yet, so events stays empty.
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: new RegExp(tZh.liveMode) }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tZh.next }));
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
    // The confirm step auto-checks the sample; wait for the live sample card.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: tZh.analyzeFresh })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tZh.analyzeFresh }));
    });

    // The initial form is gone and a "starting" indicator is visible instead of
    // a blank main area (the aria-live region and the visual indicator both
    // carry the "starting" text).
    expect(screen.queryByRole("button", { name: tZh.analyzeFresh })).not.toBeInTheDocument();
    expect(screen.getAllByText(tZh.starting).length).toBeGreaterThan(0);
  });

  it("retries a failed run from history panel", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/runs" && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start() {},
            }),
            { status: 200 },
          ),
        );
      }
      if (url === "/api/runs") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runs: [
              {
                runId: "run-failed-1",
                status: "failed",
                createdAt: "2026-08-12T00:00:00Z",
                canReplay: false,
                canRetry: true,
                goal: "Analyze login dropoff",
                executionMode: "live",
                appName: "Test App",
                appUrl: "https://apps.apple.com/us/app/test-app/id839285684",
              },
            ],
          }),
        });
      }
      if (url === "/api/runs/run-failed-1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runId: "run-failed-1",
            status: "failed",
            startRequest: {
              protocolVersion: "1",
              mode: "analyze",
              uiLocale: "zh-CN",
              outputLocale: "zh-CN",
              goal: "Analyze login dropoff",
              source: { kind: "live", appStoreUrl: "https://apps.apple.com/us/app/test-app/id839285684", reviewLimit: 300 },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, serpApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Workbench />);

    // Open history modal
    await user.click(screen.getByRole("button", { name: tZh.history }));
    expect(await screen.findByRole("dialog", { name: tZh.history })).toBeInTheDocument();

    // Click retry button in history modal
    const retryBtn = await screen.findByRole("button", { name: tZh.retry });
    await user.click(retryBtn);

    // Verify it fetched the manifest and started a new run with startRequest and preserved reviewLimit
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-failed-1", expect.anything());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({
          method: "POST",
          body: expect.stringMatching(/"reviewLimit":\s*300/),
        }),
      );
    });
  });

  it("retries a preview-backed run without stale previewId/reviewSelection", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/runs" && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start() {},
            }),
            { status: 200 },
          ),
        );
      }
      if (url === "/api/runs") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runs: [
              {
                runId: "run-preview-failed",
                status: "failed",
                createdAt: "2026-08-12T00:00:00Z",
                canReplay: false,
                canRetry: true,
                goal: "Analyze login dropoff",
                executionMode: "live",
                appName: "Test App",
                appUrl: "https://apps.apple.com/us/app/test-app/id839285684",
              },
            ],
          }),
        });
      }
      if (url === "/api/runs/run-preview-failed") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runId: "run-preview-failed",
            status: "failed",
            startRequest: {
              protocolVersion: "1",
              mode: "analyze",
              uiLocale: "zh-CN",
              outputLocale: "zh-CN",
              goal: "Analyze login dropoff",
              source: {
                kind: "live",
                appStoreUrl: "https://apps.apple.com/us/app/test-app/id839285684",
                previewId: "preview-wb",
                reviewSelection: "live",
                reviewLimit: 300,
              },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, serpApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Workbench />);

    await user.click(screen.getByRole("button", { name: tZh.history }));
    expect(await screen.findByRole("dialog", { name: tZh.history })).toBeInTheDocument();

    const retryBtn = await screen.findByRole("button", { name: tZh.retry });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-preview-failed", expect.anything());
    });
    // The rebuilt request keeps URL + limit but drops the paired
    // previewId/reviewSelection so the server does not 422.
    const postCalls = fetchMock.mock.calls.filter(
      ([u, i]) => u === "/api/runs" && (i as RequestInit)?.method === "POST",
    );
    expect(postCalls.length).toBeGreaterThan(0);
    const postBody = String((postCalls[0][1] as RequestInit).body);
    expect(postBody).toContain('"appStoreUrl"');
    expect(postBody).toMatch(/"reviewLimit":\s*300/);
    expect(postBody).not.toContain("previewId");
    expect(postBody).not.toContain("reviewSelection");
  });

  it("switches between workbench and executive report modes", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);

    const reportModeBtn = screen.getByRole("button", { name: new RegExp(tZh.viewModeReport) });
    const workbenchModeBtn = screen.getByRole("button", { name: new RegExp(tZh.viewModeWorkbench) });

    expect(reportModeBtn).toBeInTheDocument();
    expect(workbenchModeBtn).toBeInTheDocument();

    await user.click(reportModeBtn);
    expect(reportModeBtn.className).toContain("modeBtnActive");

    await user.click(workbenchModeBtn);
    expect(workbenchModeBtn.className).toContain("modeBtnActive");
  });

  it("does not show stale PRD in executive report or overview while a new run is in classification stage", async () => {
    // Stage 1: Load a completed run that has a PRD
    localStorage.setItem("app-review-planner:last-run-id", "run-old-completed");

    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u === "/api/runs") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runs: [{ runId: "run-old-completed", status: "completed" }],
          }),
        });
      }
      if (u === "/api/runs/run-old-completed") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runId: "run-old-completed",
            status: "completed",
            goal: "Old completed goal",
            artifacts: { prd: { attempt: 1 } },
          }),
        });
      }
      if (u.includes("/api/runs/run-old-completed/events")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "completed",
            events: [
              { protocolVersion: "1", sequence: 1, eventId: "e1", runId: "run-old-completed", timestamp: "2026-08-12T00:00:00Z", deliveryMode: "live", type: "run.accepted", data: {} },
              { protocolVersion: "1", sequence: 2, eventId: "e2", runId: "run-old-completed", timestamp: "2026-08-12T00:00:01Z", deliveryMode: "live", type: "run.completed", data: {} },
            ],
            lastSequence: 2,
          }),
        });
      }
      if (u.includes("/api/runs/run-old-completed/artifacts/prd")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            requirements: [{ id: "req-old-1", priority: "P0", title: "Old Stale Feature", description: "Desc", acceptanceCriteria: [] }],
            tests: [{ id: "test-old-1", steps: ["step 1"], expectedResult: "ok", requirementIds: ["req-old-1"] }],
            versions: [],
            assumptions: [],
          }),
        });
      }
      if (u.includes("/api/runs/run-live-classifying/events")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "running",
            events: [
              { protocolVersion: "1", sequence: 1, eventId: "e10", runId: "run-live-classifying", timestamp: "2026-08-12T00:00:00Z", deliveryMode: "live", type: "run.accepted", data: {} },
              { protocolVersion: "1", sequence: 2, eventId: "e11", runId: "run-live-classifying", timestamp: "2026-08-12T00:00:01Z", deliveryMode: "live", type: "stage.started", stage: "topics", data: { stage: "topics" } },
              { protocolVersion: "1", sequence: 3, eventId: "e12", runId: "run-live-classifying", timestamp: "2026-08-12T00:00:02Z", deliveryMode: "live", type: "artifact.available", stage: "topics", data: { artifact: "topic-candidates", attempt: 1 } },
            ],
            lastSequence: 3,
          }),
        });
      }
      if (u.includes("/api/runs/run-live-classifying/artifacts/topic-candidates")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            candidates: [{ id: "cand-1", label: "Topic 1", description: "Desc 1", supportingReviewIds: ["r1"], quote: "Quote 1" }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, serpApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Workbench />);

    // Switch to Executive Report mode to verify old PRD is present
    const reportModeBtn = screen.getByRole("button", { name: new RegExp(tZh.viewModeReport) });
    await user.click(reportModeBtn);

    // Wait for the completed run to load its PRD in Executive Report
    await waitFor(() => {
      expect(screen.getByText("Old Stale Feature")).toBeInTheDocument();
    });

    // Switch back to workbench and click new run
    const workbenchModeBtn = screen.getAllByRole("button", { name: new RegExp(tZh.viewModeWorkbench) })[0];
    await user.click(workbenchModeBtn);

    const newRunBtn = screen.getByRole("button", { name: tZh.newRun });
    await user.click(newRunBtn);

    // Switch to Executive Report mode while in idle/new run state
    await user.click(reportModeBtn);

    // Verify "Old Stale Feature" is NOT in the executive report
    expect(screen.queryByText("Old Stale Feature")).not.toBeInTheDocument();
  });
});



