import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

/**
 * Runtime model configuration, set by the UI's settings panel via
 * POST /api/config. It overrides the process environment (which Next.js loads
 * from `.env.local` at startup) without requiring a restart, and is persisted
 * to `.env.local` so it survives a restart.
 *
 * `undefined` means "not overridden" (fall back to env); `null` means
 * "explicitly cleared" (force empty even if env has a value).
 */
export type RuntimeModelConfig = {
  modelBaseUrl?: string | null;
  modelApiKey?: string | null;
  modelName?: string | null;
  modelJsonMode?: "prompt" | "json_object";
};

const runtimeModelConfig: RuntimeModelConfig = {};

export function setRuntimeModelConfig(cfg: RuntimeModelConfig): void {
  if (cfg.modelBaseUrl !== undefined) runtimeModelConfig.modelBaseUrl = cfg.modelBaseUrl;
  if (cfg.modelApiKey !== undefined) runtimeModelConfig.modelApiKey = cfg.modelApiKey;
  if (cfg.modelName !== undefined) runtimeModelConfig.modelName = cfg.modelName;
  if (cfg.modelJsonMode !== undefined) runtimeModelConfig.modelJsonMode = cfg.modelJsonMode;
}

/** Clears every runtime override so loadConfig falls back entirely to env. */
export function resetRuntimeModelConfig(): void {
  runtimeModelConfig.modelBaseUrl = undefined;
  runtimeModelConfig.modelApiKey = undefined;
  runtimeModelConfig.modelName = undefined;
  runtimeModelConfig.modelJsonMode = undefined;
}

/**
 * Runtime SerpApi configuration, set by the UI's settings panel via
 * POST /api/config. Separate from RuntimeModelConfig: the SerpApi key can be
 * saved or cleared without a restart, and it never leaves the server.
 * `undefined` means "not overridden"; `null` means "explicitly cleared".
 */
export type RuntimeSerpApiConfig = {
  apiKey?: string | null;
};

const runtimeSerpApiConfig: RuntimeSerpApiConfig = {};

export function setRuntimeSerpApiConfig(update: RuntimeSerpApiConfig): void {
  if (update.apiKey !== undefined) runtimeSerpApiConfig.apiKey = update.apiKey;
}

export function resetRuntimeSerpApiConfig(): void {
  runtimeSerpApiConfig.apiKey = undefined;
}

/** Path to the local, git-ignored env file that settings-panel values land in. */
export function envLocalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ENV_LOCAL_FILE ? path.resolve(env.ENV_LOCAL_FILE) : path.resolve(process.cwd(), ".env.local");
}

export type ServerConfig = {
  modelBaseUrl: string | null;
  modelApiKey: string | null;
  modelName: string | null;
  modelJsonMode: "prompt" | "json_object";
  /** Hard deadline for a single model call (ms); the run aborts when exceeded. */
  modelTimeoutMs: number;
  /** Server-only SerpApi API key; never exposed to the client. */
  serpApiKey: string | null;
  serpApiBaseUrl: string;
  serpApiTimeoutMs: number;
  runsDir: string;
  /** Local review cache root for the Apple RSS source (git-ignored). */
  sourceCacheDir: string;
  /** Root where preview snapshots are stored (git-ignored). */
  sourcePreviewsDir: string;
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
  const sourceCacheDir = env.SOURCE_CACHE_DIR ? path.resolve(env.SOURCE_CACHE_DIR) : path.resolve(process.cwd(), "data", "source-cache");
  const sourcePreviewsDir = env.SOURCE_PREVIEWS_DIR ? path.resolve(env.SOURCE_PREVIEWS_DIR) : path.resolve(process.cwd(), "data", "source-previews");
  // Runtime overrides (set from the settings panel) take precedence over the
  // process environment, which was frozen from `.env.local` at startup.
  const modelBaseUrl = runtimeModelConfig.modelBaseUrl !== undefined ? runtimeModelConfig.modelBaseUrl : (env.MODEL_BASE_URL?.trim() || null);
  const modelApiKey = runtimeModelConfig.modelApiKey !== undefined ? runtimeModelConfig.modelApiKey : (env.MODEL_API_KEY?.trim() || null);
  const modelName = runtimeModelConfig.modelName !== undefined ? runtimeModelConfig.modelName : (env.MODEL_NAME?.trim() || null);
  const effectiveJsonMode = runtimeModelConfig.modelJsonMode ?? jsonMode;
  const serpApiKey = runtimeSerpApiConfig.apiKey !== undefined
    ? runtimeSerpApiConfig.apiKey
    : (env.SERPAPI_API_KEY?.trim() || null);
  return {
    modelBaseUrl,
    modelApiKey,
    modelName,
    modelJsonMode: effectiveJsonMode,
    // A single topic-discovery call often takes minutes on a large prompt;
    // 300s default, floored at 10s so a 0/negative env cannot abort instantly.
    modelTimeoutMs: Math.max(10_000, intFromEnv("MODEL_TIMEOUT_MS", 300_000)),
    serpApiKey,
    serpApiBaseUrl: serpApiBaseUrl(env.SERPAPI_BASE_URL),
    serpApiTimeoutMs: Math.max(10_000, intFromEnv("SERPAPI_TIMEOUT_MS", 60_000)),
    runsDir,
    sourceCacheDir,
    sourcePreviewsDir,
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

/** True when an API key is present (so the UI can show it as configured). */
export function isModelApiKeyConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.modelApiKey);
}

const SERPAPI_ORIGIN = "https://serpapi.com";

/**
 * Resolves the SerpApi base URL. Only the official origin or a loopback
 * override (tests) is accepted; any other remote value is replaced with the
 * official origin so a stray setting cannot route keys to a rogue host.
 */
function serpApiBaseUrl(raw: string | undefined): string {
  const value = raw?.trim().replace(/\/+$/, "") || SERPAPI_ORIGIN;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    return value === SERPAPI_ORIGIN || loopback ? value : SERPAPI_ORIGIN;
  } catch {
    return SERPAPI_ORIGIN;
  }
}

/** True when a SerpApi key is present (server-only live reviews). */
export function isSerpApiConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.serpApiKey);
}

/**
 * Reads the current `.env.local` key/value pairs so the settings panel can
 * prefill form fields and persisting preserves unrelated entries (e.g. a
 * RUNS_DIR the user set by hand). Uses simple line parsing; values are kept as
 * raw strings and never interpolated.
 */
export function readEnvLocal(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const file = envLocalPath(env);
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.startsWith('"') &&
      value.endsWith('"') &&
      value.length >= 2
    ) {
      // A quoted value may contain escaped quotes/backslashes that we wrote
      // ourselves via quoteEnvValue; unescape them so read-then-persist is a
      // stable round trip.
      value = value
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    out[key] = value;
  }
  return out;
}

/**
 * Writes a single configuration value into `.env.local` (e.g. MODEL_* or
 * SERPAPI_API_KEY), preserving the other keys present in the file. Values
 * with quotes, spaces or `#` are double-quoted; everything else is written
 * bare. The file is git-ignored, so a key never reaches the repository.
 */
export function persistEnvLocal(key: string, value: string | null, env: NodeJS.ProcessEnv = process.env): void {
  const current = readEnvLocal(env);
  if (value === null) delete current[key];
  else current[key] = value;
  const lines = Object.entries(current)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${quoteEnvValue(v)}`);
  const file = envLocalPath(env);
  // The parent directory may not exist yet (e.g. an isolated ENV_LOCAL_FILE
  // used by tests); create it so the write never fails on a missing dir.
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}

function quoteEnvValue(value: string): string {
  if (!/[ "#=]/.test(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
