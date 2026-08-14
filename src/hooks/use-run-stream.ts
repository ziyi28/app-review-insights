"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RunEventSchema, type RunEvent } from "@/domain/contracts/events";

export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled", "interrupted"];

export type RunStreamState = {
  runId: string | null;
  /** Authoritative run status reported by the events endpoint. */
  status: RunStatus | null;
  events: RunEvent[];
  /** Actively polling a non-terminal run (or POSTing a new one). */
  running: boolean;
  /** A poll failed transiently; the client keeps retrying and has NOT failed. */
  reconnecting: boolean;
  /** A non-recoverable error (e.g. the start request was rejected). */
  error: string | null;
  lastEvent: RunEvent | null;
  /** Count of streamed events that failed the event schema and were dropped. */
  droppedEvents: number;
  /** Whether the last start request is available to be retried. */
  canRetry: boolean;
};

export type RunStreamActions = {
  start: (body: unknown) => Promise<void>;
  reset: () => void;
  retry: () => Promise<void>;
  /** Switches monitoring to an existing run (read-only history or resume). */
  loadHistory: (runId: string) => void;
};

export const LAST_RUN_ID_KEY = "app-review-planner:last-run-id";

const POLL_INTERVAL_MS = 800;

/**
 * Client-side consumer of the run event API. `POST /api/runs` returns an
 * immediate `202` with a run id; this hook then polls
 * `GET /api/runs/{runId}/events?afterSequence=N` every 800ms for new events
 * until the authoritative status is terminal.
 *
 * Switching the monitored run (or starting a new one) only aborts the local
 * polling loop — the server-side task keeps running, so viewing history or
 * refreshing the page never cancels a background analysis. A transient poll
 * failure flips `reconnecting` and keeps retrying; only the authoritative
 * status or a terminal event decides the run's outcome.
 */
export function useRunStream(): RunStreamState & RunStreamActions {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [droppedEvents, setDroppedEvents] = useState(0);
  const [hasLastBody, setHasLastBody] = useState(false);

  const generation = useRef(0);
  const lastStartBody = useRef<unknown | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsRef = useRef<RunEvent[]>([]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Invalidates any in-flight poll and stops the local loop. */
  const stop = useCallback(() => {
    generation.current += 1;
    clearTimer();
    setRunning(false);
    setReconnecting(false);
  }, [clearTimer]);

  const watch = useCallback(
    (targetRunId: string) => {
      const gen = ++generation.current;
      clearTimer();
      eventsRef.current = [];
      setRunId(targetRunId);
      setStatus(null);
      setEvents([]);
      setError(null);
      setDroppedEvents(0);
      setRunning(true);
      setReconnecting(false);

      const poll = async (afterSequence: number) => {
        if (gen !== generation.current) return;
        let res: Response;
        try {
          res = await fetch(`/api/runs/${targetRunId}/events?afterSequence=${afterSequence}`, { cache: "no-store" });
        } catch {
          if (gen !== generation.current) return;
          setReconnecting(true);
          timerRef.current = setTimeout(() => poll(afterSequence), POLL_INTERVAL_MS);
          return;
        }
        if (!res.ok) {
          if (gen !== generation.current) return;
          // A transient failure (e.g. the run directory is still being written)
          // is NOT a failed run: keep reconnecting rather than misreporting.
          setReconnecting(true);
          timerRef.current = setTimeout(() => poll(afterSequence), POLL_INTERVAL_MS);
          return;
        }
        let json: { status?: string; events?: unknown[]; lastSequence?: number };
        try {
          json = (await res.json()) as { status?: string; events?: unknown[]; lastSequence?: number };
        } catch {
          if (gen !== generation.current) return;
          setReconnecting(true);
          timerRef.current = setTimeout(() => poll(afterSequence), POLL_INTERVAL_MS);
          return;
        }
        if (gen !== generation.current) return;
        setReconnecting(false);

        const incoming: RunEvent[] = [];
        for (const evt of json.events ?? []) {
          const parsed = RunEventSchema.safeParse(evt);
          if (!parsed.success) {
            setDroppedEvents((n) => n + 1);
            continue;
          }
          incoming.push(parsed.data);
        }
        // Dedupe across polls by sequence: a re-read of a partially-written
        // window must never yield duplicates.
        const seen = new Set(eventsRef.current.map((e) => e.sequence));
        const fresh = incoming.filter((e) => !seen.has(e.sequence));
        const merged = [...eventsRef.current, ...fresh].sort((a, b) => a.sequence - b.sequence);
        eventsRef.current = merged;
        setEvents(merged);

        const nextStatus = (json.status as RunStatus) ?? null;
        setStatus(nextStatus);

        const terminalStatus = nextStatus !== null && TERMINAL_STATUSES.includes(nextStatus);
        const terminalEvent = merged.some((e) => e.type === "run.completed" || e.type === "run.failed");
        if (terminalStatus || terminalEvent) {
          setRunning(false);
          return;
        }
        const next = json.lastSequence ?? (merged.at(-1)?.sequence ?? afterSequence);
        timerRef.current = setTimeout(() => poll(next), POLL_INTERVAL_MS);
      };

      void poll(0);
    },
    [clearTimer],
  );

  const reset = useCallback(() => {
    stop();
    lastStartBody.current = null;
    setHasLastBody(false);
    setRunId(null);
    setStatus(null);
    setEvents([]);
    setError(null);
    setDroppedEvents(0);
    eventsRef.current = [];
  }, [stop]);

  const start = useCallback(
    async (body: unknown) => {
      stop();
      const gen = ++generation.current;
      lastStartBody.current = body;
      setHasLastBody(true);
      setEvents([]);
      setRunId(null);
      setStatus(null);
      setError(null);
      setDroppedEvents(0);
      setRunning(true);

      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const problem = await res.json().catch(() => ({}));
          throw new Error(problem.detail ?? problem.title ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { runId?: string };
        if (gen !== generation.current) return;
        const newRunId = json.runId;
        if (!newRunId) throw new Error("no runId in start response");
        if (typeof localStorage !== "undefined") localStorage.setItem(LAST_RUN_ID_KEY, newRunId);
        watch(newRunId);
      } catch (err) {
        if (gen !== generation.current) return;
        setRunning(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [stop, watch],
  );

  const retry = useCallback(async () => {
    if (lastStartBody.current) await start(lastStartBody.current);
  }, [start]);

  const loadHistory = useCallback(
    (targetRunId: string) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(LAST_RUN_ID_KEY, targetRunId);
      watch(targetRunId);
    },
    [watch],
  );

  // Clear the pending poll timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return {
    runId,
    status,
    events,
    running,
    reconnecting,
    error,
    lastEvent: events.at(-1) ?? null,
    droppedEvents,
    canRetry: hasLastBody && !running,
    start,
    reset,
    retry,
    loadHistory,
  };
}
