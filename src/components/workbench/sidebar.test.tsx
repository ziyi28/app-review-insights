import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "./sidebar";
import { getDictionary } from "@/i18n";

const t = getDictionary("zh-CN");

describe("Sidebar", () => {
  it("renders pipeline navigation items with proper accessibility attributes", () => {
    render(
      <Sidebar
        activeTab="overview"
        onSelectTab={vi.fn()}
        viewMode="workbench"
        onSelectViewMode={vi.fn()}
        t={t}
      />
    );

    // Overview tab should be selected
    const overviewTab = screen.getByRole("tab", { name: new RegExp(t.overview) });
    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    expect(overviewTab).toHaveAttribute("aria-controls", "panel-overview");

    // Other tabs should not be selected
    const cleanedTab = screen.getByRole("tab", { name: new RegExp(t.cleanedData) });
    expect(cleanedTab).toHaveAttribute("aria-selected", "false");
  });

  it("handles tab click and triggers onSelectTab and onUserNavigate", async () => {
    const onSelectTab = vi.fn();
    const onUserNavigate = vi.fn();
    const user = userEvent.setup();

    render(
      <Sidebar
        activeTab="overview"
        onSelectTab={onSelectTab}
        viewMode="workbench"
        onSelectViewMode={vi.fn()}
        t={t}
        onUserNavigate={onUserNavigate}
      />
    );

    const prdTab = screen.getByRole("tab", { name: new RegExp(t.prd) });
    await user.click(prdTab);

    expect(onSelectTab).toHaveBeenCalledWith("prd");
    expect(onUserNavigate).toHaveBeenCalled();
  });
});
