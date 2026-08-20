import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, POST } from "./route";
import { loadConfig, setRuntimeModelConfig, resetRuntimeModelConfig, setRuntimeSerpApiConfig, resetRuntimeSerpApiConfig, readPersistedConfig } from "@/server/config";
import type { RuntimeModelConfig } from "@/server/config";

const saved = { ...process.env };
let envFile = "";
let dataFile = "";

beforeEach(() => {
  process.env = { ...saved };
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_NAME;
  delete process.env.MODEL_JSON_MODE;
  delete process.env.MODEL_REASONING_EFFORT;
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_BASE_URL;
  delete process.env.SERPAPI_TIMEOUT_MS;
  const envDir = mkdtempSync(path.join(tmpdir(), "cfgroute-"));
  envFile = path.join(envDir, ".env.local");
  dataFile = path.join(envDir, "data", "config.local.json");
  mkdirSync(path.dirname(dataFile), { recursive: true });
  process.env.ENV_LOCAL_FILE = envFile;
  process.env.DATA_CONFIG_FILE = dataFile;
  resetRuntimeModelConfig();
  resetRuntimeSerpApiConfig();
});

afterEach(() => {
  process.env = saved;
  resetRuntimeModelConfig();
  resetRuntimeSerpApiConfig();
  if (envFile) rmSync(path.dirname(envFile), { recursive: true, force: true });
});

async function jsonResponse(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function configRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readDataFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(dataFile, "utf8")) as Record<string, unknown>;
}

describe("GET /api/config", () => {
  it("reports model status without exposing the api key", async () => {
    process.env.MODEL_BASE_URL = "https://api.example.com/v1";
    process.env.MODEL_API_KEY = "sk-secret";
    process.env.MODEL_NAME = "model-x";
    const res = await GET();
    const json = await jsonResponse(res);
    expect(json.modelConfigured).toBe(true);
    expect(json.modelApiKeyConfigured).toBe(true);
    expect(json.reasoningEffort).toBe("medium");
    expect(JSON.stringify(json)).not.toContain("sk-secret");
  });

  it("reports not configured when only an api key is present", async () => {
    process.env.MODEL_API_KEY = "sk-secret";
    const json = await jsonResponse(await GET());
    expect(json.modelConfigured).toBe(false);
    expect(json.modelApiKeyConfigured).toBe(true);
  });
});

