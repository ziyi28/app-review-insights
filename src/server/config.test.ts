import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, isModelConfigured, isModelApiKeyConfigured, setRuntimeModelConfig, resetRuntimeModelConfig, readEnvLocal, persistEnvLocal, envLocalPath } from "./config";

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
  delete process.env.RUNS_DIR;
  delete process.env.APPLE_RSS_BASE_URL;
  delete process.env.APPLE_RSS_PAGE_DELAY_MS;
  delete process.env.REPLAY_EVENT_DELAY_MS;
  delete process.env.ENV_LOCAL_FILE;
  // Reset the module-level runtime overrides so state never leaks between cases.
  resetRuntimeModelConfig();
});

afterEach(() => {
  process.env = saved;
});

describe("loadConfig", () => {
  it("uses defaults when nothing is configured", () => {
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBeNull();
    expect(cfg.modelName).toBeNull();
    expect(cfg.modelJsonMode).toBe("prompt");
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
});
