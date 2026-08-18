import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, isModelConfigured, isModelApiKeyConfigured, setRuntimeModelConfig, resetRuntimeModelConfig, setRuntimeSerpApiConfig, resetRuntimeSerpApiConfig, isSerpApiConfigured, readEnvLocal, persistEnvLocal, envLocalPath, readPersistedConfig, persistRuntimeConfig, dataConfigPath } from "./config";

const saved = { ...process.env };

function tempEnvLocal(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "cfgenv-")), ".env.local");
}

beforeEach(() => {
  process.env = { ...saved };
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_NAME;
  delete process.env.MODEL_JSON_MODE;
  delete process.env.MODEL_REASONING_EFFORT;
  delete process.env.MODEL_TIMEOUT_MS;
  delete process.env.RUNS_DIR;
  delete process.env.APPLE_RSS_BASE_URL;
  delete process.env.APPLE_RSS_PAGE_DELAY_MS;
  delete process.env.REPLAY_EVENT_DELAY_MS;
  delete process.env.ENV_LOCAL_FILE;
  // Point data/config.local.json at a temp path that does not exist, so a real
  // settings-panel file saved on this machine can never leak into loadConfig
  // assertions (deleting the var would fall back to the cwd file).
  process.env.DATA_CONFIG_FILE = path.join(mkdtempSync(path.join(tmpdir(), "cfgjson-")), "config.local.json");
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_BASE_URL;
  delete process.env.SERPAPI_TIMEOUT_MS;
  // Reset the module-level runtime overrides so state never leaks between cases.
  resetRuntimeModelConfig();
  resetRuntimeSerpApiConfig();
});

afterEach(() => {
  process.env = saved;
  resetRuntimeSerpApiConfig();
});

describe("loadConfig", () => {
  it("uses defaults when nothing is configured", () => {
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBeNull();
    expect(cfg.modelName).toBeNull();
    expect(cfg.modelJsonMode).toBe("prompt");
    expect(cfg.modelReasoningEffort).toBe("medium");
    expect(cfg.modelTimeoutMs).toBe(300_000);
    expect(cfg.appleRssMaxPages).toBe(10);
    expect(cfg.appleRssPageDelayMs).toBe(500);
    expect(isModelConfigured(cfg)).toBe(false);
  });

  it("parses full model configuration", () => {
    process.env.MODEL_BASE_URL = " https://api.example.com/v1 ";
    process.env.MODEL_API_KEY = " key ";
    process.env.MODEL_NAME = " model-x ";
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBe("https://api.example.com/v1");
    expect(cfg.modelApiKey).toBe("key");
    expect(cfg.modelName).toBe("model-x");
    expect(isModelConfigured(cfg)).toBe(true);
  });

  it("supports json_object mode", () => {
    process.env.MODEL_JSON_MODE = "json_object";
    expect(loadConfig().modelJsonMode).toBe("json_object");
  });

  it("supports valid reasoning effort levels and falls back to medium on invalid input", () => {
    for (const level of ["low", "medium", "high", "max"] as const) {
      process.env.MODEL_REASONING_EFFORT = level;
      expect(loadConfig().modelReasoningEffort).toBe(level);
    }

    process.env.MODEL_REASONING_EFFORT = "super-high";
    expect(loadConfig().modelReasoningEffort).toBe("medium");
  });

  it("parses numeric limits and enforces rate-limit discipline", () => {
    process.env.APPLE_RSS_PAGE_DELAY_MS = "250";
    process.env.APPLE_RSS_MAX_PAGES = "3";
    process.env.REPLAY_EVENT_DELAY_MS = "10";
    process.env.APPLE_RSS_TIMEOUT_MS = "5000";
    const cfg = loadConfig();
    // Delay below the documented 500ms floor is clamped up.
    expect(cfg.appleRssPageDelayMs).toBe(500);
    expect(cfg.appleRssMaxPages).toBe(3);
    expect(cfg.replayEventDelayMs).toBe(10);

    // Overriding the max pages cap is clamped to 10.
    process.env.APPLE_RSS_MAX_PAGES = "100";
    expect(loadConfig().appleRssMaxPages).toBe(10);

    process.env.APPLE_RSS_PAGE_DELAY_MS = "not-a-number";
    expect(loadConfig().appleRssPageDelayMs).toBe(500);
  });

  it("parses model timeout with a floor", () => {
    process.env.MODEL_TIMEOUT_MS = "180000";
    expect(loadConfig().modelTimeoutMs).toBe(180_000);

    // A too-small value is clamped up so a misconfig cannot abort instantly.
    process.env.MODEL_TIMEOUT_MS = "0";
    expect(loadConfig().modelTimeoutMs).toBe(10_000);

    process.env.MODEL_TIMEOUT_MS = "not-a-number";
    expect(loadConfig().modelTimeoutMs).toBe(300_000);
  });

  it("resolves runsDir and supports an apple rss override", () => {
    process.env.RUNS_DIR = "./custom-runs";
    process.env.APPLE_RSS_BASE_URL = "http://127.0.0.1:9999/rss";
    const cfg = loadConfig();
    expect(cfg.runsDir).toContain("custom-runs");
    expect(cfg.appleRssBaseUrl).toBe("http://127.0.0.1:9999/rss");
  });
});

