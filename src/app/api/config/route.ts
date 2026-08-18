import { NextResponse } from "next/server";
import { loadConfig, isModelConfigured, isModelApiKeyConfigured, persistRuntimeConfig, isSerpApiConfigured, type RuntimeModelConfig } from "@/server/config";
import { ConfigUpdateSchema } from "@/domain/contracts/config";

export const runtime = "nodejs";

/** Non-sensitive configuration status for the UI. Never exposes keys. */
function configStatus(cfg: ReturnType<typeof loadConfig>) {
  return {
    modelConfigured: isModelConfigured(cfg),
    modelApiKeyConfigured: isModelApiKeyConfigured(cfg),
    serpApiKeyConfigured: isSerpApiConfigured(cfg),
    modelName: cfg.modelName,
    modelBaseUrl: cfg.modelBaseUrl,
    jsonMode: cfg.modelJsonMode,
    reasoningEffort: cfg.modelReasoningEffort,
    runsDir: cfg.runsDir,
    limits: {
      appleRssMaxPages: cfg.appleRssMaxPages,
      appleRssPageDelayMs: cfg.appleRssPageDelayMs,
      importMaxBytes: 2_000_000,
      maxReviews: 1000,
    },
  };
}

export async function GET() {
  const cfg = loadConfig();
  return NextResponse.json(configStatus(cfg), { headers: { "cache-control": "no-store" } });
}

/**
 * Updates the model connection from the settings panel. Applies the override
 * in-process immediately (no restart) and persists it to the git-ignored
 * `data/config.local.json` so it survives a restart — never to `.env.local`,
 * which would trigger a Next.js env reload and orphan running background
 * tasks. The response re-reports status only; the API key is never returned.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = ConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", detail: parsed.error.issues[0]?.message }, { status: 422 });
  }
  const update = parsed.data;

  const runtime: RuntimeModelConfig = {};
  if (update.modelBaseUrl !== undefined) runtime.modelBaseUrl = update.modelBaseUrl;
  if (update.modelApiKey !== undefined) runtime.modelApiKey = update.modelApiKey;
  if (update.modelName !== undefined) runtime.modelName = update.modelName;
  if (update.modelJsonMode !== undefined) runtime.modelJsonMode = update.modelJsonMode;
  if (update.modelReasoningEffort !== undefined) runtime.modelReasoningEffort = update.modelReasoningEffort;

  persistRuntimeConfig({
    model: runtime,
    serpApi: update.serpApiKey !== undefined ? { apiKey: update.serpApiKey } : undefined,
  });

  return NextResponse.json(configStatus(loadConfig()), { headers: { "cache-control": "no-store" } });
}
