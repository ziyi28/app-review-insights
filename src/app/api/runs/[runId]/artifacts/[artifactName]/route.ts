import { NextResponse } from "next/server";
import { RunStore, ARTIFACT_NAMES } from "@/server/runs/run-store";
import { loadConfig } from "@/server/config";

export const runtime = "nodejs";

/**
 * Returns a specific artifact attempt for a run, selected by ?attempt=<n>.
 * Without ?attempt the manifest's declared latest attempt is served.
 *
 * During a run the manifest is only finalized at the end, so intermediate
 * artifact reads must not depend on a manifest index: we try the manifest's
 * declared attempt and fall back to attempt 1 for artifacts written before the
 * manifest was finalized.
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string; artifactName: string }> }) {
  const { runId, artifactName } = await params;
  if (!(ARTIFACT_NAMES as readonly string[]).includes(artifactName)) {
    return NextResponse.json({ error: "unknown artifact" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const rawAttempt = new URL(req.url).searchParams.get("attempt");
  const requestedAttempt = rawAttempt === null ? null : Number(rawAttempt);
  if (requestedAttempt !== null && (!Number.isInteger(requestedAttempt) || requestedAttempt < 1)) {
    return NextResponse.json({ error: "invalid attempt" }, { status: 422, headers: { "cache-control": "no-store" } });
  }
  const cfg = loadConfig();
  const store = new RunStore(cfg.runsDir);
  try {
    let attempt = 1;
    try {
      const manifest = await store.readManifest(runId);
      const info = manifest.artifacts[artifactName];
      if (info?.attempt) attempt = info.attempt;
      if (requestedAttempt !== null && requestedAttempt > attempt) {
        return NextResponse.json({ error: "artifact attempt not found" }, { status: 404, headers: { "cache-control": "no-store" } });
      }
    } catch {
      // no manifest yet (early run or crash before finalize) -> attempt 1
    }
    const targetAttempt = requestedAttempt ?? attempt;
    const value = await store.readArtifact(runId, artifactName, targetAttempt);
    return NextResponse.json(value, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "artifact not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
