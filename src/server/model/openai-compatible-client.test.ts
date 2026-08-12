import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { ModelRequest, ModelResult } from "./types";
import { OpenAiCompatibleClient } from "./openai-compatible-client";

const Schema = z.object({ ok: z.boolean() });

function makeClient() {
  const fetchMock = vi.fn();
  const client = new OpenAiCompatibleClient({
    baseUrl: "https://example.com/v1",
    apiKey: "secret-key",
    model: "model-x",
    jsonMode: "prompt",
    fetchFn: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

function requestBase(): ModelRequest<{ ok: boolean }> {
  return {
    stage: "findings",
    promptVersion: "findings@1",
    system: "sys",
    user: "user",
    schema: Schema,
  };
}

describe("OpenAiCompatibleClient", () => {
  it("appends /chat/completions to the base url", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    await client.generate(requestBase());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://example.com/v1/chat/completions");
  });

  it("omits Authorization when the api key is empty", async () => {
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "",
      model: "model-x",
      jsonMode: "prompt",
      fetchFn: (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }))) as typeof fetch,
    });
    const result = await client.generate(requestBase());
    expect(result.ok).toBe(true);
  });

  it("does not persist the api key in the request snapshot", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const result = await client.generate(requestBase());
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("uses temperature 0.1", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    await client.generate(requestBase());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0.1);
  });

  it("distinguishes a timeout error", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(client.generate(requestBase())).rejects.toThrow(/timeout|abort|network/i);
  });

  it("reports a schema validation failure distinctly", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":"nope"}' } }] })));
    await expect(client.generate(requestBase())).rejects.toThrow(/schema/i);
  });

  it("records usage as null when the provider does not return it", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const result = await client.generate(requestBase());
    expect((result as ModelResult<{ ok: boolean }> & { usage?: unknown }).usage).toBeNull();
  });

  it("collects a usage log when the provider returns usage", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })),
    );
    await client.generate(requestBase());
    await client.generate(requestBase());
    const log = client.getUsageLog();
    expect(log.calls).toBe(2);
    expect(log.totalTokens).toBe(30);
    expect(log.promptVersions).toEqual(["findings@1", "findings@1"]);
    expect(log.model).toBe("model-x");
    expect(log.durationsMs.length).toBe(2);
  });

  it("does not retry automatically", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(client.generate(requestBase())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
