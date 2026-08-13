import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabList } from "./tab-list";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "raw", label: "Raw" },
  { id: "cleaned", label: "Cleaned" },
];

describe("TabList", () => {
  it("renders tabs with proper tab semantics", () => {
    render(<TabList tabs={TABS} active="overview" onSelect={vi.fn()} label="Results" />);
    const tablist = screen.getByRole("tablist", { name: "Results" });
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-controls", "panel-overview");
    // Non-active tabs are not in the tab order.
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
  });

  it("selects a tab on click and marks it active", async () => {
    const onSelect = vi.fn();
    const onUserNavigate = vi.fn();
    const user = userEvent.setup();
    render(<TabList tabs={TABS} active="overview" onSelect={onSelect} onUserNavigate={onUserNavigate} label="Results" />);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(onUserNavigate).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("raw");
  });

  it("moves focus with arrow keys and selects on Enter", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TabList tabs={TABS} active="overview" onSelect={onSelect} label="Results" />);
    const first = screen.getByRole("tab", { name: "Overview" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenCalledWith("raw");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("raw");
  });

  it("wraps ArrowLeft from the first tab to the last, and supports Home/End", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TabList tabs={TABS} active="overview" onSelect={onSelect} label="Results" />);
    const first = screen.getByRole("tab", { name: "Overview" });
    first.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenCalledWith("cleaned");
    await user.keyboard("{End}");
    expect(onSelect).toHaveBeenCalledWith("cleaned");
    await user.keyboard("{Home}");
    expect(onSelect).toHaveBeenCalledWith("overview");
  });
});
