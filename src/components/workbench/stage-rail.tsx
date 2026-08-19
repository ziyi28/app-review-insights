"use client";

import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";

const STAGE_ORDER = ["source", "prepare", "scope", "topics", "findings", "evidence-validation", "planning", "requirement-evidence", "tests", "traceability", "revision"] as const;
export const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], keyof Dictionary> = {
  source: "stageSource",
  prepare: "stagePrepare",
  scope: "stageScope",
  topics: "stageTopics",
  findings: "stageFindings",
  "evidence-validation": "stageEvidenceValidation",
  planning: "stagePlanning",
  "requirement-evidence": "stageRequirementEvidence",
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
  // A run that reached a terminal event (completed/failed) is over: any stage
  // that never started is genuinely SKIPPED, not waiting for input. An
  // interrupted run (no terminal event yet) keeps its unstarted stages as
  // waiting — we cannot know they were skipped.
  let hasTerminal = false;
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
    if (e.type === "run.completed" || e.type === "run.failed") hasTerminal = true;
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
        const started = timings.get(stage)?.startedAt != null;
        const done = timings.get(stage)?.finishedAt != null;
        // A stage that started but never finished on a failed run is itself the
        // failure point; once the run is terminal nothing can still be "current".
        const failedStage = failed && started && !done;
        const current = !hasTerminal && currentStage === stage && !done;
        const skipped = hasTerminal && !started;
        const duration = elapsedFor(stage);
        const batch = current ? batchProgress(events, stage) : null;
        const statusText = done
          ? t.completed
          : failedStage
            ? t.failed
            : current
              ? t.running
              : skipped
                ? t.stageSkipped
                : t.waiting;
        return (
          <li key={stage} style={{ display: "flex", alignItems: "center", gap: "8px", opacity: done || current || failedStage ? 1 : 0.55 }}>
            <span
              aria-hidden="true"
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: done ? "var(--ok)" : current ? "var(--accent)" : "var(--border)",
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            <span className="sr-only">
              {label}: {statusText}
            </span>
            {failedStage ? (
              <span
                aria-hidden="true"
                style={{
                  color: "var(--danger)",
                  fontSize: "12px",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {t.failed}
              </span>
            ) : skipped ? (
              <span
                aria-hidden="true"
                style={{
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  flexShrink: 0,
                }}
              >
                {t.stageSkipped}
              </span>
            ) : null}
            {done ? (
              <span style={{ color: "var(--ok)", fontSize: "12px", flexShrink: 0 }} aria-hidden="true">✓{duration != null ? ` ${duration}` : ""}</span>
            ) : current ? (
              <span style={{ color: "var(--accent)", fontSize: "12px", flexShrink: 0 }} aria-hidden="true">{duration != null ? duration : "…"}</span>
            ) : null}
            {current && batch ? (
              <span style={{ color: "var(--text-muted)", fontSize: "12px", flexShrink: 0 }} aria-hidden="true">
                {t.stageBatch} {batch.done}/{batch.total}
              </span>
            ) : null}
          </li>
        );
      })}
      {failed ? (
        <li style={{ color: "var(--danger)", fontWeight: 600 }}>
          <span className="sr-only">{t.failed}</span>
          <span aria-hidden="true">✗</span>
        </li>
      ) : null}
    </ol>
  );
}
