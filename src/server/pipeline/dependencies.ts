import type { ModelMeta, ModelRequest, ModelResult } from "@/server/model/types";

/** The minimal model surface used by pipeline stages. */
export interface StageModelClient {
  generate<T>(request: ModelRequest<T>): Promise<ModelResult<T> & { __modelMeta?: ModelMeta }>;
}

/** Pipeline dependency bundle, injectable for tests and live runs. */
export type PipelineDeps = {
  model: StageModelClient;
};
