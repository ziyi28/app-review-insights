import path from "node:path";
import { NextResponse } from "next/server";
import { RunStore } from "@/server/runs/run-store";
import { loadConfig } from "@/server/config";
import { extractAppNameFromUrl } from "@/server/sources/app-store-url";
import { isRunActive } from "@/server/runs/run-executor";

export const runtime = "nodejs";

/** Roots searched for a run's manifest: runtime runs first, then bundled fixtures. */
function runRoots(cfg: ReturnType<typeof loadConfig>): string[] {
  return [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];
}

/**
 * Returns the run manifest for a run id, with backward-compatible fallbacks for
 * older runs. Looks in the runtime store first, then the bundled fixture root,
 * so a built-in demo run is viewable offline exactly like a real run. The store
 * that actually holds the manifest is used for the artifact fallback so a
 * fixture's own artifacts are read, never a same-named runtime run's.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const cfg = loadConfig();
  for (const root of runRoots(cfg)) {
    const store = new RunStore(root);
    let manifest;
    try {
      manifest = await store.readManifest(runId);
    } catch {
      continue;
    }

    // Backward-compatible fallback for older runs where appName/appUrl/startRequest were not saved
    if (!manifest.appName || !manifest.appUrl || !manifest.startRequest) {
      try {
        const evidence = (await store.readArtifact(runId, "source-evidence", 1)) as
          | { kind?: string; appId?: string; canonicalUrl?: string; fileName?: string }
          | undefined;
        if (evidence?.kind === "app-store-reviews" && evidence.appId) {
          const appUrl = evidence.canonicalUrl || `https://apps.apple.com/us/app/id${evidence.appId}`;
          const appName = extractAppNameFromUrl(appUrl) || `App ${evidence.appId}`;
          manifest.appUrl = manifest.appUrl || appUrl;
          manifest.appName = manifest.appName || appName;
          if (!manifest.startRequest && manifest.goal) {
            manifest.startRequest = {
              protocolVersion: "1",
              mode: "analyze",
              uiLocale: "zh-CN",
              outputLocale: "zh-CN",
              goal: manifest.goal,
              source: { kind: "live", appStoreUrl: appUrl },
            };
          }
        } else if (evidence?.kind === "import" && evidence.fileName) {
          manifest.fileName = manifest.fileName || evidence.fileName;
        }
      } catch {
        // ignore artifact read error
      }
    }

    return NextResponse.json(manifest, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ error: "run not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

/**
 * Deletes a run's snapshot directory. Only the runtime store (data/runs) is
 * deletable; bundled fixtures live in a separate root and are never touched.
 * A failure to remove (e.g. EPERM on Windows while the directory is being
 * written) is a conflict, not a server error.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const cfg = loadConfig();
  const store = new RunStore(cfg.runsDir);
  let runDir: string;
  try {
    runDir = store.resolveRunDir(runId);
  } catch {
    return NextResponse.json({ error: "run not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (!store.existsFile(runDir)) {
    return NextResponse.json({ error: "run not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  // A genuinely running task must not be deleted (its pipeline is still writing
  // into the directory). An `interrupted` run (persisted `running` manifest, no
  // active task) is deletable — it is not protected here.
  if (isRunActive(runId)) {
    return NextResponse.json({ error: "run is still running" }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  try {
    await store.deleteRun(runId);
  } catch {
    return NextResponse.json({ error: "run could not be deleted (may still be running)" }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  return new NextResponse(null, { status: 204 });
}
