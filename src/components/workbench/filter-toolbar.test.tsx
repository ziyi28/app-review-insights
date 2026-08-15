import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilterToolbar } from "./filter-toolbar";
import { getDictionary } from "@/i18n";

const t = getDictionary("zh-CN");

describe("FilterToolbar", () => {
  it("renders search input and counter", () => {
    const onSearch = vi.fn();
    render(
      <FilterToolbar
        search=""
        onSearchChange={onSearch}
        totalCount={10}
        filteredCount={5}
        t={t}
      />,
    );

    const input = screen.getByPlaceholderText(t.filterSearchPlaceholder);
    expect(input).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText(/10/)).toBeDefined();

    fireEvent.change(input, { target: { value: "login" } });
    expect(onSearch).toHaveBeenCalledWith("login");
  });

  it("handles priority pills filtering", () => {
    const onPriority = vi.fn();
    render(
      <FilterToolbar
        search=""
        onSearchChange={vi.fn()}
        priorityFilter="all"
        onPriorityChange={onPriority}
        totalCount={10}
        filteredCount={10}
        t={t}
      />,
    );

    const p0Btn = screen.getByRole("button", { name: "P0" });
    fireEvent.click(p0Btn);
    expect(onPriority).toHaveBeenCalledWith("P0");
  });

  it("handles clear search button", () => {
    const onSearch = vi.fn();
    render(
      <FilterToolbar
        search="active keyword"
        onSearchChange={onSearch}
        totalCount={10}
        filteredCount={2}
        t={t}
      />,
    );

    const clearBtn = screen.getByRole("button", { name: t.cancel });
    fireEvent.click(clearBtn);
    expect(onSearch).toHaveBeenCalledWith("");
  });
});
