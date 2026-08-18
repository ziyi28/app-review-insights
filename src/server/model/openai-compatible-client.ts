import { createHash } from "node:crypto";
import type { ModelJsonMode, ModelMeta, ModelReasoningEffort, ModelRequest, ModelResult, ModelUsageLog } from "./types";
import { extractJsonObject } from "./parse-json";

export type ModelClientDeps = {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: ModelJsonMode;
  reasoningEffort?: ModelReasoningEffort;
  temperature?: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  /** Hard deadline for a single model call; aborts the fetch when exceeded. */
  timeoutMs?: number;
  /** Interval (ms) between onProgress heartbeats while a call is in flight. */
  progressIntervalMs?: number;
};

const TEMPERATURE = 0.1;
const DEFAULT_REASONING_EFFORT: ModelReasoningEffort = "medium";
// Heartbeats are a low-noise "still working" signal, not a progress meter; a
// 10s interval keeps long model calls responsive to the UI without emitting a
// stream event every 2 seconds for a call that may run for minutes.
const PROGRESS_INTERVAL_MS = 10_000;
// A single long model call (topic discovery can take 100-200s) occasionally
// fails with a transient provider 5xx. Retrying a bounded number of times with
// backoff keeps one flaky call from failing the whole (potentially 25-minute)
// run, without masking deterministic failures.
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Minimal OpenAI-compatible chat completions client. No provider-specific
 * features. Transient failures (5xx, network errors, per-call timeouts,
 * non-JSON/malformed responses) are retried a bounded number of times with
 * backoff; deterministic failures (4xx, schema violations) and client
 * disconnects are not retried. If the api key is empty no Authorization header
 * is sent (for local model runtimes). The request snapshot strips the key.
 */
