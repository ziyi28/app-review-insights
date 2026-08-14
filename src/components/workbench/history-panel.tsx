"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n";
import { useModal } from "./use-modal";
import styles from "./modal.module.css";

export type HistoryPanelProps = {
  t: Dictionary;
  open: boolean;
  onClose: () => void;
  onView: (runId: string) => void;
  onReplay: (runId: string) => void;
  onRetry?: (runId: string) => void;
};

type HistoryEntry = {
  runId: string;
  status: string;
  createdAt: string;
  canReplay: boolean;
  canRetry?: boolean;
  goal?: string;
  executionMode?: string;
  appName?: string;
  appUrl?: string;
  fileName?: string;
  deletable?: boolean;
};

/**
 * Modal listing past runs from GET /api/runs. Each row offers a read-only
 * "view" (loads the persisted events/artifacts), a "replay" for replayable
 * completed runs, a "retry" for interrupted runs, and a "delete" that removes
 * the run's snapshot after an in-row confirmation. Runs of any status are
 * listed so failures and running jobs are visible too.
 */
export function HistoryPanel({ t, open, onClose, onView, onReplay, onRetry }: HistoryPanelProps) {
  const [runs, setRuns] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown } = useModal(open, onClose, containerRef);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      const json = (await res.json()) as { runs?: HistoryEntry[] };
      setRuns(json.runs ?? []);
    } catch {
      setError(t.historyLoadFailed);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      // Reset inside the async loader so the reset is not a synchronous
      // setState call in the effect body (react-hooks/set-state-in-effect).
      setDeleteError(null);
      setConfirmingRunId(null);
      if (!cancelled) await reload();
    })();
    // Refresh the list every 2s while open so parallel tasks' statuses stay
    // current (running → completed/failed/interrupted) without a manual reload.
    const interval = setInterval(() => {
      void reload();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, reload]);

  const handleDelete = async (runId: string) => {
    setDeleteError(null);
    setDeletingRunId(runId);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmingRunId(null);
      await reload();
    } catch {
      setDeleteError(t.deleteFailed);
    } finally {
      setDeletingRunId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
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
        {deleteError ? <p style={{ color: "var(--danger)", margin: 0 }}>{deleteError}</p> : null}

        <div style={{ overflowY: "auto", display: "grid", gap: "8px" }}>
          {runs.length === 0 && !error ? <p style={{ color: "var(--text-muted)" }}>{t.historyEmpty}</p> : null}
          {runs.map((run) => (
            <div key={run.runId} className="card" style={{ display: "grid", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className={run.status === "completed" ? "chip chip-ok" : run.status === "failed" ? "chip chip-danger" : "chip chip-accent"}>{run.status}</span>
                {run.executionMode ? <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{run.executionMode}</span> : null}
                <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{new Date(run.createdAt).toLocaleString()}</span>
              </div>

              {/* App Name / App Store Link / Imported File */}
              {run.appName || run.appUrl ? (
                <div style={{ fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                  {run.appUrl ? (
                    <a
                      href={run.appUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t.openInAppStore}
                      style={{ color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{run.appName || run.appUrl}</span>
                      <span aria-hidden="true" style={{ fontSize: "12px" }}>↗</span>
                    </a>
                  ) : (
                    <span style={{ color: "var(--text)" }}>{run.appName}</span>
                  )}
                </div>
              ) : run.fileName ? (
                <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span>📄 {run.fileName}</span>
                </div>
              ) : null}

              <p style={{ margin: 0, fontSize: "13px", color: "var(--text)" }}>{run.goal || <span style={{ color: "var(--text-muted)" }}>—</span>}</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="btn btn-secondary" onClick={() => onView(run.runId)}>
                  {t.view}
                </button>
                {run.canReplay ? (
                  <button type="button" className="btn btn-primary" onClick={() => onReplay(run.runId)}>
                    {t.replay}
                  </button>
                ) : null}
                {run.canRetry && onRetry ? (
                  <button type="button" className="btn btn-primary" onClick={() => onRetry(run.runId)}>
                    {t.retry}
                  </button>
                ) : null}
                {run.deletable !== false ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setConfirmingRunId(run.runId)}
                    disabled={deletingRunId === run.runId}
                  >
                    {deletingRunId === run.runId ? "…" : t.delete}
                  </button>
                ) : null}
              </div>
              {confirmingRunId === run.runId ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
                  <span style={{ fontSize: "13px", color: "var(--danger)", marginRight: "auto" }}>{t.deleteConfirm}</span>
                  <button type="button" className="btn btn-danger" onClick={() => void handleDelete(run.runId)} disabled={deletingRunId === run.runId}>
                    {deletingRunId === run.runId ? "…" : t.delete}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmingRunId(null)} disabled={deletingRunId === run.runId}>
                    {t.cancel}
                  </button>
                </div>
              ) : null}
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
