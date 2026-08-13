import { NextResponse } from "next/server";
import { loadConfig, isModelConfigured, isModelApiKeyConfigured, setRuntimeModelConfig, setRuntimeSocialCrawlConfig, persistEnvLocal, isSocialCrawlConfigured, type RuntimeModelConfig } from "@/server/config";
import { ConfigUpdateSchema } from "@/domain/contracts/config";

export const runtime = "nodejs";

/** Non-sensitive configuration status for the UI. Never exposes keys. */
function configStatus(cfg: ReturnType<typeof loadConfig>) {
  return {
    modelConfigured: isModelConfigured(cfg),
    modelApiKeyConfigured: isModelApiKeyConfigured(cfg),
    socialCrawlApiKeyConfigured: isSocialCrawlConfigured(cfg),
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
  };
}

export async function GET() {
  const cfg = loadConfig();
  return NextResponse.json(configStatus(cfg), { headers: { "cache-control": "no-store" } });
}

/**
 * Updates the model connection from the settings panel. Applies the override
 * in-process immediately (no restart) and persists it to the git-ignored
 * `.env.local` so it survives a restart. The response re-reports status only;
 * the API key is never returned.
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
  if (update.modelBaseUrl !== undefined) {
    runtime.modelBaseUrl = update.modelBaseUrl;
    persistEnvLocal("MODEL_BASE_URL", update.modelBaseUrl);
  }
  if (update.modelApiKey !== undefined) {
    runtime.modelApiKey = update.modelApiKey;
    persistEnvLocal("MODEL_API_KEY", update.modelApiKey);
  }
  if (update.modelName !== undefined) {
    runtime.modelName = update.modelName;
    persistEnvLocal("MODEL_NAME", update.modelName);
  }
  if (update.modelJsonMode !== undefined) {
    runtime.modelJsonMode = update.modelJsonMode;
    persistEnvLocal("MODEL_JSON_MODE", update.modelJsonMode);
  }
  setRuntimeModelConfig(runtime);

  if (update.socialCrawlApiKey !== undefined) {
    persistEnvLocal("SOCIALCRAWL_API_KEY", update.socialCrawlApiKey);
    setRuntimeSocialCrawlConfig({ apiKey: update.socialCrawlApiKey });
  }

  return NextResponse.json(configStatus(loadConfig()), { headers: { "cache-control": "no-store" } });
}
