import { z } from "zod";

export const LocaleSchema = z.enum(["en", "zh-CN"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const AnalyzeSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("live"),
    appStoreUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), { message: "must be https" }),
  }),
  z.object({
    kind: z.literal("import"),
    fileName: z.string().min(1).max(255),
    mediaType: z.enum(["application/json", "text/csv"]),
    content: z
      .string()
      .max(2_000_000)
      .refine((s) => s.trim().length > 0, { message: "content must not be empty" }),
  }),
]);
export type AnalyzeSource = z.infer<typeof AnalyzeSourceSchema>;

export const RunStartRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    protocolVersion: z.literal("1"),
    mode: z.literal("analyze"),
    uiLocale: LocaleSchema,
    outputLocale: LocaleSchema,
    goal: z.string().min(10).max(2_000),
    source: AnalyzeSourceSchema,
  }),
  z.object({
    protocolVersion: z.literal("1"),
    mode: z.literal("cached-replay"),
    sourceRunId: z.string().min(1).max(128),
  }),
]);
export type RunStartRequest = z.infer<typeof RunStartRequestSchema>;

export type AnalyzeRequest = Extract<RunStartRequest, { mode: "analyze" }>;
export type ReplayRequest = Extract<RunStartRequest, { mode: "cached-replay" }>;
