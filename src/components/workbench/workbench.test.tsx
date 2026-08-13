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
});
