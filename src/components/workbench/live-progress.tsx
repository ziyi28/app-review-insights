"use client";

import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";
import { STAGE_LABELS } from "./stage-rail";

// Heartbeats from the model client carry this fixed "still working" message.
// They are a fallback for stages that publish no concrete progress; a specific
// message (e.g. "analyzing review batch 3 of 8") always wins over them.
const HEARTBEAT_MARKER = "model generation in progress";

/**
 * Shows the most recent live-progress message for the current stage while a
 * run is in flight, so a long model call (e.g. topic discovery) never looks
 * frozen. A stage's own message (batch counts, what the model is doing) takes
 * precedence over the periodic heartbeat, which only shows when a stage emits
 * nothing else. Hidden once the run finishes or no message has arrived yet.
 */
export function LiveProgress({ events, running, t }: { events: RunEvent[]; running: boolean; t: Dictionary }) {
  if (!running) return null;

  let currentStage: string | null = null;
  let latestMessage: string | null = null;
  let latestHeartbeat: string | null = null;
  for (const e of events) {
    if (e.type === "stage.started" && e.stage) currentStage = e.stage;
    if (e.type === "stage.completed" && e.stage === currentStage) currentStage = null;
    if (e.type === "stage.progress" && e.stage && e.stage === currentStage) {
      const message = (e.data as { message?: unknown } | undefined)?.message;
      if (typeof message !== "string" || message.trim().length === 0) continue;
      if (message.includes(HEARTBEAT_MARKER)) latestHeartbeat = message;
      else latestMessage = message;
    }
  }
  const shown = latestMessage ?? latestHeartbeat;
  if (!currentStage || !shown) return null;

  const stageKey = STAGE_LABELS[currentStage as keyof typeof STAGE_LABELS];
  const stageLabel = stageKey ? t[stageKey] : currentStage;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 12px",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: "13px",
      }}
    >
      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0, animation: "pulse 1.2s ease-in-out infinite" }} />
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{stageLabel}:</span>
      <span>{shown}</span>
    </div>
  );
}
