import path from "node:path";

export type ServerConfig = {
  modelBaseUrl: string | null;
  modelApiKey: string | null;
  modelName: string | null;
  modelJsonMode: "prompt" | "json_object";
  runsDir: string;
  appleRssBaseUrl: string;
  appleRssPageDelayMs: number;
  appleRssMaxPages: number;
  appleRssTimeoutMs: number;
  replayEventDelayMs: number;
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jsonMode = env.MODEL_JSON_MODE === "json_object" ? "json_object" : "prompt";
  const runsDir = env.RUNS_DIR ? path.resolve(env.RUNS_DIR) : path.resolve(process.cwd(), "data", "runs");
  return {
    modelBaseUrl: env.MODEL_BASE_URL?.trim() || null,
    modelApiKey: env.MODEL_API_KEY?.trim() || null,
    modelName: env.MODEL_NAME?.trim() || null,
    modelJsonMode: jsonMode,
    runsDir,
    appleRssBaseUrl: env.APPLE_RSS_BASE_URL?.trim() || "https://itunes.apple.com/us/rss/customerreviews",
    // Rate-limit discipline: never more than 10 pages and never faster than
    // 500ms apart, so a misconfigured APPLE_RSS_* env cannot hammer Apple.
    appleRssPageDelayMs: Math.max(500, intFromEnv("APPLE_RSS_PAGE_DELAY_MS", 500)),
    appleRssMaxPages: Math.min(10, Math.max(1, intFromEnv("APPLE_RSS_MAX_PAGES", 10))),
    appleRssTimeoutMs: intFromEnv("APPLE_RSS_TIMEOUT_MS", 10_000),
    replayEventDelayMs: intFromEnv("REPLAY_EVENT_DELAY_MS", 60),
  };
}

export function isModelConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.modelBaseUrl && cfg.modelName);
}
