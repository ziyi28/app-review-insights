import type { z } from "zod";

export type ModelJsonMode = "prompt" | "json_object";

export type ModelProgress =
  | { kind: "heartbeat"; elapsedMs: number }
  | {
      kind: "retry";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      reason: string;
    };

export type ModelRequest<T> = {
  stage: string;
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Invoked periodically while the model call is in flight so callers can
   *  surface live progress to the user (a long topic call is otherwise a silent
   *  wait). Never called when the call finishes before the first tick. */
  onProgress?: (info: ModelProgress) => void;
};

export type ModelResult<T> = T & {
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  } | null;
};

export type ModelMeta = {
  model: string | null;
  temperature: number;
  provider: string | null;
  promptVersion: string | null;
  promptSha256?: string;
  status?: number;
  durationMs?: number;
  finishReason?: string | null;
  requestId?: string | null;
};

/** Aggregated model usage record persisted in run manifests. */
export type ModelUsageLog = {
  model: string | null;
  provider: string | null;
  temperature: number;
  /** Successful logical calls (each scripted/external generate result). */
  calls: number;
  /** HTTP attempts across retries (initial + retries). */
  attempts: number;
  /** Number of retries actually performed. */
  retries: number;
  /** MODEL_* reason per retry (never the provider response body). */
  retryReasons: string[];
  promptVersions: string[];
  totalTokens: number | null;
  durationsMs: number[];
};
