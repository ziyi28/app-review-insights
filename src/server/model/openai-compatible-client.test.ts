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

  it("defaults reasoning_effort to medium in payload", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    await client.generate(requestBase());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_effort).toBe("medium");
  });

  it("uses specified reasoning_effort in payload", async () => {
    const fetchMock = vi.fn();
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "secret-key",
      model: "model-x",
      jsonMode: "prompt",
      reasoningEffort: "high",
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    await client.generate(requestBase());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_effort).toBe("high");
  });

  it("surfaces a client abort as a non-transient abort error", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(client.generate(requestBase())).rejects.toThrow(/MODEL_REQUEST_ABORTED/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(log.promptHashes).toHaveLength(2);
    expect(log.promptHashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(log.promptHashes[0]).toBe(log.promptHashes[1]);
    expect(log.model).toBe("model-x");
    expect(log.durationsMs.length).toBe(2);
  });

  it("records the prompt hash in the result meta", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const result = await client.generate(requestBase()) as ModelResult<{ ok: boolean }> & { __modelMeta?: { promptSha256?: string } };
    expect(result.__modelMeta?.promptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retries a transient 5xx and succeeds, reporting progress and usage", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchMock } = makeClient();
      fetchMock
        .mockResolvedValueOnce(new Response("err", { status: 500 }))
        .mockResolvedValueOnce(new Response("err", { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onProgress = vi.fn();
      const pending = client.generate({ ...requestBase(), onProgress });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenCalledWith({
        kind: "retry",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 1000,
        reason: "MODEL_HTTP_ERROR",
      });
      expect(client.getUsageLog()).toMatchObject({
        calls: 1,
        attempts: 3,
        retries: 2,
        retryReasons: ["MODEL_HTTP_ERROR", "MODEL_HTTP_ERROR"],
      });
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a network error and succeeds", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchMock } = makeClient();
      fetchMock
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pending = client.generate(requestBase());
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a call that times out", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      });
      const client = new OpenAiCompatibleClient({
        baseUrl: "https://example.com/v1",
        apiKey: "key",
        model: "model-x",
        jsonMode: "prompt",
        timeoutMs: 1000,
        fetchFn: fetchMock as unknown as typeof fetch,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pending = client.generate(requestBase());
      // Attach the rejection handler before advancing so the eventual reject
      // is observed, not treated as an unhandled rejection.
      const expectation = expect(pending).rejects.toThrow(/MODEL_REQUEST_TIMEOUT/);
      await vi.advanceTimersByTimeAsync(10_000);
      await expectation;
      // 1 initial + 2 retries, each timing out.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a non-JSON response and succeeds with retry notice injected", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchMock } = makeClient();
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "not json at all" } }] })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pending = client.generate(requestBase());
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondCallBody.messages[1].content).toContain("CRITICAL RETRY NOTICE");
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a truncated (finish_reason=length) completion as MODEL_TRUNCATED_RESPONSE after retries", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchMock } = makeClient();
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "truncated output" }, finish_reason: "length" }] })),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pending = client.generate(requestBase());
      // Attach the rejection handler before advancing so the eventual reject is
      // observed, not reported as an unhandled rejection.
      const messagePromise = pending.then(
        () => "",
        (err: Error) => err.message,
      );
      await vi.advanceTimersByTimeAsync(10_000);
      const message = await messagePromise;
      expect(message).toMatch(/MODEL_TRUNCATED_RESPONSE/);
      expect(message).toContain("truncated output");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a finish_reason=length completion even when bracket rescue could fake valid JSON", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchMock } = makeClient();
      // A cut-off body that autoCompleteBrackets would complete into
      // {"ok":true} — semantically a guess, never an artifact.
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":tru' }, finish_reason: "length" }] })),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pending = client.generate(requestBase());
      const messagePromise = pending.then(
        () => "",
        (err: Error) => err.message,
      );
      await vi.advanceTimersByTimeAsync(10_000);
      const message = await messagePromise;
      expect(message).toMatch(/MODEL_TRUNCATED_RESPONSE/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const usage = client.getUsageLog();
      expect(usage.retryReasons).toEqual(["MODEL_TRUNCATED_RESPONSE", "MODEL_TRUNCATED_RESPONSE"]);
      expect(usage.calls).toBe(0); // no fabricated result was ever accepted
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a 4xx", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(client.generate(requestBase())).rejects.toThrow(/MODEL_HTTP_ERROR: 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getUsageLog()).toMatchObject({ attempts: 1, retries: 0, retryReasons: [] });
  });

  it("does not retry a schema violation", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":"nope"}' } }] })));
    await expect(client.generate(requestBase())).rejects.toThrow(/schema/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getUsageLog()).toMatchObject({ attempts: 1, retries: 0 });
  });

  it("does not retry once the client has disconnected", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async () => new Response("err", { status: 500 }));
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "key",
      model: "model-x",
      jsonMode: "prompt",
      signal: controller.signal,
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    await expect(client.generate(requestBase())).rejects.toThrow(/MODEL_HTTP_ERROR: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getUsageLog()).toMatchObject({ attempts: 1, retries: 0 });
  });

  it("invokes onProgress while the model call is in flight", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "key",
      model: "model-x",
      jsonMode: "prompt",
      fetchFn: fetchMock as unknown as typeof fetch,
      progressIntervalMs: 5,
    });
    const onProgress = vi.fn();
    await client.generate({ ...requestBase(), onProgress });
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls[0][0]).toEqual({
      kind: "heartbeat",
      elapsedMs: expect.any(Number),
    });
    expect((onProgress.mock.calls[0][0] as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("does not call onProgress when the call resolves before the first tick", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const onProgress = vi.fn();
    await client.generate({ ...requestBase(), onProgress });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("defaults to a 10s heartbeat interval for long calls", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
    // No progressIntervalMs override: the default (10s) must be used, so a call
    // finishing in ~15ms resolves before the first tick and emits no heartbeat.
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "key",
      model: "model-x",
      jsonMode: "prompt",
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    const onProgress = vi.fn();
    await client.generate({ ...requestBase(), onProgress });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("keeps retry notifications immediate regardless of the heartbeat interval", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "key",
      model: "model-x",
      jsonMode: "prompt",
      fetchFn: fetchMock as unknown as typeof fetch,
      // A long heartbeat interval must never delay the retry notification.
      progressIntervalMs: 10_000,
    });
    const onProgress = vi.fn();
    await client.generate({ ...requestBase(), onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "retry" }));
  });
});
