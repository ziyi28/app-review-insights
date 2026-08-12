import { NextResponse } from "next/server";
import { RunStore, ARTIFACT_NAMES } from "@/server/runs/run-store";
import { loadConfig } from "@/server/config";

export const runtime = "nodejs";

/**
 * Returns a specific artifact attempt for a run.
 *
 * During a run the manifest is only finalized at the end, so intermediate
 * artifact reads must not depend on a manifest index: we try the manifest's
 * declared attempt and fall back to attempt 1 for artifacts written before the
 * manifest was finalized.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string; artifactName: string }> }) {
  const { runId, artifactName } = await params;
  if (!(ARTIFACT_NAMES as readonly string[]).includes(artifactName)) {
    return NextResponse.json({ error: "unknown artifact" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const cfg = loadConfig();
  const store = new RunStore(cfg.runsDir);
  try {
    let attempt = 1;
    try {
      const manifest = await store.readManifest(runId);
      const info = manifest.artifacts[artifactName];
      if (info?.attempt) attempt = info.attempt;
    } catch {
      // no manifest yet (early run or crash before finalize) -> attempt 1
    }
    const value = await store.readArtifact(runId, artifactName, attempt);
    return NextResponse.json(value, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "artifact not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
