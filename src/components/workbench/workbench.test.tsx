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
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
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
      creditsUsed: null,
      requestId: null,
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
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    }),
  );
}

describe("Workbench settings integration", () => {
  it("opens the settings panel from the header button", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);
    await user.click(screen.getByRole("button", { name: tEn.settings }));
    expect(await screen.findByRole("dialog", { name: tEn.settings })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(tEn.modelBaseUrl)).toBeInTheDocument();
    });
  });

  it("shows the settings panel in Chinese after switching the UI locale", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);
    // Switch the header language select to 中文.
    const langSelect = screen.getByRole("combobox", { name: tEn.language });
    await user.selectOptions(langSelect, "zh-CN");
    await user.click(screen.getByRole("button", { name: tZh.settings }));
    expect(await screen.findByRole("dialog", { name: tZh.settings })).toBeInTheDocument();
    expect(screen.getByLabelText(tZh.modelBaseUrl)).toBeInTheDocument();
    expect(screen.getByLabelText(tZh.modelName)).toBeInTheDocument();
  });

  it("switches to a 'starting' state the moment a run starts, before any event arrives", async () => {
    startStreamingPost();
    render(<Workbench />);

    // Check the sample first, then choose the live dataset to start the run.
    // The stream stays open but emits nothing yet, so events stays empty.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(tEn.goal), { target: { value: "Understand why users love the app" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.checkSample }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tEn.analyzeFresh }));
    });

    // The initial form is gone and a "starting" indicator is visible instead of
    // a blank main area.
    expect(screen.queryByRole("button", { name: tEn.checkSample })).not.toBeInTheDocument();
    expect(screen.getByText(tEn.starting)).toBeInTheDocument();
  });
});
