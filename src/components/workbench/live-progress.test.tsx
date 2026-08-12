import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveProgress } from "./live-progress";
import { getDictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";

const t = getDictionary("en");

function event(overrides: Partial<RunEvent>): RunEvent {
  return {
    protocolVersion: "1",
    sequence: 1,
    eventId: "e1",
    runId: "run-1",
    timestamp: "2026-08-12T00:00:00.000Z",
    deliveryMode: "live",
    type: "stage.progress",
    stage: "topics",
    data: {},
    ...overrides,
  };
}

describe("LiveProgress", () => {
  it("renders the latest progress message for the current stage while running", () => {
    const events = [
      event({ type: "stage.started", sequence: 1, data: { stage: "topics" } }),
      event({ type: "stage.progress", sequence: 2, data: { message: "analyzing review batch 2 of 5" } }),
    ];
    render(<LiveProgress events={events} running t={t} />);
    expect(screen.getByText(/analyzing review batch 2 of 5/)).toBeInTheDocument();
    expect(screen.getByText(`${t.stageTopics}:`)).toBeInTheDocument();
  });

  it("does not render when the run is not running", () => {
    render(<LiveProgress events={[]} running={false} t={t} />);
    expect(screen.queryByText(/batch/)).not.toBeInTheDocument();
  });

  it("does not render when the stage completed or no progress message exists", () => {
    const events = [
      event({ type: "stage.started", sequence: 1, data: { stage: "topics" } }),
      event({ type: "stage.completed", sequence: 2, stage: "topics", data: { stage: "topics" } }),
    ];
    render(<LiveProgress events={events} running t={t} />);
    expect(screen.queryByText(`${t.stageTopics}:`)).not.toBeInTheDocument();
  });

  it("shows only the latest message for the current stage", () => {
    const events = [
      event({ type: "stage.started", sequence: 1, data: { stage: "topics" } }),
      event({ type: "stage.progress", sequence: 2, data: { message: "batch 1 of 2" } }),
      event({ type: "stage.progress", sequence: 3, data: { message: "batch 2 of 2" } }),
    ];
    render(<LiveProgress events={events} running t={t} />);
    expect(screen.getByText(/batch 2 of 2/)).toBeInTheDocument();
    expect(screen.queryByText(/batch 1 of 2/)).not.toBeInTheDocument();
  });
});
