import path from "node:path";
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
 *
 * The runtime store is searched first, then the bundled fixture root, so a
 * built-in demo run's artifacts are viewable offline. Ownership is decided per
 * root by the manifest: once a manifest for the run id exists in a root, that
 * root is authoritative for the request — an artifact missing there is a 404
 * and never falls back to a same-named fixture artifact. Only when no manifest
 * and no artifact exist in a root do we continue to the next root.
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string; artifactName: string }> }) {
  const { runId, artifactName } = await params;
  if (!(ARTIFACT_NAMES as readonly string[]).includes(artifactName)) {
    return notFound("unknown artifact");
  }
  const rawAttempt = new URL(req.url).searchParams.get("attempt");
  const requestedAttempt = rawAttempt === null ? null : Number(rawAttempt);
  if (requestedAttempt !== null && (!Number.isInteger(requestedAttempt) || requestedAttempt < 1)) {
    return NextResponse.json({ error: "invalid attempt" }, { status: 422, headers: { "cache-control": "no-store" } });
  }
  const cfg = loadConfig();
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];
  for (const root of roots) {
    const store = new RunStore(root);
    let manifestFound = false;
    let attempt = 1;

    try {
      const manifest = await store.readManifest(runId);
      manifestFound = true;

      const info = manifest.artifacts[artifactName];
      if (info?.attempt) attempt = info.attempt;

      if (requestedAttempt !== null && requestedAttempt > attempt) {
        return notFound("artifact attempt not found");
      }
    } catch {
      // 允许运行早期没有 manifest 的 attempt-01 artifact。
    }

    try {
      const value = await store.readArtifact(
        runId,
        artifactName,
        requestedAttempt ?? attempt,
      );
      return NextResponse.json(value, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      if (manifestFound) {
        return notFound("artifact not found");
      }
    }
  }
  return notFound("artifact not found");
}

/** 文件内私有辅助函数：统一生成带 `cache-control: no-store` 的 404 JSON。 */
function notFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404, headers: { "cache-control": "no-store" } });
}
