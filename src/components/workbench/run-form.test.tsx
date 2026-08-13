import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunForm } from "./run-form";
import { getDictionary } from "@/i18n";

const t = getDictionary("en");

function stubCatalogFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) }),
  );
}

describe("RunForm", () => {
  beforeEach(() => {
    stubCatalogFetch();
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
      // Switch from live (controlled text input) to import (uncontrolled file
      // input). Without key isolation React would reuse the same <input> node
      // and warn that a value changed from undefined to a defined value.
      await user.click(screen.getByRole("button", { name: t.importMode }));
      expect(screen.getByLabelText(t.importFile)).toBeInTheDocument();
      // Back to live and to replay to exercise all transitions. The replay
      // label also contains the "no data" hint, so match the label by regex.
      await user.click(screen.getByRole("button", { name: t.liveMode }));
      await user.click(screen.getByRole("button", { name: t.replayMode }));
      expect(screen.getByLabelText(new RegExp(t.cachedReplay))).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
    const warning = errors.find((e) => e.includes("uncontrolled input"));
    expect(warning).toBeUndefined();
  });

  it("submits an analyze request for the live mode", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RunForm t={t} onStart={onStart} />);
    await user.type(screen.getByLabelText(t.goal), "了解用户对付费订阅的主要痛点");
    await user.click(screen.getByRole("button", { name: t.start }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "analyze", goal: "了解用户对付费订阅的主要痛点" }),
    );
  });

  it("disables Start until the analysis goal is at least 10 characters", async () => {
    const user = userEvent.setup();
    render(<RunForm t={t} onStart={vi.fn()} />);
    const start = screen.getByRole("button", { name: t.start });
    // Default goal is empty: even with the URL prefilled, Start is disabled.
    expect(start).toBeDisabled();
    // A short non-empty goal keeps it disabled and shows an inline hint.
    await user.type(screen.getByLabelText(t.goal), "short");
    expect(start).toBeDisabled();
    expect(screen.getByText(t.goalTooShort)).toBeInTheDocument();
    // A long enough goal enables Start and clears the hint.
    await user.type(screen.getByLabelText(t.goal), " but long enough for the server");
    expect(start).toBeEnabled();
    expect(screen.queryByText(t.goalTooShort)).not.toBeInTheDocument();
  });
});