describe("POST /api/config", () => {
  it("applies the update in-process and persists it to data/config.local.json, never .env.local", async () => {
    const res = await POST(configRequest({
      modelBaseUrl: "https://new.example.com/v1",
      modelApiKey: "sk-new-key",
      modelName: "new-model",
      modelJsonMode: "json_object",
      modelReasoningEffort: "high",
    }));
    expect(res.status).toBe(200);

    // In-process: loadConfig reflects the new values without a restart.
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBe("https://new.example.com/v1");
    expect(cfg.modelApiKey).toBe("sk-new-key");
    expect(cfg.modelName).toBe("new-model");
    expect(cfg.modelJsonMode).toBe("json_object");
    expect(cfg.modelReasoningEffort).toBe("high");
    const json = await jsonResponse(res);
    expect(cfg.modelBaseUrl).toBe(json.modelBaseUrl as string);
    expect(json.reasoningEffort).toBe("high");

    // Persisted to the git-ignored JSON file.
    expect(readDataFile()).toEqual({
      MODEL_BASE_URL: "https://new.example.com/v1",
      MODEL_API_KEY: "sk-new-key",
      MODEL_NAME: "new-model",
      MODEL_JSON_MODE: "json_object",
      MODEL_REASONING_EFFORT: "high",
    });

    // .env.local is never created or touched (touching it would make Next.js
    // reload env and orphan running background tasks).
    expect(existsSync(envFile)).toBe(false);
    // No temp file left behind by the atomic write.
    expect(existsSync(`${dataFile}.tmp`)).toBe(false);
  });

  it("null clears a field at runtime and persists an explicit null in the JSON", async () => {
    process.env.MODEL_BASE_URL = "https://old.example.com/v1";
    const res = await POST(configRequest({ modelBaseUrl: null }));
    expect(res.status).toBe(200);
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBeNull();
    expect(readDataFile()).toEqual({ MODEL_BASE_URL: null });
    expect((await jsonResponse(res)).modelBaseUrl).toBeNull();
  });

  it("omitted fields are untouched", async () => {
    process.env.MODEL_NAME = "keep-me";
    setRuntimeModelConfig({ modelBaseUrl: "https://existing.example.com/v1" } satisfies RuntimeModelConfig);
    const res = await POST(configRequest({ modelApiKey: "sk-abc" }));
    expect(res.status).toBe(200);
    const cfg = loadConfig();
    expect(cfg.modelName).toBe("keep-me");
    expect(cfg.modelBaseUrl).toBe("https://existing.example.com/v1");
    expect(cfg.modelApiKey).toBe("sk-abc");
    expect(readDataFile()).toEqual({ MODEL_API_KEY: "sk-abc" });
  });

  it("merges into an existing JSON file instead of replacing it", async () => {
    writeFileSync(dataFile, JSON.stringify({ MODEL_NAME: "prev-model" }), "utf8");
    const res = await POST(configRequest({ modelBaseUrl: "https://new.example.com/v1" }));
    expect(res.status).toBe(200);
    expect(readDataFile()).toEqual({
      MODEL_NAME: "prev-model",
      MODEL_BASE_URL: "https://new.example.com/v1",
    });
  });

  it("a persisted JSON value survives a simulated restart (no runtime override)", async () => {
    await POST(configRequest({ modelBaseUrl: "https://saved.example.com/v1", modelName: "saved-model" }));
    resetRuntimeModelConfig();
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBe("https://saved.example.com/v1");
    expect(cfg.modelName).toBe("saved-model");
  });

  it("rejects an invalid url", async () => {
    const res = await POST(configRequest({ modelBaseUrl: "not-a-url" }));
    expect(res.status).toBe(422);
  });

  it("rejects an invalid reasoning effort enum with 422", async () => {
    const res = await POST(configRequest({ modelReasoningEffort: "extreme" }));
    expect(res.status).toBe(422);
  });

  it("rejects invalid JSON body", async () => {
    const res = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty or oversized SerpApi key with 422", async () => {
    const empty = await POST(configRequest({ serpApiKey: "   " }));
    expect(empty.status).toBe(422);
    const oversized = await POST(configRequest({ serpApiKey: "x".repeat(4097) }));
    expect(oversized.status).toBe(422);
  });

  it("rejects chunked request body exceeding 64 KiB without Content-Length with 413", async () => {
    const limit = 64 * 1024;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(limit));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/config", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    const res = await POST(request);
    expect(res.status).toBe(413);
  });
});

describe("SerpApi configuration route", () => {
  it("reports only whether the SerpApi key is configured", async () => {
    process.env.SERPAPI_API_KEY = "serp_server_secret";
    const json = await jsonResponse(await GET());
    expect(json.serpApiKeyConfigured).toBe(true);
    expect(json).not.toHaveProperty("serpApiKey");
    expect(JSON.stringify(json)).not.toContain("serp_server_secret");
  });

  it("saves a SerpApi key, applies it immediately, and never echoes it", async () => {
    const res = await POST(configRequest({ serpApiKey: "serp_saved_from_page" }));
    expect(res.status).toBe(200);
    expect(loadConfig().serpApiKey).toBe("serp_saved_from_page");
    expect(readPersistedConfig().SERPAPI_API_KEY).toBe("serp_saved_from_page");
    const json = await jsonResponse(res);
    expect(json.serpApiKeyConfigured).toBe(true);
    expect(JSON.stringify(json)).not.toContain("serp_saved_from_page");
  });

  it("clears only the SerpApi key and preserves model configuration", async () => {
    writeFileSync(dataFile, JSON.stringify({ SERPAPI_API_KEY: "serp_old", MODEL_NAME: "keep-me" }), "utf8");
    setRuntimeSerpApiConfig({ apiKey: "serp_old" });
    const res = await POST(configRequest({ serpApiKey: null }));
    expect(res.status).toBe(200);
    expect(loadConfig().serpApiKey).toBeNull();
    expect(readDataFile()).toEqual({ SERPAPI_API_KEY: null, MODEL_NAME: "keep-me" });
  });

  it("rejects the removed SocialCrawl setting", async () => {
    const res = await POST(configRequest({ socialCrawlApiKey: "legacy" }));
    expect(res.status).toBe(422);
  });
});
