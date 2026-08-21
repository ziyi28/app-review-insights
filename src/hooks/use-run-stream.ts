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
  /**
   * Terminal: the events endpoint answered 404/410 — the run directory no
   * longer exists (deleted or never persisted). Polling has stopped.
   */
  gone: boolean;
  /** A non-recoverable error (e.g. the start request was rejected). */
  error: string | null;
  lastEvent: RunEvent | null;
  /** Whether the last start request is available to be retried. */
  canRetry: boolean;
};

export type RunStreamActions = {
  start: (body: unknown) => Promise<void>;
  reset: () => void;
  abort: (targetRunId?: string) => Promise<boolean>;
  retry: () => Promise<void>;
  /** Switches monitoring to an existing run (read-only history or resume). */
  loadHistory: (runId: string) => void;
};

export const LAST_RUN_ID_KEY = "app-review-planner:last-run-id";

const POLL_BASE_MS = 800;
const POLL_MAX_MS = 5000;
const POLL_BACKOFF_STEP = 1.5;

/**
 * Client-side consumer of the run event API. `POST /api/runs` returns an
 * immediate `202` with a run id; this hook then polls
 * `GET /api/runs/{runId}/events?afterSequence=N` for new events until the
 * authoritative status is terminal. Failed polls back off (800ms growing by
 * 1.5× up to 5s) and the delay resets after any successful poll; a 404/410
 * answer is terminal — the run is gone and polling stops.
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
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setGone(false);
      setRunning(true);
      setReconnecting(false);

      let delayMs = POLL_BASE_MS;

      const poll = async (afterSequence: number) => {
        if (gen !== generation.current) return;
        let res: Response;
        try {
          res = await fetch(`/api/runs/${targetRunId}/events?afterSequence=${afterSequence}`, { cache: "no-store" });
        } catch {
          if (gen !== generation.current) return;
          setReconnecting(true);
          timerRef.current = setTimeout(() => poll(afterSequence), delayMs);
          delayMs = Math.min(delayMs * POLL_BACKOFF_STEP, POLL_MAX_MS);
          return;
        }
        if (!res.ok) {
          if (gen !== generation.current) return;
          if (res.status === 404 || res.status === 410) {
            // The run directory is gone (deleted or never persisted). No
            // amount of retrying can bring it back — stop instead of looping
            // on "reconnecting" forever.
            setRunning(false);
            setReconnecting(false);
            setGone(true);
            return;
          }
          // A transient failure (e.g. the run directory is still being written)
          // is NOT a failed run: keep reconnecting rather than misreporting.
          setReconnecting(true);
          timerRef.current = setTimeout(() => poll(afterSequence), delayMs);
          delayMs = Math.min(delayMs * POLL_BACKOFF_STEP, POLL_MAX_MS);
          return;
        }
        let json: { status?: string; events?: unknown[]; lastSequence?: number };
        try {
          json = (await res.json()) as { status?: string; events?: unknown[]; lastSequence?: number };
        } catch {
          if (gen !== generation.current) return;
          setReconnecting(true);
          timerRef.current = setTimeout(() => poll(afterSequence), delayMs);
          delayMs = Math.min(delayMs * POLL_BACKOFF_STEP, POLL_MAX_MS);
          return;
        }
        if (gen !== generation.current) return;
        setReconnecting(false);
        // A successful poll resets the backoff so a healthy stream keeps its
        // snappy base interval.
        delayMs = POLL_BASE_MS;

        const incoming: RunEvent[] = [];
        for (const evt of json.events ?? []) {
          const parsed = RunEventSchema.safeParse(evt);
          if (!parsed.success) continue;
          incoming.push(parsed.data);
        }
        // Dedupe by sequence — across polls AND within a batch. A re-read of a
        // partially-written window must never yield duplicates, and a legacy
        // snapshot that already contains a duplicate sequence must not surface
        // duplicate keys to the renderer.
        const seen = new Set(eventsRef.current.map((e) => e.sequence));
        const fresh: RunEvent[] = [];
        for (const e of incoming) {
          if (seen.has(e.sequence)) continue;
          seen.add(e.sequence);
          fresh.push(e);
        }
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
        timerRef.current = setTimeout(() => poll(next), delayMs);
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
    setGone(false);
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
      setGone(false);
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

  const abort = useCallback(
    async (targetRunId?: string): Promise<boolean> => {
      const idToAbort = targetRunId ?? runId;
      if (!idToAbort) return false;

      let res: Response;
      try {
        res = await fetch(`/api/runs/${encodeURIComponent(idToAbort)}/abort`, {
          method: "POST",
          headers: { "cache-control": "no-store" },
        });
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }

      let payload: { cancelled?: unknown; detail?: unknown; title?: unknown } = {};
      try {
        payload = (await res.json()) as typeof payload;
      } catch {
        // Use the HTTP status below when an error response has no JSON body.
      }
      if (!res.ok) {
        const detail = typeof payload.detail === "string" ? payload.detail : typeof payload.title === "string" ? payload.title : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      if (payload.cancelled !== true) return false;

      stop();
      return true;
    },
    [runId, stop],
  );

  // Clear the pending poll timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return {
    runId,
    status,
    events,
    running,
    reconnecting,
    gone,
    error,
    lastEvent: events.at(-1) ?? null,
    canRetry: hasLastBody && !running,
    start,
    reset,
    abort,
    retry,
    loadHistory,
  };
}
