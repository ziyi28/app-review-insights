"use client";

import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";

const STAGE_ORDER = ["source", "prepare", "scope", "topics", "findings", "planning", "tests", "traceability", "revision"] as const;
export const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], keyof Dictionary> = {
  source: "stageSource",
  prepare: "stagePrepare",
  scope: "stageScope",
  topics: "stageTopics",
  findings: "stageFindings",
  planning: "stagePlanning",
  tests: "stageTests",
  traceability: "stageTraceability",
  revision: "stageRevision",
};

export function StageRail({ events, t }: { events: RunEvent[]; t: Dictionary }) {
  const doneStages = new Set<string>();
  let currentStage: string | null = null;
  let failed = false;
  for (const e of events) {
    if (e.type === "stage.completed") doneStages.add(e.stage ?? "");
    if (e.type === "stage.started" && e.stage) currentStage = e.stage;
    if (e.type === "run.failed") failed = true;
  }

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "4px" }}>
      {STAGE_ORDER.map((stage) => {
        const label = t[STAGE_LABELS[stage]];
        const done = doneStages.has(stage);
        const current = currentStage === stage && !done;
        return (
          <li key={stage} style={{ display: "flex", alignItems: "center", gap: "8px", opacity: done || current ? 1 : 0.55 }}>
            <span
              aria-label={label}
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: done ? "var(--ok)" : current ? "var(--accent)" : "var(--border)",
                flexShrink: 0,
              }}
            />
            <span>{label}</span>
            {done ? <span style={{ color: "var(--ok)", fontSize: "12px" }}>✓</span> : null}
          </li>
        );
      })}
      {failed ? (
        <li style={{ color: "var(--danger)", fontWeight: 600 }}>✗</li>
      ) : null}
    </ol>
  );
}
