import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, isModelConfigured } from "./config";

const saved = { ...process.env };

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
