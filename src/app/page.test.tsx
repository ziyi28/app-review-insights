import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("workbench shell", () => {
  it("renders the bilingual workbench heading and a sample-check action", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: /App Review Planner/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check review sample|检查评论样本/i })).toBeInTheDocument();
  });
});
