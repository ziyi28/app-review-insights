import { z } from "zod";

export const StageNameSchema = z.enum([
  "source",
  "prepare",
  "scope",
  "topics",
  "findings",
  "evidence-validation",
  "planning",
  "requirement-evidence",
  "tests",
  "traceability",
  "revision",
]);
export type StageName = z.infer<typeof StageNameSchema>;

export const RunEventTypeSchema = z.enum([
  "run.accepted",
  "stage.started",
  "stage.progress",
  "artifact.available",
  "limitation.reported",
  "validation.failed",
  "revision.started",
  "revision.completed",
  "stage.completed",
  "run.completed",
  "run.failed",
]);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventSchema = z.object({
  protocolVersion: z.literal("1"),
  sequence: z.number().int().min(1),
  eventId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  timestamp: z.string().datetime(),
  deliveryMode: z.enum(["live", "cached-replay"]),
  type: RunEventTypeSchema,
  stage: StageNameSchema.optional(),
  data: z.unknown(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export function isCancelledRunEvent(event: RunEvent): boolean {
  return event.type === "run.failed" && (event.data as { cancelled?: unknown } | null)?.cancelled === true;
}
