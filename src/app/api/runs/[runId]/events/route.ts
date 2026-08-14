import path from "node:path";
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { RunStore } from "@/server/runs/run-store";
import { RunEventSchema, type RunEvent } from "@/domain/contracts/events";
import { loadConfig } from "@/server/config";
import { isRunActive } from "@/server/runs/run-executor";

export const runtime = "nodejs";

/**
 * Returns a run's event stream as a JSON array, re-connectable and incremental.
 * `?afterSequence=N` returns only events whose sequence exceeds N, so a client
 * can poll for new events without re-reading the whole log. The trailing line
 * of the on-disk NDJSON may be mid-write while a background task appends to it;
 * such an incomplete line is ignored rather than failing the request.
 *
 * The returned `status` resolves a persisted `running` manifest whose task is no
 * longer active (process restarted) to `interrupted`, so the client never
 * mistakes a dead job for a live one.
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const cfg = loadConfig();
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];

  const afterSequence = parseAfterSequence(new URL(req.url).searchParams.get("afterSequence"));

  for (const root of roots) {
    const store = new RunStore(root);
    let text: string;
    try {
      text = await fs.readFile(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8");
    } catch {
      continue;
    }

    const events: RunEvent[] = [];
    let lastSequence = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A partially-flushed trailing line during a concurrent append: ignore
        // it rather than treating the whole log as corrupt.
        continue;
      }
      const evt = RunEventSchema.safeParse(parsed);
      if (!evt.success) continue;
      if (evt.data.sequence > afterSequence) events.push(evt.data);
      if (evt.data.sequence > lastSequence) lastSequence = evt.data.sequence;
    }

    const status = await resolveStatus(store, runId);
    return NextResponse.json({ runId, status, events, lastSequence }, { headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json({ error: "run events not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

function parseAfterSequence(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function resolveStatus(store: RunStore, runId: string): Promise<string> {
  try {
    const manifest = await store.readManifest(runId);
    if (manifest.status === "running" && !isRunActive(runId)) return "interrupted";
    return manifest.status;
  } catch {
    // No manifest yet (the run was accepted but the manifest write raced), or a
    // corrupt snapshot. Active tasks are running; anything else is interrupted.
    return isRunActive(runId) ? "running" : "interrupted";
  }
}
