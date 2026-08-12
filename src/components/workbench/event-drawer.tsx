"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";

export function EventDrawer({ events, t }: { events: RunEvent[]; t: Dictionary }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", padding: "10px", textAlign: "left", background: "transparent", border: "none", color: "var(--text)" }}>
        {open ? t.hideEvents : t.showEvents} ({events.length})
      </button>
      {open ? (
        <div style={{ maxHeight: "180px", overflowY: "auto", padding: "0 12px 12px", fontSize: "13px" }}>
          {events.length === 0 ? <p style={{ color: "var(--text-muted)" }}>{t.noData}</p> : null}
          {events.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", padding: "2px 0", borderBottom: "1px solid rgba(71,85,105,0.3)" }}>
              <code style={{ color: "var(--text-muted)" }}>#{e.sequence}</code>
              <span style={{ color: "var(--accent)" }}>{e.type}</span>
              {e.stage ? <span style={{ color: "var(--text-muted)" }}>{e.stage}</span> : null}
              <span style={{ color: "var(--text-muted)", marginLeft: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "40%" }}>{JSON.stringify(e.data ?? {}).slice(0, 80)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
