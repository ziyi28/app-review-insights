import { z } from "zod";

/**
 * Payload for POST /api/config: updates the model connection and the
 * server-only SocialCrawl key from the settings panel. All fields are optional;
 * an omitted field is left untouched. A `null` value clears the field.
 */
export const ConfigUpdateSchema = z
  .object({
    modelBaseUrl: z.string().trim().max(2048).url().nullable().optional(),
    modelApiKey: z.string().trim().max(4096).nullable().optional(),
    modelName: z.string().trim().max(256).nullable().optional(),
    modelJsonMode: z.enum(["prompt", "json_object"]).optional(),
    socialCrawlApiKey: z.string().trim().min(1).max(4096).nullable().optional(),
  })
  .strict();
export type ConfigUpdate = z.infer<typeof ConfigUpdateSchema>;

/** Backwards-compatible alias for the renamed schema. */
export const ModelConfigUpdateSchema = ConfigUpdateSchema;
export type ModelConfigUpdate = ConfigUpdate;
