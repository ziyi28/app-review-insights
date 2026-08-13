import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunForm } from "./run-form";
import { getDictionary } from "@/i18n";

const t = getDictionary("en");

function previewSummary(overrides: Partial<Record<"liveCount" | "stableCount" | "stableAvailable", number | boolean>> = {}) {
  const liveCount = (overrides.liveCount ?? 2) as number;
  const stableCount = (overrides.stableCount ?? 0) as number;
  const stableAvailable = (overrides.stableAvailable ?? stableCount > 0) as boolean;
  return {
    protocolVersion: "1",
    previewId: "preview-test",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
    createdAt: "2026-08-12T00:00:00.000Z",
    expiresAt: "2026-08-12T00:30:00.000Z",
    live: {
      status: liveCount > 0 ? "complete" : "suspect-empty",
      reviewCount: liveCount,
      pageCount: 1,
      requestCount: 1,
      dateRange: { earliest: null, latest: null },
      limitations: [],
    },
    stable: {
      available: stableAvailable,
      reviewCount: stableCount,
      cacheUpdatedAt: stableAvailable ? "2026-08-11T00:00:00.000Z" : null,
      dateRange: { earliest: null, latest: null },
      bootstrapRunId: null,
    },
    recommendedSelection: stableCount > liveCount ? "stable" : liveCount > 0 ? "live" : stableAvailable ? "stable" : null,
  };
}

function stubFetch(preview: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/source-previews")) {
      return { ok: true, json: async () => preview };
    }
    if (url.includes("/api/runs") && (init as RequestInit)?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ runs: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RunForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not emit the uncontrolled-to-controlled warning when switching modes", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const user = userEvent.setup();
      render(<RunForm t={t} onStart={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: t.importMode }));
      expect(screen.getByLabelText(t.importFile)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: t.liveMode }));
      await user.click(screen.getByRole("button", { name: t.replayMode }));
      expect(screen.getByLabelText(new RegExp(t.cachedReplay))).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
    const warning = errors.find((e) => e.includes("uncontrolled input"));
    expect(warning).toBeUndefined();
  });

  it("checks the sample first and lets the user pick the live dataset", async () => {
    const fetchMock = stubFetch(previewSummary({ liveCount: 2, stableCount: 0 }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await user.type(screen.getByLabelText(t.goal), "了解用户对付费订阅的主要痛点");
    await user.click(screen.getByRole("button", { name: t.checkSample }));

    // The preview request went out.
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/source-previews"), expect.objectContaining({ method: "POST" }));
    // Both choice cards render; live has 2 reviews.
    expect(screen.getByText(`${t.liveReviews}: 2`)).toBeInTheDocument();
    // Choosing the live sample starts the analysis with previewId + selection.
    await user.click(screen.getByRole("button", { name: t.chooseLive }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "analyze",
        goal: "了解用户对付费订阅的主要痛点",
        source: expect.objectContaining({ kind: "live", previewId: "preview-test", reviewSelection: "live" }),
      }),
    );
  });

  it("recommends the stable sample when it has more reviews", async () => {
    stubFetch(previewSummary({ liveCount: 50, stableCount: 500, stableAvailable: true }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await user.type(screen.getByLabelText(t.goal), "了解用户对付费订阅的主要痛点");
    await user.click(screen.getByRole("button", { name: t.checkSample }));

    expect(screen.getByText(t.recommended)).toBeInTheDocument();
    expect(screen.getByText(`${t.stableReviews}: 500`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.chooseStable }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ reviewSelection: "stable" }),
      }),
    );
  });

  it("disables the live option when live has 0 reviews", async () => {
    stubFetch(previewSummary({ liveCount: 0, stableCount: 500, stableAvailable: true }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await user.type(screen.getByLabelText(t.goal), "了解用户对付费订阅的主要痛点");
    await user.click(screen.getByRole("button", { name: t.checkSample }));

    // The live option is hidden entirely (no choose-live button), and the
    // stable choice remains available.
    expect(screen.queryByRole("button", { name: t.chooseLive })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.chooseStable })).toBeEnabled();
  });

  it("clears the checked preview when the URL changes", async () => {
    stubFetch(previewSummary({ liveCount: 2, stableCount: 0 }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await user.type(screen.getByLabelText(t.goal), "了解用户对付费订阅的主要痛点");
    await user.click(screen.getByRole("button", { name: t.checkSample }));
    expect(screen.getByText(`${t.liveReviews}: 2`)).toBeInTheDocument();

    const urlInput = screen.getByLabelText(t.appStoreUrl);
    await user.clear(urlInput);
    await user.type(urlInput, "https://apps.apple.com/us/app/another-app/id123");
    // The sample is gone; the hint returns.
    expect(screen.queryByText(`${t.liveReviews}: 2`)).not.toBeInTheDocument();
    expect(screen.getByText(t.notChecked)).toBeInTheDocument();
  });

  it("disables Start until the analysis goal is at least 10 characters", async () => {
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    const check = screen.getByRole("button", { name: t.checkSample });
    expect(check).toBeDisabled();
    await user.type(screen.getByLabelText(t.goal), "short");
    expect(check).toBeDisabled();
    expect(screen.getByText(t.goalTooShort)).toBeInTheDocument();
    await user.type(screen.getByLabelText(t.goal), " but long enough for the server");
    expect(check).toBeEnabled();
    expect(screen.queryByText(t.goalTooShort)).not.toBeInTheDocument();
  });
});
