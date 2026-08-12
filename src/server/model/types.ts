import type { z } from "zod";

export type ModelJsonMode = "prompt" | "json_object";

export type ModelProgress = {
  /** Milliseconds since the call started, for "model is working" feedback. */
  elapsedMs: number;
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
  calls: number;
  promptVersions: string[];
  totalTokens: number | null;
  durationsMs: number[];
};
