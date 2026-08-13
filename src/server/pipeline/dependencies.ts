import type { ModelMeta, ModelRequest, ModelResult } from "@/server/model/types";

/** The minimal model surface used by pipeline stages. */
export interface StageModelClient {
  generate<T>(request: ModelRequest<T>): Promise<ModelResult<T> & { __modelMeta?: ModelMeta }>;
}

/**
 * Wraps a stage's live-progress callback so a model-call heartbeat also becomes
 * a progress message. Returns undefined when the stage has no callback, so
 * `onProgress` is never attached unnecessarily.
 */
export function modelProgressRelay(
  onProgress?: (message: string) => void,
): ((info: { elapsedMs: number }) => void) | undefined {
  if (!onProgress) return undefined;
  return (info) => onProgress(`model generation in progress (${Math.round(info.elapsedMs / 1000)}s)`);
}

/** Pipeline dependency bundle, injectable for tests and live runs. */
export type PipelineDeps = {
  model: StageModelClient;
};
