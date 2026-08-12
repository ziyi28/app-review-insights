"use client";

export type Provenance = "ai-generated" | "computed" | "assumption" | "conflict" | "limitation" | "source";

const COLORS: Record<Provenance, string> = {
  "ai-generated": "#8b5cf6",
  computed: "#0ea5e9",
  assumption: "#f59e0b",
  conflict: "#ef4444",
  limitation: "#facc15",
  source: "#64748b",
};

export function ProvenanceBadge({ kind, label }: { kind: Provenance; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        color: "#fff",
        background: COLORS[kind],
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
      title={label}
    >
      {label}
    </span>
  );
}
