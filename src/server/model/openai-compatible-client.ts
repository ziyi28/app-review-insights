import type { ModelJsonMode, ModelMeta, ModelRequest, ModelResult, ModelUsageLog } from "./types";
import { extractJsonObject } from "./parse-json";

export type ModelClientDeps = {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: ModelJsonMode;
  temperature?: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  /** Hard deadline for a single model call; aborts the fetch when exceeded. */
  timeoutMs?: number;
  /** Interval (ms) between onProgress heartbeats while a call is in flight. */
  progressIntervalMs?: number;
};

const TEMPERATURE = 0.1;
const PROGRESS_INTERVAL_MS = 2000;

/**
 * Minimal OpenAI-compatible chat completions client. No provider-specific
 * features, no hidden retries. If the api key is empty no Authorization header
 * is sent (for local model runtimes). The request snapshot strips the key.
 */
export class OpenAiCompatibleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly jsonMode: ModelJsonMode;
  private readonly temperature: number;
  private readonly fetchFn: typeof fetch;
  private readonly signal?: AbortSignal;
  private readonly timeoutMs?: number;
  private readonly progressIntervalMs: number;
  private readonly usageLog: ModelUsageLog;

  constructor(deps: ModelClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.apiKey = deps.apiKey;
    this.model = deps.model;
    this.jsonMode = deps.jsonMode;
    this.temperature = deps.temperature ?? TEMPERATURE;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.signal = deps.signal;
    this.timeoutMs = deps.timeoutMs;
    this.progressIntervalMs = deps.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    this.usageLog = { model: deps.model, provider: safeProviderLabel(deps.baseUrl), temperature: this.temperature, calls: 0, promptVersions: [], totalTokens: null, durationsMs: [] };
  }

  /** Aggregated model usage for the run manifest (never contains the API key). */
  getUsageLog(): ModelUsageLog {
    return { ...this.usageLog, promptVersions: [...this.usageLog.promptVersions] };
  }

  async generate<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const payload: Record<string, unknown> = {
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    };
    if (this.jsonMode === "json_object") {
      payload.response_format = { type: "json_object" };
    }

    const startedAt = Date.now();
    let res: Response;
    let bodyText: string;
    try {
      // Combine the caller's abort signal with a hard per-call deadline.
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      this.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = this.timeoutMs ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
      // Heartbeat while waiting so long calls don't look frozen to the user.
      const heartbeat = request.onProgress
        ? setInterval(() => request.onProgress?.({ elapsedMs: Date.now() - startedAt }), this.progressIntervalMs)
        : undefined;
      try {
        res = await this.fetchFn(url, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
        bodyText = await res.text();
      } finally {
        if (timer) clearTimeout(timer);
        if (heartbeat) clearInterval(heartbeat);
        this.signal?.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(message)) throw new Error(`MODEL_REQUEST_ABORTED: ${message}`);
      throw new Error(`MODEL_NETWORK_ERROR: ${message}`);
    }
    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      throw new Error(`MODEL_HTTP_ERROR: ${res.status} ${bodyText.slice(0, 500)}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error("MODEL_INVALID_RESPONSE: response is not JSON");
    }

    const choices = (json as { choices?: unknown[] })?.choices;
    const content = choices?.[0] && typeof choices[0] === "object"
      ? (choices[0] as { message?: { content?: string } }).message?.content
      : undefined;
    if (typeof content !== "string") {
      throw new Error("MODEL_INVALID_RESPONSE: no message content");
    }

    let parsed: unknown;
    try {
      parsed = extractJsonObject(content);
    } catch {
      throw new Error("MODEL_NON_JSON_OUTPUT: model did not return valid JSON");
    }

    const parsedResult = request.schema.safeParse(parsed);
    if (!parsedResult.success) {
      const first = parsedResult.error.issues[0];
      throw new Error(`MODEL_SCHEMA_VIOLATION: ${first?.path?.join(".") ?? "?"}: ${first?.message ?? "invalid"}`);
    }

    const usage = (json as { usage?: unknown })?.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    const meta: ModelMeta = {
      model: this.model,
      temperature: this.temperature,
      provider: safeProviderLabel(this.baseUrl),
      promptVersion: request.promptVersion,
      status: res.status,
      durationMs,
      finishReason: (choices?.[0] as { finish_reason?: string } | undefined)?.finish_reason ?? null,
    };

    // Record aggregated usage (never the API key) for the run manifest.
    this.usageLog.calls += 1;
    this.usageLog.promptVersions.push(request.promptVersion);
    this.usageLog.durationsMs.push(durationMs);
    if (usage?.total_tokens != null) {
      this.usageLog.totalTokens = (this.usageLog.totalTokens ?? 0) + usage.total_tokens;
    }

    return {
      ...parsedResult.data,
      __modelMeta: meta,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? null,
            completionTokens: usage.completion_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
          }
        : null,
    } as ModelResult<T>;
  }
}

/** Derives a safe provider label (scheme + host only) for snapshot metadata. */
function safeProviderLabel(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
