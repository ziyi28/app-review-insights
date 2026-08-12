import { NextResponse } from "next/server";
import { RunStore } from "@/server/runs/run-store";
import { loadConfig } from "@/server/config";

export const runtime = "nodejs";

/** Returns the run manifest for a run id. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const cfg = loadConfig();
  const store = new RunStore(cfg.runsDir);
  try {
    const manifest = await store.readManifest(runId);
    return NextResponse.json(manifest, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "run not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
