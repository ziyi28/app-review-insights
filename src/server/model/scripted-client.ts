import type { ModelRequest, ModelResult, ModelUsageLog } from "./types";

/**
 * Deterministic model client for tests and offline pipelines. Returns the next
 * scripted completion text; throws when exhausted (never silently retries).
 */
export class ScriptedModelClient {
  private readonly script: string[];
  private readonly error?: Error;
  callIndex = 0;
  requests: ModelRequest<unknown>[] = [];
  private readonly usageLog: ModelUsageLog = { model: "scripted", provider: "test", temperature: 0.1, calls: 0, attempts: 0, retries: 0, retryReasons: [], promptVersions: [], totalTokens: null, durationsMs: [] };

  constructor(script: string[], error?: Error) {
    this.script = script;
    this.error = error;
  }

  getUsageLog(): ModelUsageLog {
    return { ...this.usageLog, promptVersions: [...this.usageLog.promptVersions], retryReasons: [...this.usageLog.retryReasons] };
  }

  async generate<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    this.requests.push(request as ModelRequest<unknown>);
    const index = this.callIndex++;
    if (this.error) throw this.error;
    if (index >= this.script.length) {
      throw new Error(`MODEL_SCRIPT_EXHAUSTED: scripted client called ${this.callIndex} times with ${this.script.length} responses`);
    }
    const raw = this.script[index];
    const parsed = JSON.parse(raw) as unknown;
    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`MODEL_SCHEMA_VIOLATION (scripted): ${JSON.stringify(result.error.issues[0])}`);
    }
    this.usageLog.calls += 1;
    this.usageLog.attempts += 1;
    this.usageLog.promptVersions.push(request.promptVersion);
    return {
      ...result.data,
      usage: null,
    } as ModelResult<T>;
  }
}
