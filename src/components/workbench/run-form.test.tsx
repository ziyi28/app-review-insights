import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunForm } from "./run-form";
import { getDictionary } from "@/i18n";

const t = getDictionary("en");

function previewSummary(
  overrides: Partial<
    Record<"liveCount" | "stableCount" | "stableAvailable" | "provider" | "searchCount", number | boolean | string | null> & {
      limitations?: { code: string; message: string }[];
    }
  > = {},
) {
  const liveCount = (overrides.liveCount ?? 2) as number;
  const stableCount = (overrides.stableCount ?? 0) as number;
  const stableAvailable = (overrides.stableAvailable ?? stableCount > 0) as boolean;
  const provider = (overrides.provider ?? "apple-rss") as "serpapi" | "apple-rss";
  const searchCount = (overrides.searchCount ?? (provider === "serpapi" ? 1 : 0)) as number;
  return {
    protocolVersion: "1",
    previewId: "preview-test",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
    createdAt: "2026-08-12T00:00:00.000Z",
    expiresAt: "2026-08-12T00:30:00.000Z",
    live: {
      provider,
      forcedRefresh: provider === "serpapi",
      cached: false,
      collectedAt: "2026-08-12T00:00:00.000Z",
      status: liveCount > 0 ? "complete" : "suspect-empty",
      reviewCount: liveCount,
      pageCount: 1,
      requestCount: 1,
      dateRange: { earliest: null, latest: null },
      limitations: (overrides.limitations as { code: string; message: string }[] | undefined) ?? [],
      searchCount,
      searchId: provider === "serpapi" ? "search_page_1" : null,
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

/** Step 1 → live mode card, then fill URL + goal and advance to the confirm step. */
async function navigateToLiveConfirm(user: ReturnType<typeof userEvent.setup>, goalText: string, urlText = "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684") {
  await user.click(screen.getByRole("radio", { name: new RegExp(t.liveMode) }));
  await user.type(screen.getByLabelText(t.appStoreUrl), urlText);
  await user.type(screen.getByLabelText(t.goal), goalText);
  await user.click(screen.getByRole("button", { name: t.next }));
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
      // Step 1 offers only live and import sources (replay moved to history).
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      // Step 1 → import mode shows the file input.
      await user.click(screen.getByRole("radio", { name: new RegExp(t.importMode) }));
      expect(screen.getByLabelText(t.importFile)).toBeInTheDocument();
      // Back to step 1, then live mode shows the URL input.
      await user.click(screen.getByRole("button", { name: t.back }));
      await user.click(screen.getByRole("radio", { name: new RegExp(t.liveMode) }));
      expect(screen.getByLabelText(t.appStoreUrl)).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
    const warning = errors.find((e) => e.includes("uncontrolled input"));
    expect(warning).toBeUndefined();
  });

  it("checks the sample on confirm and lets the user pick the live dataset", async () => {
    const fetchMock = stubFetch(previewSummary({ liveCount: 2, stableCount: 0 }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    // Entering the confirm step auto-checks the sample.
    expect(await screen.findByText(`2 ${t.freshReviews}`)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/source-previews"), expect.objectContaining({ method: "POST" }));

    // Choosing the live sample starts the analysis with previewId + selection.
    await user.click(screen.getByRole("button", { name: t.analyzeFresh }));
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
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    expect(await screen.findByText(t.recommended)).toBeInTheDocument();
    expect(screen.getByText(`500 ${t.localHistoryReviews}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.analyzeHistory }));
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
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    // The live option is hidden entirely (no analyze-fresh button), and the
    // stable choice remains available.
    expect(await screen.findByRole("button", { name: t.analyzeHistory })).toBeEnabled();
    expect(screen.queryByRole("button", { name: t.analyzeFresh })).not.toBeInTheDocument();
  });

  it("clears the checked preview when the URL changes", async () => {
    stubFetch(previewSummary({ liveCount: 2, stableCount: 0 }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");
    expect(await screen.findByText(`2 ${t.freshReviews}`)).toBeInTheDocument();

    // Go back, change the URL, and advance again: the stale preview is gone and
    // a fresh check runs.
    await user.click(screen.getByRole("button", { name: t.back }));
    const urlInput = screen.getByLabelText(t.appStoreUrl);
    await user.clear(urlInput);
    await user.type(urlInput, "https://apps.apple.com/us/app/another-app/id123");
    await user.click(screen.getByRole("button", { name: t.next }));
    expect(await screen.findByText(`2 ${t.freshReviews}`)).toBeInTheDocument();
  });

  it("disables Next until the analysis goal is at least 10 characters", async () => {
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: new RegExp(t.liveMode) }));
    await user.type(screen.getByLabelText(t.appStoreUrl), "https://apps.apple.com/us/app/x/id123");

    const next = screen.getByRole("button", { name: t.next });
    expect(next).toBeDisabled();
    await user.type(screen.getByLabelText(t.goal), "short");
    expect(next).toBeDisabled();
    expect(screen.getByText(t.goalTooShort)).toBeInTheDocument();
    await user.type(screen.getByLabelText(t.goal), " but long enough for the server");
    expect(next).toBeEnabled();
    expect(screen.queryByText(t.goalTooShort)).not.toBeInTheDocument();
  });

  it("shows forced-fresh SerpApi reviews and the number of searches", async () => {
    stubFetch(previewSummary({ provider: "serpapi", liveCount: 500, searchCount: 2 }));
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    expect(await screen.findByText(`500 ${t.freshReviews}`)).toBeVisible();
    expect(screen.getByText(t.serpApiFresh)).toBeVisible();
    expect(screen.getByText(`${t.searchesUsed}: 2`)).toBeVisible();
    expect(screen.getByRole("button", { name: t.analyzeFresh })).toBeEnabled();
  });

  it("shows the actual sanitized fallback reason instead of a fixed credits message", async () => {
    stubFetch(previewSummary({ provider: "apple-rss", liveCount: 50, limitations: [{ code: "SERPAPI_UPSTREAM_FAILED", message: "SerpApi request failed (HTTP 503)" }] }));
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    expect(await screen.findByText(t.appleRssFallback)).toBeVisible();
    expect(screen.getByText(/HTTP 503/)).toBeVisible();
    expect(screen.queryByText(/credits unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(t.serpApiFresh)).not.toBeInTheDocument();
  });

  it("keeps local history separate from the live provider", async () => {
    stubFetch(previewSummary({ provider: "serpapi", liveCount: 50, stableCount: 500, stableAvailable: true }));
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    expect(await screen.findByText(`50 ${t.freshReviews}`)).toBeVisible();
    expect(screen.getByText(`500 ${t.localHistoryReviews}`)).toBeVisible();
  });

  it("defaults the review count to 100 and sends it with the preview request", async () => {
    const fetchMock = stubFetch(previewSummary({ liveCount: 2, stableCount: 0 }));
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");

    expect(await screen.findByText(`2 ${t.freshReviews}`)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/source-previews"));
    expect(call).toBeDefined();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({ reviewLimit: 100 });
  });

  it("sends the chosen review count and invalidates the previous preview on change", async () => {
    const fetchMock = stubFetch(previewSummary({ liveCount: 2, stableCount: 0 }));
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    await navigateToLiveConfirm(user, "了解用户对付费订阅的主要痛点");
    expect(await screen.findByText(`2 ${t.freshReviews}`)).toBeInTheDocument();

    // Go back to step 2, switch the count, and the stale preview is cleared.
    await user.click(screen.getByRole("button", { name: t.back }));
    const select = screen.getByLabelText(t.reviewLimit);
    await user.selectOptions(select, "300");
    expect(screen.queryByText(`2 ${t.freshReviews}`)).not.toBeInTheDocument();

    // Re-checking sends the new limit.
    await user.click(screen.getByRole("button", { name: t.next }));
    expect(await screen.findByText(`2 ${t.freshReviews}`)).toBeInTheDocument();
    const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/source-previews"));
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String((calls[1][1] as RequestInit).body))).toMatchObject({ reviewLimit: 300 });
  });

  it("does not show the review count control in import mode", async () => {
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: new RegExp(t.importMode) }));
    expect(screen.queryByLabelText(t.reviewLimit)).not.toBeInTheDocument();
  });
});
