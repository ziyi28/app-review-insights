"use client";

import { useCallback, useRef, useState } from "react";
import { parseNdjsonStream } from "@/lib/client/ndjson";
import { RunEventSchema, type RunEvent } from "@/domain/contracts/events";

export type RunStreamState = {
  events: RunEvent[];
  running: boolean;
  error: string | null;
  lastEvent: RunEvent | null;
  /** Count of streamed lines that failed the event schema and were dropped. */
  droppedEvents: number;
};

export type RunStreamActions = {
  start: (body: unknown) => Promise<void>;
  reset: () => void;
  /** Loads a completed run's persisted events for read-only history viewing. */
  loadHistory: (runId: string) => Promise<void>;
};

/**
 * Client-side stream consumer for POST /api/runs. Parses the NDJSON event
 * stream incrementally and exposes events + running state.
 *
 * A monotonically increasing generation token guards against a stale request
 * (aborted when a newer one started) mutating shared state: its callbacks and
 * finally no-op once a newer start() has taken over.
 */
export function useRunStream(): RunStreamState & RunStreamActions {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [droppedEvents, setDroppedEvents] = useState(0);
  const aborter = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const reset = useCallback(() => {
    generation.current += 1;
    aborter.current?.abort();
    aborter.current = null;
    setEvents([]);
    setRunning(false);
    setError(null);
    setDroppedEvents(0);
  }, []);

  const start = useCallback(async (body: unknown) => {
    aborter.current?.abort();
    const controller = new AbortController();
    aborter.current = controller;
    const gen = ++generation.current;
    setEvents([]);
    setRunning(true);
    setError(null);
    setDroppedEvents(0);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.detail ?? problem.title ?? `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("no response body");

      const received: RunEvent[] = [];
      await parseNdjsonStream(res.body, (evt) => {
        // Drop any event that does not conform to the event protocol. A dropped
        // first event would otherwise leave the UI blank forever with no signal,
        // so surface the drop instead of swallowing it silently.
        const parsed = RunEventSchema.safeParse(evt);
        if (!parsed.success) {
          setDroppedEvents((n) => n + 1);
          console.warn("[useRunStream] dropped non-conforming event", parsed.error.issues[0]?.message);
          return;
        }
        if (gen !== generation.current) return; // stale request
        received.push(parsed.data);
        setEvents([...received]);
      });
    } catch (err) {
      if (controller.signal.aborted || gen !== generation.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === generation.current) setRunning(false);
    }
  }, []);

  // Loads a completed run's persisted events in one shot (no streaming) so the
  // history view can inspect a past run without re-running or re-streaming it.
  const loadHistory = useCallback(async (runId: string) => {
    aborter.current?.abort();
    aborter.current = null;
    const gen = ++generation.current;
    setEvents([]);
    setRunning(false);
    setError(null);
    setDroppedEvents(0);
    try {
      const res = await fetch(`/api/runs/${runId}/events`, { cache: "no-store" });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.error ?? problem.detail ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { events?: unknown[] };
      const loaded: RunEvent[] = [];
      for (const evt of json.events ?? []) {
        const parsed = RunEventSchema.safeParse(evt);
        if (!parsed.success) continue;
        if (gen !== generation.current) return; // superseded
        loaded.push(parsed.data);
      }
      setEvents(loaded);
    } catch (err) {
      if (gen !== generation.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { events, running, error, lastEvent: events.at(-1) ?? null, droppedEvents, start, reset, loadHistory };
}
