"use client";

import { useCallback, useRef, useState } from "react";
import { parseNdjsonStream } from "@/lib/client/ndjson";
import { RunEventSchema, type RunEvent } from "@/domain/contracts/events";

export type RunStreamState = {
  events: RunEvent[];
  running: boolean;
  error: string | null;
  lastEvent: RunEvent | null;
};

export type RunStreamActions = {
  start: (body: unknown) => Promise<void>;
  reset: () => void;
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
  const aborter = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const reset = useCallback(() => {
    generation.current += 1;
    aborter.current?.abort();
    aborter.current = null;
    setEvents([]);
    setRunning(false);
    setError(null);
  }, []);

  const start = useCallback(async (body: unknown) => {
    aborter.current?.abort();
    const controller = new AbortController();
    aborter.current = controller;
    const gen = ++generation.current;
    setEvents([]);
    setRunning(true);
    setError(null);

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
        // Drop any event that does not conform to the event protocol.
        const parsed = RunEventSchema.safeParse(evt);
        if (!parsed.success) return;
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

  return { events, running, error, lastEvent: events.at(-1) ?? null, start, reset };
}
