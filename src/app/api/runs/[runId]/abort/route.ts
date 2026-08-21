import { NextResponse } from "next/server";
import { cancelActiveRun, isRunActive } from "@/server/runs/run-executor";

export const runtime = "nodejs";

/**
 * Aborts an active in-flight run.
 * If the run is active, triggers its AbortController signal.
 * Returns 200 with { ok: true, runId, cancelled, active }.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const cancelled = cancelActiveRun(runId);
  return NextResponse.json(
    { ok: true, runId, cancelled, active: isRunActive(runId) },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}