describe("runtime model overrides", () => {
  it("loadConfig prefers a runtime override over the process env", () => {
    process.env.MODEL_BASE_URL = "https://env.example.com/v1";
    process.env.MODEL_API_KEY = "env-key";
    process.env.MODEL_NAME = "env-model";
    setRuntimeModelConfig({
      modelBaseUrl: "https://runtime.example.com/v1",
      modelApiKey: "runtime-key",
      modelName: "runtime-model",
      modelJsonMode: "json_object",
    });
    try {
      const cfg = loadConfig();
      expect(cfg.modelBaseUrl).toBe("https://runtime.example.com/v1");
      expect(cfg.modelApiKey).toBe("runtime-key");
      expect(cfg.modelName).toBe("runtime-model");
      expect(cfg.modelJsonMode).toBe("json_object");
      expect(isModelConfigured(cfg)).toBe(true);
      expect(isModelApiKeyConfigured(cfg)).toBe(true);
    } finally {
      resetRuntimeModelConfig();
    }
  });

  it("a null runtime override clears the field even when env has a value", () => {
    process.env.MODEL_BASE_URL = "https://env.example.com/v1";
    setRuntimeModelConfig({ modelBaseUrl: null, modelName: null });
    try {
      const cfg = loadConfig();
      expect(cfg.modelBaseUrl).toBeNull();
      expect(cfg.modelName).toBeNull();
      expect(isModelConfigured(cfg)).toBe(false);
    } finally {
      resetRuntimeModelConfig();
    }
  });

  it("omitted fields fall back to the process env", () => {
    process.env.MODEL_NAME = "env-model";
    setRuntimeModelConfig({ modelBaseUrl: "https://x.example.com/v1" });
    try {
      const cfg = loadConfig();
      expect(cfg.modelBaseUrl).toBe("https://x.example.com/v1");
      expect(cfg.modelName).toBe("env-model");
      expect(cfg.modelJsonMode).toBe("prompt");
    } finally {
      resetRuntimeModelConfig();
    }
  });
});

describe("SerpApi configuration", () => {
  it("keeps SerpApi server-only and disabled without a key", () => {
    const cfg = loadConfig();
    expect(cfg.serpApiKey).toBeNull();
    expect(cfg.serpApiBaseUrl).toBe("https://serpapi.com");
    expect(cfg.serpApiTimeoutMs).toBe(60_000);
    expect(isSerpApiConfigured(cfg)).toBe(false);
  });

  it("loads a trimmed SerpApi key and allows only a loopback test override", () => {
    process.env.SERPAPI_API_KEY = " serp_test_only ";
    process.env.SERPAPI_BASE_URL = "http://127.0.0.1:39876";
    const cfg = loadConfig();
    expect(cfg.serpApiKey).toBe("serp_test_only");
    expect(cfg.serpApiBaseUrl).toBe("http://127.0.0.1:39876");
    expect(isSerpApiConfigured(cfg)).toBe(true);
  });

  it("rejects a non-official remote SerpApi base URL", () => {
    process.env.SERPAPI_BASE_URL = "https://collector.example.com";
    expect(loadConfig().serpApiBaseUrl).toBe("https://serpapi.com");
  });

  it("applies and clears a SerpApi runtime key without restart", () => {
    process.env.SERPAPI_API_KEY = "serp_from_env";
    setRuntimeSerpApiConfig({ apiKey: "serp_from_page" });
    expect(loadConfig().serpApiKey).toBe("serp_from_page");
    setRuntimeSerpApiConfig({ apiKey: null });
    expect(loadConfig().serpApiKey).toBeNull();
  });

  it("ignores legacy SocialCrawl environment variables", () => {
    process.env.SOCIALCRAWL_API_KEY = "legacy-secret";
    process.env.SOCIALCRAWL_BASE_URL = "https://www.socialcrawl.dev";
    process.env.SOCIALCRAWL_TIMEOUT_MS = "60000";
    expect(loadConfig().serpApiKey).toBeNull();
  });
});

