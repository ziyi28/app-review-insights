import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, POST } from "./route";
import { loadConfig, setRuntimeModelConfig, resetRuntimeModelConfig, setRuntimeSocialCrawlConfig, resetRuntimeSocialCrawlConfig } from "@/server/config";
import type { RuntimeModelConfig } from "@/server/config";

const saved = { ...process.env };
let envFile = "";

beforeEach(() => {
  process.env = { ...saved };
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_NAME;
  delete process.env.MODEL_JSON_MODE;
  delete process.env.SOCIALCRAWL_API_KEY;
  delete process.env.SOCIALCRAWL_BASE_URL;
  delete process.env.SOCIALCRAWL_TIMEOUT_MS;
  envFile = path.join(mkdtempSync(path.join(tmpdir(), "cfgroute-")), ".env.local");
  process.env.ENV_LOCAL_FILE = envFile;
  resetRuntimeModelConfig();
  resetRuntimeSocialCrawlConfig();
});

afterEach(() => {
  process.env = saved;
  resetRuntimeModelConfig();
  resetRuntimeSocialCrawlConfig();
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

describe("GET /api/config", () => {
  it("reports model status without exposing the api key", async () => {
    process.env.MODEL_BASE_URL = "https://api.example.com/v1";
    process.env.MODEL_API_KEY = "sk-secret";
    process.env.MODEL_NAME = "model-x";
    const res = await GET();
    const json = await jsonResponse(res);
    expect(json.modelConfigured).toBe(true);
    expect(json.modelApiKeyConfigured).toBe(true);
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
  it("applies the update in-process and persists it to .env.local", async () => {
    const res = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelBaseUrl: "https://new.example.com/v1",
        modelApiKey: "sk-new-key",
        modelName: "new-model",
        modelJsonMode: "json_object",
      }),
    }));
    expect(res.status).toBe(200);

    // In-process: loadConfig reflects the new values without a restart.
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBe("https://new.example.com/v1");
    expect(cfg.modelApiKey).toBe("sk-new-key");
    expect(cfg.modelName).toBe("new-model");
    expect(cfg.modelJsonMode).toBe("json_object");
    expect(cfg.modelBaseUrl).toBe((await jsonResponse(res)).modelBaseUrl as string);

    // Persisted: the key lands in the git-ignored .env.local file.
    const raw = readFileSync(envFile, "utf8");
    expect(raw).toContain("MODEL_BASE_URL=https://new.example.com/v1");
    expect(raw).toContain("MODEL_API_KEY=sk-new-key");
    expect(raw).toContain("MODEL_NAME=new-model");
    expect(raw).toContain("MODEL_JSON_MODE=json_object");
  });

  it("null clears a field at runtime and in .env.local", async () => {
    process.env.MODEL_BASE_URL = "https://old.example.com/v1";
    writeFileSync(envFile, "MODEL_BASE_URL=https://old.example.com/v1\n", "utf8");
    const res = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelBaseUrl: null }),
    }));
    expect(res.status).toBe(200);
    const cfg = loadConfig();
    expect(cfg.modelBaseUrl).toBeNull();
    expect(readFileSync(envFile, "utf8")).not.toContain("MODEL_BASE_URL");
    expect((await jsonResponse(res)).modelBaseUrl).toBeNull();
  });

  it("omitted fields are untouched", async () => {
    process.env.MODEL_NAME = "keep-me";
    setRuntimeModelConfig({ modelBaseUrl: "https://existing.example.com/v1" } satisfies RuntimeModelConfig);
    const res = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelApiKey: "sk-abc" }),
    }));
    expect(res.status).toBe(200);
    const cfg = loadConfig();
    expect(cfg.modelName).toBe("keep-me");
    expect(cfg.modelBaseUrl).toBe("https://existing.example.com/v1");
    expect(cfg.modelApiKey).toBe("sk-abc");
  });

  it("rejects an invalid url", async () => {
    const res = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelBaseUrl: "not-a-url" }),
    }));
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

  it("rejects an empty or oversized SocialCrawl key with 422", async () => {
    const empty = await POST(configRequest({ socialCrawlApiKey: "   " }));
    expect(empty.status).toBe(422);
    const oversized = await POST(configRequest({ socialCrawlApiKey: "x".repeat(4097) }));
    expect(oversized.status).toBe(422);
  });
});

describe("SocialCrawl configuration route", () => {
  it("reports only whether the SocialCrawl key is configured", async () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_server_secret";
    const json = await jsonResponse(await GET());
    expect(json.socialCrawlApiKeyConfigured).toBe(true);
    expect(json).not.toHaveProperty("socialCrawlApiKey");
    expect(JSON.stringify(json)).not.toContain("sc_server_secret");
  });

  it("saves a SocialCrawl key, applies it immediately, and never echoes it", async () => {
    const res = await POST(configRequest({ socialCrawlApiKey: "sc_saved_from_page" }));
    expect(res.status).toBe(200);
    expect(loadConfig().socialCrawlApiKey).toBe("sc_saved_from_page");
    expect(readFileSync(envFile, "utf8")).toContain("SOCIALCRAWL_API_KEY=sc_saved_from_page");
    const json = await jsonResponse(res);
    expect(json.socialCrawlApiKeyConfigured).toBe(true);
    expect(JSON.stringify(json)).not.toContain("sc_saved_from_page");
  });

  it("clears only the SocialCrawl key and preserves model configuration", async () => {
    writeFileSync(envFile, "SOCIALCRAWL_API_KEY=sc_old\nMODEL_NAME=keep-me\n", "utf8");
    setRuntimeSocialCrawlConfig({ apiKey: "sc_old" });
    const res = await POST(configRequest({ socialCrawlApiKey: null }));
    expect(res.status).toBe(200);
    expect(loadConfig().socialCrawlApiKey).toBeNull();
    expect(readFileSync(envFile, "utf8")).not.toContain("SOCIALCRAWL_API_KEY");
    expect(readFileSync(envFile, "utf8")).toContain("MODEL_NAME=keep-me");
  });
});
