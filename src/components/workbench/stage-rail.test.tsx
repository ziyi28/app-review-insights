import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("shows elapsed duration on completed stages from the completed event", () => {
    const ev = (type: RunEvent["type"], stage?: string, ts = "2026-08-12T00:00:00Z", data: unknown = {}): RunEvent => ({
      ...event(type, stage),
      timestamp: ts,
      data,
    });
    const events = [
      ev("stage.started", "topics", "2026-08-12T00:00:00Z"),
      ev("stage.completed", "topics", "2026-08-12T00:01:35Z", { stage: "topics", durationMs: 95_000 }),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);
    const item = screen.getByText("Topics").closest("li");
    expect(item).toHaveTextContent("✓ 1m 35s");
  });

  it("shows live elapsed time and batch count for the running stage", () => {
    const ev = (type: RunEvent["type"], stage?: string, ts = "2026-08-12T00:00:00Z", data: unknown = {}): RunEvent => ({
      ...event(type, stage),
      timestamp: ts,
      data,
    });
    const events = [
      ev("stage.started", "topics", "2026-08-12T00:00:00Z"),
      ev("stage.progress", "topics", "2026-08-12T00:00:30Z", { message: "analyzing review batch 2 of 5 in parallel" }),
      // The newest event timestamp is the "now" used for the running stage.
      ev("stage.progress", "topics", "2026-08-12T00:02:00Z", { message: "generating findings" }),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);
    const item = screen.getByText("Topics").closest("li");
    expect(item).toHaveTextContent("2m");
    expect(item).toHaveTextContent("batch 2/5");
  });

  it("marks unexecuted stages as Skipped after a run.completed event, not waiting", () => {
    const events = [...eventsThroughEvidence, event("run.completed", undefined)];
    render(<StageRail events={events} t={getDictionary("en")} />);
    // A stage that never started reads "Skipped" once the run is terminal. The
    // skipped status must be a visible element, not only sr-only text.
    const revisionItem = screen.getByText("Revision").closest("li");
    expect(revisionItem).not.toBeNull();
    const skippedStatus = within(revisionItem!).getByText("Skipped", { exact: true });
    expect(skippedStatus).toBeVisible();
    expect(revisionItem).not.toHaveTextContent(/enter a url/i);
    // The stages that did run still read completed.
    const findingsItem = screen.getByText("Findings").closest("li");
    expect(findingsItem).toHaveTextContent("✓");
  });

  it("marks every unstarted downstream stage Skipped on an early insufficient-data completion", () => {
    // Only source + prepare ran before the run short-circuited.
    const events = [
      event("stage.started", "source"),
      event("stage.completed", "source"),
      event("stage.started", "prepare"),
      event("stage.completed", "prepare"),
      event("run.completed", undefined),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);
    for (const label of ["Scope", "Topics", "Findings", "Planning", "Tests", "Traceability", "Revision"]) {
      const item = screen.getByText(label).closest("li");
      expect(item).not.toBeNull();
      expect(within(item!).getByText("Skipped", { exact: true })).toBeVisible();
    }
    const sourceItem = screen.getByText("Source").closest("li");
    expect(sourceItem).toHaveTextContent("✓");
  });

  it("shows completed stages as completed and unstarted ones as Skipped on a failed run", () => {
    const events = [
      event("stage.started", "source"),
      event("stage.completed", "source"),
      event("stage.started", "prepare"),
      event("stage.completed", "prepare"),
      event("run.failed", undefined),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);
    expect(screen.getByText("Source").closest("li")).toHaveTextContent("✓");
    expect(screen.getByText("Prepare").closest("li")).toHaveTextContent("✓");
    const findingsItem = screen.getByText("Findings").closest("li");
    expect(findingsItem).not.toBeNull();
    expect(within(findingsItem!).getByText("Skipped", { exact: true })).toBeVisible();
  });

  it("keeps unstarted stages as waiting when there is no terminal event (interrupted)", () => {
    // No run.completed/run.failed: an interrupted run must not claim skipped.
    render(<StageRail events={eventsThroughEvidence} t={getDictionary("en")} />);
    const revisionItem = screen.getByText("Revision").closest("li");
    expect(revisionItem).toHaveTextContent(/enter a url/i);
    expect(revisionItem).not.toHaveTextContent(/skipped/i);
  });

  it("still shows Revision completed with duration when it actually ran", () => {
    const events = [
      ...eventsThroughEvidence,
      event("stage.started", "revision"),
      event("stage.completed", "revision"),
      event("run.completed", undefined),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);
    const item = screen.getByText("Revision").closest("li");
    expect(item).toHaveTextContent("✓");
    expect(item).not.toHaveTextContent(/skipped/i);
  });

  // run.completed / run.failed: 未开始阶段显示可见的 Skipped。
  it.each([
    ["run.completed", "run.completed"],
    ["run.failed", "run.failed"],
  ] as const)("shows a visible Skipped on unstarted stages after %s", (_name, terminal) => {
    const events = [...eventsThroughEvidence, event(terminal as "run.completed", undefined)];
    render(<StageRail events={events} t={getDictionary("en")} />);
    const revisionItem = screen.getByText("Revision").closest("li");
    expect(revisionItem).not.toBeNull();
    expect(within(revisionItem!).getByText("Skipped", { exact: true })).toBeVisible();
  });

  // interrupted：没有 terminal event，未开始阶段不显示 Skipped。
  it("keeps unstarted stages without a visible Skipped when interrupted (no terminal event)", () => {
    render(<StageRail events={eventsThroughEvidence} t={getDictionary("en")} />);
    const revisionItem = screen.getByText("Revision").closest("li");
    expect(revisionItem).not.toBeNull();
    expect(within(revisionItem!).queryByText("Skipped", { exact: true })).not.toBeInTheDocument();
  });

  // revision 确实执行完成：不显示 Skipped，且显示完成标记。
  it("does not show Skipped when revision actually completed", () => {
    const events = [
      ...eventsThroughEvidence,
      event("stage.started", "revision"),
      event("stage.completed", "revision"),
      event("run.completed", undefined),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);
    const revisionItem = screen.getByText("Revision").closest("li");
    expect(revisionItem).not.toBeNull();
    expect(within(revisionItem!).queryByText("Skipped", { exact: true })).not.toBeInTheDocument();
    expect(revisionItem).toHaveTextContent("✓");
  });

  // 缺陷：run.failed 后，执行中的阶段必须显示 Failed，不得继续显示 Running。
  it("marks the in-flight stage Failed and unstarted stages Skipped after run.failed", () => {
    const events = [
      event("stage.started", "source"),
      event("stage.completed", "source"),
      event("stage.started", "prepare"),
      event("stage.completed", "prepare"),
      event("stage.started", "scope"),
      event("stage.completed", "scope"),
      event("stage.started", "topics"),
      event("run.failed", undefined),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);

    const topicsItem = screen.getByText("Topics").closest("li");
    expect(topicsItem).not.toBeNull();
    const failedStatus = within(topicsItem!).getByText("Failed", { exact: true });
    expect(failedStatus).toBeVisible();
    expect(topicsItem).not.toHaveTextContent("Running");
    expect(topicsItem).not.toHaveTextContent("Skipped");

    // 尚未开始的后续阶段显示可见 Skipped。
    const planningItem = screen.getByText("Planning").closest("li");
    expect(planningItem).not.toBeNull();
    expect(within(planningItem!).getByText("Skipped", { exact: true })).toBeVisible();
    const testsItem = screen.getByText("Tests").closest("li");
    expect(testsItem).not.toBeNull();
    expect(within(testsItem!).getByText("Skipped", { exact: true })).toBeVisible();
  });

  // 强化 interrupted 测试：没有终态事件时，进行中的阶段仍显示 Running，
  // 后续阶段仍是 Waiting，绝不误报为 Skipped 或 Failed。
  it("keeps the in-flight stage Running and downstream stages Waiting when interrupted", () => {
    const events = [
      event("stage.started", "source"),
      event("stage.completed", "source"),
      event("stage.started", "topics"),
    ];
    render(<StageRail events={events} t={getDictionary("en")} />);

    const topicsItem = screen.getByText("Topics").closest("li");
    expect(topicsItem).not.toBeNull();
    expect(screen.getByText(/Topics: Analysis running/)).toBeInTheDocument();
    expect(topicsItem).not.toHaveTextContent("Failed");
    expect(topicsItem).not.toHaveTextContent("Skipped");

    const planningItem = screen.getByText("Planning").closest("li");
    expect(planningItem).not.toBeNull();
    expect(planningItem).toHaveTextContent(/enter a url/i);
    expect(planningItem).not.toHaveTextContent(/skipped/i);
  });
});
