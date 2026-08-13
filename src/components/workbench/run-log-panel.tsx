"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";
import { RunDiagnosticsPanel } from "@/components/artifacts/workflow-panels";
import styles from "./run-log-panel.module.css";

/** Best-effort human message for an event, empty when none applies. */
function eventMessage(e: RunEvent): string {
  const data = e.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return "";
  if (e.type === "run.failed") return typeof data.error === "string" ? data.error : "";
  if (e.type === "stage.progress") return typeof data.message === "string" ? data.message : "";
  if (e.type === "limitation.reported") {
    const code = typeof data.code === "string" ? data.code : "";
    const msg = typeof data.message === "string" ? data.message : "";
    return [code, msg].filter(Boolean).join(" — ");
  }
  if (e.type === "validation.failed") {
    if (typeof data.message === "string") return data.message;
    if (typeof data.reason === "string") return data.reason;
    return "";
  }
  if (e.type === "revision.completed") return typeof data.note === "string" ? data.note : "";
  return "";
}

function countMarker(events: RunEvent[], marker: string): number {
  let n = 0;
  for (const e of events) {
    if (e.type === "stage.progress") {
      const data = e.data as { message?: unknown } | null;
      if (typeof data?.message === "string" && data.message.includes(marker)) n++;
    }
  }
  return n;
}

export function RunLogPanel({ events, t }: { events: RunEvent[]; t: Dictionary }) {
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const stages = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.stage) set.add(e.stage);
    return [...set].sort();
  }, [events]);

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.type);
    return [...set].sort();
  }, [events]);

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (stageFilter !== "all" && e.stage !== stageFilter) return false;
        if (typeFilter !== "all" && e.type !== typeFilter) return false;
        return true;
      }),
    [events, stageFilter, typeFilter],
  );

  const errorCount = events.filter((e) => e.type === "run.failed").length;
  const warningCount = events.filter((e) => e.type === "limitation.reported" || (e.type === "stage.progress" && typeof (e.data as { code?: unknown } | null)?.code === "string")).length;
  const validationCount = events.filter((e) => e.type === "validation.failed").length;
  const revisionCount = events.filter((e) => e.type === "revision.started" || e.type === "revision.completed").length;
  const retryCount = countMarker(events, "model retry");

  const stats: { label: string; value: number }[] = [
    { label: t.eventCount, value: events.length },
    { label: t.diagnosticsError, value: errorCount },
    { label: t.diagnosticsWarning, value: warningCount },
    { label: t.diagnosticsValidation, value: validationCount },
    { label: t.diagnosticsRevision, value: revisionCount },
    { label: t.modelRetries, value: retryCount },
  ];

  return (
    <div className={styles.panel}>
      {/* Diagnostic summary (moved out of Overview) */}
      <RunDiagnosticsPanel events={events} t={t} />

      {/* Summary stat cards */}
      <div className={styles.stats}>
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <label className="field-label">
          {t.filterByStage}
          <select className="field" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="all">{t.all}</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {t.filterByEventType}
          <select className="field" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">{t.all}</option>
            {types.map((ty) => (
              <option key={ty} value={ty}>
                {ty}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Event table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t.sequence}</th>
              <th>{t.stage}</th>
              <th>{t.type}</th>
              <th>{t.message}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  {t.noData}
                </td>
              </tr>
            ) : (
              filtered.map((e) => {
                const msg = eventMessage(e);
                const fallback = msg ? msg : JSON.stringify(e.data ?? {}).slice(0, 120);
                return (
                  <tr key={e.sequence}>
                    <td className={styles.seq}>{e.sequence}</td>
                    <td className={styles.stageCell}>{e.stage ?? "—"}</td>
                    <td className={styles.typeCell}>
                      <code>{e.type}</code>
                    </td>
                    <td className={styles.msg}>{fallback}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
