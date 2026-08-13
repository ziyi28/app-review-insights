import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { getDictionary } from "@/i18n";
import { StageRail } from "./stage-rail";
import type { RunEvent } from "@/domain/contracts/events";

function event(type: RunEvent["type"], stage?: string): RunEvent {
  return {
    protocolVersion: "1",
    sequence: 1,
    eventId: `evt-${Math.random()}`,
    runId: "run-1",
    timestamp: "2026-08-12T00:00:00Z",
    deliveryMode: "live",
    type,
    stage: stage as never,
    data: {},
  };
}

const eventsThroughEvidence: RunEvent[] = [
  event("stage.started", "source"),
  event("stage.completed", "source"),
  event("stage.started", "prepare"),
  event("stage.completed", "prepare"),
  event("stage.started", "scope"),
  event("stage.completed", "scope"),
  event("stage.started", "topics"),
  event("stage.completed", "topics"),
  event("stage.started", "findings"),
  event("stage.completed", "findings"),
  event("stage.started", "evidence-validation"),
  event("stage.completed", "evidence-validation"),
];

describe("StageRail", () => {
  it("shows evidence-validation as completed between findings and planning", () => {
    render(<StageRail events={eventsThroughEvidence} t={getDictionary("en")} />);
    const item = screen.getByText("Evidence Validation").closest("li");
    expect(item).not.toBeNull();
    expect(item).toHaveTextContent("✓");
  });

  it("keeps Revision pending when no revision ran", () => {
    render(<StageRail events={eventsThroughEvidence} t={getDictionary("en")} />);
    const item = screen.getByText("Revision").closest("li");
    expect(item).not.toBeNull();
    expect(item).not.toHaveTextContent("✓");
  });

  it("shows Revision completed only after a revision stage", () => {
    const events = [...eventsThroughEvidence, event("stage.started", "revision"), event("stage.completed", "revision")];
    render(<StageRail events={events} t={getDictionary("en")} />);
    const item = screen.getByText("Revision").closest("li");
    expect(item).toHaveTextContent("✓");
  });
});