export class OpenAiCompatibleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly jsonMode: ModelJsonMode;
  private readonly reasoningEffort: ModelReasoningEffort;
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
    this.reasoningEffort = deps.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    this.temperature = deps.temperature ?? TEMPERATURE;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.signal = deps.signal;
    this.timeoutMs = deps.timeoutMs;
    this.progressIntervalMs = deps.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    this.usageLog = { model: deps.model, provider: safeProviderLabel(deps.baseUrl), temperature: this.temperature, calls: 0, attempts: 0, retries: 0, retryReasons: [], promptVersions: [], promptHashes: [], totalTokens: null, durationsMs: [] };
  }

  /** Aggregated model usage for the run manifest (never contains the API key). */
  getUsageLog(): ModelUsageLog {
    return { ...this.usageLog, promptVersions: [...this.usageLog.promptVersions], promptHashes: [...this.usageLog.promptHashes], retryReasons: [...this.usageLog.retryReasons] };
  }

  async generate<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.usageLog.attempts += 1;
      try {
        return await this.generateOnce(request, attempt, lastError);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Never retry once the client disconnected; otherwise the pipeline would
        // keep working against a dead stream.
        if (this.signal?.aborted) throw lastError;
        if (!isTransient(lastError) || attempt === MAX_RETRIES) throw lastError;
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        const reason = modelErrorCode(lastError);
        this.usageLog.retries += 1;
        this.usageLog.retryReasons.push(reason);
        request.onProgress?.({
          kind: "retry",
          attempt: attempt + 2,
          maxAttempts: MAX_RETRIES + 1,
          delayMs: delay,
          reason,
        });
        console.warn(`[model] transient error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${lastError.message}`);
        await sleep(delay);
      }
    }
    // Unreachable (the loop either returns or throws), but satisfies the type.
    throw lastError ?? new Error("model generate failed");
  }

  private async generateOnce<T>(request: ModelRequest<T>, attempt = 0, lastError: Error | null = null): Promise<ModelResult<T>> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    let userContent = request.user;
    if (attempt > 0 && lastError && (lastError.message.includes("MODEL_NON_JSON_OUTPUT") || lastError.message.includes("MODEL_INVALID_RESPONSE"))) {
      userContent += "\n\nCRITICAL RETRY NOTICE: Your previous response was rejected because it did not return valid JSON. You MUST respond with ONLY a single, valid RFC 8259 JSON object matching the required schema. Do NOT include reasoning, markdown commentary, or any text outside the JSON.";
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      temperature: this.temperature,
      reasoning_effort: this.reasoningEffort,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: userContent },
      ],
    };
    if (this.jsonMode === "json_object") {
      payload.response_format = { type: "json_object" };
    }

    const startedAt = Date.now();
    let res: Response;
    let bodyText: string;
    let timedOut = false;
    try {
      // Combine the caller's abort signal with a hard per-call deadline.
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      this.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = this.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.timeoutMs)
        : undefined;
      // Heartbeat while waiting so long calls don't look frozen to the user.
      const heartbeat = request.onProgress
        ? setInterval(() => request.onProgress?.({ kind: "heartbeat", elapsedMs: Date.now() - startedAt }), this.progressIntervalMs)
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
      // The timer aborts the fetch with timedOut set; the caller's signal aborts
      // it without (client disconnect). Both surface as an AbortError.
      if (timedOut && /abort/i.test(message)) throw new Error(`MODEL_REQUEST_TIMEOUT: exceeded ${this.timeoutMs}ms`);
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
      // Upstream returned a non-JSON body (e.g. a proxy error page). A snippet
      // makes a repeated failure diagnosable; the retry loop treats it as
      // transient.
      throw new Error(`MODEL_INVALID_RESPONSE: response is not JSON (${bodyText.slice(0, 200)})`);
    }

    const choices = (json as { choices?: unknown[] })?.choices;
    const content = choices?.[0] && typeof choices[0] === "object"
      ? (choices[0] as { message?: { content?: string } }).message?.content
      : undefined;
    const finishReason = (choices?.[0] as { finish_reason?: string } | undefined)?.finish_reason ?? null;
    if (typeof content !== "string") {
      throw new Error(`MODEL_INVALID_RESPONSE: no message content (finish=${finishReason ?? "n/a"})`);
    }

    if (finishReason === "length") {
      // The provider cut the completion at its output-token limit, so whatever
      // arrived is a prefix. Bracket auto-completion in the JSON parser could
      // "rescue" it into a schema-valid but semantically truncated object —
      // reject before parsing and let the retry loop try for a full answer.
      throw new Error(`MODEL_TRUNCATED_RESPONSE: completion cut at the provider token limit (content="${content.slice(0, 200)}")`);
    }

    let parsed: unknown;
    try {
      parsed = extractJsonObject(content);
    } catch {
      // A truncated or garbled model output. `finish_reason` (e.g. "length")
      // and a content snippet surface the failure mode; the retry loop treats
      // it as transient since a long/parallel call can occasionally come back
      // malformed.
      throw new Error(`MODEL_NON_JSON_OUTPUT: model did not return valid JSON (finish=${finishReason ?? "n/a"}, content="${content.slice(0, 200)}")`);
    }

    const parsedResult = request.schema.safeParse(parsed);
    if (!parsedResult.success) {
      const first = parsedResult.error.issues[0];
      throw new Error(`MODEL_SCHEMA_VIOLATION: ${first?.path?.join(".") ?? "?"}: ${first?.message ?? "invalid"}`);
    }

    const usage = (json as { usage?: unknown })?.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    const promptSha256 = createHash("sha256").update(request.system + request.promptVersion).digest("hex");
    const meta: ModelMeta = {
      model: this.model,
      temperature: this.temperature,
      provider: safeProviderLabel(this.baseUrl),
      promptVersion: request.promptVersion,
      promptSha256,
      status: res.status,
      durationMs,
      finishReason,
    };

    // Record aggregated usage (never the API key) for the run manifest.
    this.usageLog.calls += 1;
    this.usageLog.promptVersions.push(request.promptVersion);
    this.usageLog.promptHashes.push(promptSha256);
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

/**
 * True for failures worth retrying: a transient provider 5xx, a network error,
 * a per-call timeout, a truncated completion, or a non-JSON/malformed response
 * (a truncated or garbled stream, same class of hiccup as a 5xx).
 * Deterministic failures must surface immediately (4xx, schema violations,
 * client abort).
 */
function isTransient(err: Error): boolean {
  const message = err.message;
  if (/^MODEL_HTTP_ERROR: 5\d\d/.test(message)) return true;
  if (/^MODEL_NETWORK_ERROR:/.test(message)) return true;
  if (/^MODEL_REQUEST_TIMEOUT:/.test(message)) return true;
  if (/^MODEL_INVALID_RESPONSE:/.test(message)) return true;
  if (/^MODEL_NON_JSON_OUTPUT:/.test(message)) return true;
  if (/^MODEL_TRUNCATED_RESPONSE:/.test(message)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extracts the MODEL_* classification for a retry audit (never the body). */
function modelErrorCode(err: Error): string {
  const match = err.message.match(/^(MODEL_[A-Z_]+):/);
  return match ? match[1] : "MODEL_ERROR";
}
