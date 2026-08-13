"use client";

import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";

const STAGE_ORDER = ["source", "prepare", "scope", "topics", "findings", "evidence-validation", "planning", "tests", "traceability", "revision"] as const;
export const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], keyof Dictionary> = {
  source: "stageSource",
  prepare: "stagePrepare",
  scope: "stageScope",
  topics: "stageTopics",
  findings: "stageFindings",
  "evidence-validation": "stageEvidenceValidation",
  planning: "stagePlanning",
  tests: "stageTests",
  traceability: "stageTraceability",
  revision: "stageRevision",
};

type StageTiming = { startedAt?: string; finishedAt?: string; durationMs?: number };

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** Latest progress "batch N of M" for a stage, if any. */
function batchProgress(events: RunEvent[], stage: string): { done: number; total: number } | null {
  let last: { done: number; total: number } | null = null;
  for (const e of events) {
    if (e.type !== "stage.progress" || e.stage !== stage) continue;
    const message = (e.data as { message?: unknown } | undefined)?.message;
    if (typeof message !== "string") continue;
    const m = message.match(/batch (\d+) of (\d+)/);
    if (m) last = { done: Number(m[1]), total: Number(m[2]) };
  }
  return last;
}

export function StageRail({ events, t }: { events: RunEvent[]; t: Dictionary }) {
  const timings = new Map<string, StageTiming>();
  let currentStage: string | null = null;
  let failed = false;
  // "Now" for an in-flight stage is the newest event timestamp: the rail is
  // re-rendered as events stream, so the elapsed time stays live.
  let latestTs = events[0]?.timestamp;
  for (const e of events) {
    if (e.timestamp) latestTs = e.timestamp;
    if (e.type === "stage.started" && e.stage) {
      timings.set(e.stage, { ...(timings.get(e.stage) ?? {}), startedAt: e.timestamp });
      currentStage = e.stage;
    }
    if (e.type === "stage.completed" && e.stage) {
      const durationMs = (e.data as { durationMs?: number } | undefined)?.durationMs;
      timings.set(e.stage, {
        ...(timings.get(e.stage) ?? {}),
        finishedAt: e.timestamp,
        durationMs: typeof durationMs === "number" ? durationMs : undefined,
      });
      if (currentStage === e.stage) currentStage = null;
    }
    if (e.type === "run.failed") failed = true;
  }

  const elapsedFor = (stage: string): string | null => {
    const timing = timings.get(stage);
    if (timing?.startedAt == null) return null;
    const end = timing.finishedAt ?? latestTs;
    if (end == null) return null;
    const ms = new Date(end).getTime() - new Date(timing.startedAt).getTime();
    return formatDuration(ms);
  };

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "4px" }}>
      {STAGE_ORDER.map((stage) => {
        const label = t[STAGE_LABELS[stage]];
        const done = timings.get(stage)?.finishedAt != null;
        const current = currentStage === stage && !done;
        const duration = elapsedFor(stage);
        const batch = current ? batchProgress(events, stage) : null;
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
            {done ? (
              <span style={{ color: "var(--ok)", fontSize: "12px" }}>✓{duration != null ? ` ${duration}` : ""}</span>
            ) : current && duration != null ? (
              <span style={{ color: "var(--accent)", fontSize: "12px" }}>{duration}</span>
            ) : null}
            {current && batch ? (
              <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                {t.stageBatch} {batch.done}/{batch.total}
              </span>
            ) : null}
          </li>
        );
      })}
      {failed ? (
        <li style={{ color: "var(--danger)", fontWeight: 600 }}>✗</li>
      ) : null}
    </ol>
  );
}
