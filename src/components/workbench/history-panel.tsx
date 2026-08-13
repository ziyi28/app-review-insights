"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n";
import { useModal } from "./use-modal";
import styles from "./modal.module.css";

export type HistoryPanelProps = {
  t: Dictionary;
  open: boolean;
  onClose: () => void;
  onView: (runId: string) => void;
  onReplay: (runId: string) => void;
};

type HistoryEntry = {
  runId: string;
  status: string;
  createdAt: string;
  canReplay: boolean;
  goal?: string;
  executionMode?: string;
};

/**
 * Modal listing past runs from GET /api/runs. Each row offers a read-only
 * "view" (loads the persisted events/artifacts) and, for replayable completed
 * runs, a "replay" (re-streams via cached-replay). Runs of any status are
 * listed so failures and running jobs are visible too.
 */
export function HistoryPanel({ t, open, onClose, onView, onReplay }: HistoryPanelProps) {
  const [runs, setRuns] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown } = useModal(open, onClose, containerRef);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      // Reset inside the async loader so the reset is not a synchronous
      // setState call in the effect body (react-hooks/set-state-in-effect).
      setError(null);
      try {
        const res = await fetch("/api/runs", { cache: "no-store" });
        const json = (await res.json()) as { runs?: HistoryEntry[] };
        if (!cancelled) setRuns(json.runs ?? []);
      } catch {
        if (!cancelled) setError(t.historyLoadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.history}
        className={styles.dialogWide}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className={styles.dialogHead}>
          <h3 className={styles.dialogTitle}>{t.history}</h3>
          <button type="button" onClick={onClose} aria-label={t.close} className={styles.closeBtn}>
            ×
          </button>
        </div>

        {error ? <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}

        <div style={{ overflowY: "auto", display: "grid", gap: "8px" }}>
          {runs.length === 0 && !error ? <p style={{ color: "var(--text-muted)" }}>{t.historyEmpty}</p> : null}
          {runs.map((run) => (
            <div key={run.runId} className="card" style={{ display: "grid", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className={run.status === "completed" ? "chip chip-ok" : run.status === "failed" ? "chip chip-danger" : "chip chip-accent"}>{run.status}</span>
                {run.executionMode ? <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{run.executionMode}</span> : null}
                <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{new Date(run.createdAt).toLocaleString()}</span>
              </div>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text)" }}>{run.goal || <span style={{ color: "var(--text-muted)" }}>—</span>}</p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" className="btn btn-secondary" onClick={() => onView(run.runId)}>
                  {t.view}
                </button>
                {run.canReplay ? (
                  <button type="button" className="btn btn-primary" onClick={() => onReplay(run.runId)}>
                    {t.replay}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.dialogFoot}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
