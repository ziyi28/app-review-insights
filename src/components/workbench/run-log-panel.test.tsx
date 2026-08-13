import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunLogPanel } from "./run-log-panel";
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
    data: {},
    ...overrides,
  };
}

const events: RunEvent[] = [
  event({ sequence: 1, type: "run.accepted" }),
  event({ sequence: 2, type: "stage.started", stage: "topics", data: { stage: "topics" } }),
  event({ sequence: 3, type: "stage.progress", stage: "topics", data: { message: "analyzing review batch 2 of 5" } }),
  event({ sequence: 4, type: "limitation.reported", data: { code: "RSS_PARTIAL", message: "partial data" } }),
  event({ sequence: 5, type: "run.completed" }),
];

describe("RunLogPanel", () => {
  it("renders the event count and summary stats", () => {
    render(<RunLogPanel events={events} t={t} />);
    // Stat cards render a value + label. Scope by the .stat-card container.
    const statFor = (label: string) => screen.getAllByText(label).map((el) => el.closest(".stat-card")).find(Boolean);
    expect(statFor(t.eventCount)).toHaveTextContent("5");
    expect(statFor(t.diagnosticsWarning)).toHaveTextContent("1");
    expect(statFor(t.diagnosticsError)).toHaveTextContent("0");
    expect(statFor(t.diagnosticsValidation)).toHaveTextContent("0");
  });

  it("lists events with sequence, stage, type, and message", () => {
    render(<RunLogPanel events={events} t={t} />);
    // The event table body holds the event rows; scope queries to it so the
    // stage/type filter dropdown options do not collide.
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("topics").length).toBeGreaterThan(0);
    expect(within(table).getByText(/analyzing review batch 2 of 5/)).toBeInTheDocument();
    expect(within(table).getByText("limitation.reported")).toBeInTheDocument();
    expect(within(table).getByText(/partial data/)).toBeInTheDocument();
  });

  it("filters events by type", async () => {
    const user = userEvent.setup();
    render(<RunLogPanel events={events} t={t} />);
    const typeSelect = screen.getByLabelText(t.filterByEventType);
    await user.selectOptions(typeSelect, "run.completed");
    const table = screen.getByRole("table");
    expect(within(table).getByText("run.completed")).toBeInTheDocument();
    expect(within(table).queryByText("limitation.reported")).not.toBeInTheDocument();
  });
});
