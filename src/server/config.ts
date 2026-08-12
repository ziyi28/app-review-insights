import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

/** Path to the local, git-ignored env file that settings-panel values land in. */
export function envLocalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ENV_LOCAL_FILE ? path.resolve(env.ENV_LOCAL_FILE) : path.resolve(process.cwd(), ".env.local");
}

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
  // Runtime overrides (set from the settings panel) take precedence over the
  // process environment, which was frozen from `.env.local` at startup.
  const modelBaseUrl = runtimeModelConfig.modelBaseUrl !== undefined ? runtimeModelConfig.modelBaseUrl : (env.MODEL_BASE_URL?.trim() || null);
  const modelApiKey = runtimeModelConfig.modelApiKey !== undefined ? runtimeModelConfig.modelApiKey : (env.MODEL_API_KEY?.trim() || null);
  const modelName = runtimeModelConfig.modelName !== undefined ? runtimeModelConfig.modelName : (env.MODEL_NAME?.trim() || null);
  const effectiveJsonMode = runtimeModelConfig.modelJsonMode ?? jsonMode;
  return {
    modelBaseUrl,
    modelApiKey,
    modelName,
    modelJsonMode: effectiveJsonMode,
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

/** True when an API key is present (so the UI can show it as configured). */
export function isModelApiKeyConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.modelApiKey);
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
 * Writes a single MODEL_* value into `.env.local`, preserving the other keys
 * present in the file. Values with quotes, spaces or `#` are double-quoted;
 * everything else is written bare. The file is git-ignored, so a key never
 * reaches the repository.
 */
export function persistEnvLocal(key: string, value: string | null, env: NodeJS.ProcessEnv = process.env): void {
  const current = readEnvLocal(env);
  if (value === null) delete current[key];
  else current[key] = value;
  const lines = Object.entries(current)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${quoteEnvValue(v)}`);
  writeFileSync(envLocalPath(env), lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}

function quoteEnvValue(value: string): string {
  if (!/[ "#=]/.test(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
