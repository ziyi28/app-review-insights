import { NextResponse } from "next/server";
import { loadConfig, isModelConfigured } from "@/server/config";

export const runtime = "nodejs";

/** Non-sensitive configuration status for the UI. Never exposes keys. */
export async function GET() {
  const cfg = loadConfig();
  return NextResponse.json(
    {
      modelConfigured: isModelConfigured(cfg),
      modelName: cfg.modelName,
      modelBaseUrl: cfg.modelBaseUrl,
      jsonMode: cfg.modelJsonMode,
      runsDir: cfg.runsDir,
      limits: {
        appleRssMaxPages: cfg.appleRssMaxPages,
        appleRssPageDelayMs: cfg.appleRssPageDelayMs,
        importMaxBytes: 2_000_000,
        maxReviews: 1000,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
