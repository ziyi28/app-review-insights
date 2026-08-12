import { z } from "zod";

/**
 * Payload for POST /api/config: updates the model connection from the
 * settings panel. All fields are optional; an omitted field is left untouched.
 * A `null` value clears the field.
 */
export const ModelConfigUpdateSchema = z
  .object({
    modelBaseUrl: z.string().trim().max(2048).url().nullable().optional(),
    modelApiKey: z.string().trim().max(4096).nullable().optional(),
    modelName: z.string().trim().max(256).nullable().optional(),
    modelJsonMode: z.enum(["prompt", "json_object"]).optional(),
  })
  .strict();
export type ModelConfigUpdate = z.infer<typeof ModelConfigUpdateSchema>;