describe("env.local read/persist", () => {
  it("reads keys and preserves unrelated entries when persisting", () => {
    const file = tempEnvLocal();
    process.env.ENV_LOCAL_FILE = file;
    writeFileSync(file, "# comment\nMODEL_BASE_URL=https://a.example.com/v1\nRUNS_DIR=./custom-runs\n", "utf8");
    expect(readEnvLocal()).toEqual({
      MODEL_BASE_URL: "https://a.example.com/v1",
      RUNS_DIR: "./custom-runs",
    });

    persistEnvLocal("MODEL_BASE_URL", "https://b.example.com/v1");
    expect(readEnvLocal()).toEqual({
      MODEL_BASE_URL: "https://b.example.com/v1",
      RUNS_DIR: "./custom-runs",
    });
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("strips surrounding double quotes and re-quotes values needing escaping", () => {
    const file = tempEnvLocal();
    process.env.ENV_LOCAL_FILE = file;
    writeFileSync(file, 'MODEL_API_KEY="sk-with-space key"\n', "utf8");
    expect(readEnvLocal()).toEqual({ MODEL_API_KEY: "sk-with-space key" });

    persistEnvLocal("MODEL_API_KEY", "sk#weird=value \"quoted\"");
    const raw = readEnvLocal();
    expect(raw.MODEL_API_KEY).toBe('sk#weird=value "quoted"');
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("deletes a key when persisting null and creates the file when missing", () => {
    const file = tempEnvLocal();
    process.env.ENV_LOCAL_FILE = file;
    expect(existsSync(file)).toBe(false);
    persistEnvLocal("MODEL_API_KEY", "sk-123");
    expect(readEnvLocal()).toEqual({ MODEL_API_KEY: "sk-123" });

    persistEnvLocal("MODEL_API_KEY", null);
    expect(readEnvLocal()).toEqual({});
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("defaults envLocalPath to the cwd .env.local when ENV_LOCAL_FILE is unset", () => {
    expect(envLocalPath()).toBe(path.resolve(process.cwd(), ".env.local"));
  });

  it("creates the parent directory when persisting to a nested ENV_LOCAL_FILE", () => {
    const nested = path.join(mkdtempSync(path.join(tmpdir(), "cfgenv-")), "nested", "dir", ".env.local");
    process.env.ENV_LOCAL_FILE = nested;
    persistEnvLocal("MODEL_NAME", "model-x");
    expect(readEnvLocal()).toEqual({ MODEL_NAME: "model-x" });
    rmSync(path.dirname(path.dirname(path.dirname(nested))), { recursive: true, force: true });
  });
});

describe("data/config.local.json persistence and precedence", () => {
  function tempDataConfig(): string {
    return path.join(mkdtempSync(path.join(tmpdir(), "cfgjson-")), "config.local.json");
  }

  it("defaults dataConfigPath to the cwd data dir when DATA_CONFIG_FILE is unset", () => {
    // beforeEach redirects the var for isolation; this case tests the unset default.
    delete process.env.DATA_CONFIG_FILE;
    expect(dataConfigPath()).toBe(path.resolve(process.cwd(), "data", "config.local.json"));
  });

  it("loadConfig prefers runtime override > persisted json > process env", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    writeFileSync(file, JSON.stringify({ MODEL_BASE_URL: "https://json.example.com/v1" }), "utf8");
    process.env.MODEL_BASE_URL = "https://env.example.com/v1";
    process.env.MODEL_API_KEY = "env-key";
    process.env.MODEL_NAME = "env-model";
    setRuntimeModelConfig({ modelBaseUrl: "https://runtime.example.com/v1" });
    try {
      const cfg = loadConfig();
      expect(cfg.modelBaseUrl).toBe("https://runtime.example.com/v1");
      expect(cfg.modelApiKey).toBe("env-key");
      expect(cfg.modelName).toBe("env-model");
    } finally {
      resetRuntimeModelConfig();
    }

    // Without the runtime override the persisted json wins over env.
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBe("https://json.example.com/v1");
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("an explicit null in the json clears a field even when env has a value", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    writeFileSync(file, JSON.stringify({ MODEL_API_KEY: null }), "utf8");
    process.env.MODEL_API_KEY = "env-key";
    expect(loadConfig().modelApiKey).toBeNull();
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("an invalid json mode in the file falls back to env instead of failing", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    writeFileSync(file, JSON.stringify({ MODEL_JSON_MODE: "garbage" }), "utf8");
    process.env.MODEL_JSON_MODE = "json_object";
    expect(loadConfig().modelJsonMode).toBe("json_object");
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("an invalid reasoning effort in the file falls back to env instead of failing", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    writeFileSync(file, JSON.stringify({ MODEL_REASONING_EFFORT: "super-high" }), "utf8");
    process.env.MODEL_REASONING_EFFORT = "low";
    expect(loadConfig().modelReasoningEffort).toBe("low");
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("a corrupt json file is tolerated and reads as empty", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    writeFileSync(file, "{ not json", "utf8");
    process.env.MODEL_BASE_URL = "https://env.example.com/v1";
    expect(readPersistedConfig()).toEqual({});
    expect(loadConfig().modelBaseUrl).toBe("https://env.example.com/v1");
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("persistRuntimeConfig merges updates, preserves unknown keys, and writes atomically", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    writeFileSync(file, JSON.stringify({ MODEL_NAME: "prev-model", FUTURE_KEY: "keep-me" }), "utf8");

    persistRuntimeConfig({ model: { modelBaseUrl: "https://new.example.com/v1" }, serpApi: { apiKey: "serp-key" } });
    const persisted = readPersistedConfig();
    expect(persisted.MODEL_NAME).toBe("prev-model");
    expect(persisted.MODEL_BASE_URL).toBe("https://new.example.com/v1");
    expect(persisted.SERPAPI_API_KEY).toBe("serp-key");
    // Unknown keys from a newer config version survive the merge.
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ FUTURE_KEY: "keep-me" });
    // Atomic write leaves no temp file behind.
    expect(existsSync(`${file}.tmp`)).toBe(false);
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("persistRuntimeConfig applies runtime overrides and skips the disk write when nothing changed", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    persistRuntimeConfig({ model: { modelName: "model-x" } });
    expect(loadConfig().modelName).toBe("model-x");

    // Make the file unwritable: persisting the same value must skip writing
    // (no throw); persisting a new value attempts the write and throws.
    chmodSync(file, 0o444);
    try {
      expect(() => persistRuntimeConfig({ model: { modelName: "model-x" } })).not.toThrow();
      expect(() => persistRuntimeConfig({ model: { modelName: "model-y" } })).toThrow();
    } finally {
      chmodSync(file, 0o666);
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("a json value applies after a simulated restart (fresh process, empty runtime)", () => {
    const file = tempDataConfig();
    process.env.DATA_CONFIG_FILE = file;
    persistRuntimeConfig({ model: { modelBaseUrl: "https://saved.example.com/v1", modelJsonMode: "json_object", modelReasoningEffort: "high" }, serpApi: { apiKey: "serp-saved" } });
    resetRuntimeModelConfig();
    resetRuntimeSerpApiConfig();
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBe("https://saved.example.com/v1");
    expect(cfg.modelJsonMode).toBe("json_object");
    expect(cfg.modelReasoningEffort).toBe("high");
    expect(cfg.serpApiKey).toBe("serp-saved");
    rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
