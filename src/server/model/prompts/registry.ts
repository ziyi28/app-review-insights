import type { z } from "zod";

export type PromptDefinition<T> = {
  id: string;
  version: string;
  system: string;
  buildUser: (context: unknown) => string;
  schema: z.ZodType<T>;
};

export type PromptRegistry = Record<string, PromptDefinition<unknown>>;
