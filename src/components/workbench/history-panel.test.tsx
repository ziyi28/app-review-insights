import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryPanel } from "./history-panel";
import { getDictionary } from "@/i18n";

const tEn = getDictionary("en");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HistoryPanel", () => {
  it("lists runs with status, goal, and view/replay actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          runs: [
            { runId: "run-a", status: "completed", createdAt: "2026-08-12T00:00:00Z", canReplay: true, goal: "Understand pricing", executionMode: "live" },
            { runId: "run-b", status: "failed", createdAt: "2026-08-11T00:00:00Z", canReplay: false, goal: "Churn analysis", executionMode: "import" },
          ],
        }),
      }),
    );

    const onView = vi.fn();
    const onReplay = vi.fn();
    const user = userEvent.setup();
    render(<HistoryPanel t={tEn} open onClose={vi.fn()} onView={onView} onReplay={onReplay} />);

    await waitFor(() => {
      expect(screen.getByText("Understand pricing")).toBeInTheDocument();
    });
    expect(screen.getByText("Churn analysis")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();

    // The failed run is not replayable, so it has no Replay button.
    expect(screen.getAllByRole("button", { name: tEn.view })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: tEn.replay })).toHaveLength(1);

    await user.click(screen.getAllByRole("button", { name: tEn.view })[0]);
    expect(onView).toHaveBeenCalledWith("run-a");

    await user.click(screen.getByRole("button", { name: tEn.replay }));
    expect(onReplay).toHaveBeenCalledWith("run-a");
  });

  it("renders app links, filenames, and retry button for failed runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          runs: [
            {
              runId: "run-live",
              status: "failed",
              createdAt: "2026-08-12T00:00:00Z",
              canReplay: false,
              canRetry: true,
              goal: "Improve retention",
              executionMode: "live",
              appName: "Workout For Women",
              appUrl: "https://apps.apple.com/us/app/workout-for-women/id839285684",
            },
            {
              runId: "run-import",
              status: "completed",
              createdAt: "2026-08-11T00:00:00Z",
              canReplay: true,
              canRetry: false,
              goal: "Feature requests",
              executionMode: "import",
              fileName: "feedback_sample.csv",
            },
          ],
        }),
      }),
    );

    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<HistoryPanel t={tEn} open onClose={vi.fn()} onView={vi.fn()} onReplay={vi.fn()} onRetry={onRetry} />);

    await waitFor(() => {
      expect(screen.getByText("Workout For Women")).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: /Workout For Women/i });
    expect(link).toHaveAttribute("href", "https://apps.apple.com/us/app/workout-for-women/id839285684");
    expect(link).toHaveAttribute("target", "_blank");

    expect(screen.getByText(/feedback_sample\.csv/)).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: tEn.retry });
    expect(retryBtn).toBeInTheDocument();

    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith("run-live");
  });

  it("shows an empty state when there are no runs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) }));
    render(<HistoryPanel t={tEn} open onClose={vi.fn()} onView={vi.fn()} onReplay={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(tEn.historyEmpty)).toBeInTheDocument();
    });
  });
});
