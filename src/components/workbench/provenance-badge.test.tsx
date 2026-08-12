import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProvenanceBadge } from "./provenance-badge";

describe("ProvenanceBadge", () => {
  it("renders the label text", () => {
    render(<ProvenanceBadge kind="ai-generated" label="AI-generated" />);
    expect(screen.getByText("AI-generated")).toBeInTheDocument();
  });

  it("renders a limitation badge with the label", () => {
    render(<ProvenanceBadge kind="limitation" label="Limitations" />);
    expect(screen.getByText("Limitations")).toBeInTheDocument();
  });
});
