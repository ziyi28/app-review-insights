"use client";

import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";
import { STAGE_LABELS } from "./stage-rail";

const HEARTBEAT_MARKER = "model generation in progress";
const RETRY_MARKER = "model retry";

export function LiveProgress({ events, running, t }: { events: RunEvent[]; running: boolean; t: Dictionary }) {
  if (!running) return null;

  let currentStage: string | null = null;
  let latestMessage: string | null = null;
  let latestHeartbeat: string | null = null;
  for (const e of events) {
    if (e.type === "stage.started" && e.stage) currentStage = e.stage;
    if (e.type === "stage.completed" && e.stage === currentStage) {
      currentStage = null;
      latestMessage = null;
      latestHeartbeat = null;
    }
    if (e.type === "stage.progress" && e.stage && e.stage === currentStage) {
      const message = (e.data as { message?: unknown } | undefined)?.message;
      if (typeof message !== "string" || message.trim().length === 0) continue;
      if (message.includes(HEARTBEAT_MARKER)) {
        if (latestMessage?.includes(RETRY_MARKER)) continue;
        latestHeartbeat = message;
      } else {
        latestMessage = message;
      }
    }
  }
  const shown = latestMessage ?? latestHeartbeat;
  if (!currentStage || !shown) return null;

  const stageKey = STAGE_LABELS[currentStage as keyof typeof STAGE_LABELS];
  const stageLabel = stageKey ? t[stageKey] : currentStage;

  return (
    <div
      className="card card-elevated"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "10px",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        fontSize: "13px",
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "var(--accent)",
          flexShrink: 0,
          animation: "pulse 1.2s ease-in-out infinite",
          boxShadow: "0 0 8px rgba(56, 189, 248, 0.6)",
        }}
      />
      <span style={{ color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>{stageLabel}:</span>
      <span style={{ color: "var(--text)" }}>{shown}</span>
    </div>
  );
}
