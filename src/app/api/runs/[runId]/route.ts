import { NextResponse } from "next/server";
import { RunStore } from "@/server/runs/run-store";
import { loadConfig } from "@/server/config";
import { extractAppNameFromUrl } from "@/server/sources/app-store-url";

export const runtime = "nodejs";

/** Returns the run manifest for a run id, with backward-compatible fallbacks for older runs. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const cfg = loadConfig();
  const store = new RunStore(cfg.runsDir);
  try {
    const manifest = await store.readManifest(runId);

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
  } catch {
    return NextResponse.json({ error: "run not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
