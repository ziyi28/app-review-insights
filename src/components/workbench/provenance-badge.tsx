"use client";

export type Provenance = "ai-generated" | "computed" | "assumption" | "conflict" | "limitation" | "source";

const PROVENANCE_STYLES: Record<
  Provenance,
  { color: string; background: string; border: string }
> = {
  "ai-generated": {
    color: "var(--ai)",
    background: "rgba(129, 140, 248, 0.12)",
    border: "1px solid rgba(129, 140, 248, 0.28)",
  },
  computed: {
    color: "var(--accent)",
    background: "rgba(56, 189, 248, 0.12)",
    border: "1px solid rgba(56, 189, 248, 0.28)",
  },
  assumption: {
    color: "var(--warn)",
    background: "rgba(251, 191, 36, 0.12)",
    border: "1px solid rgba(251, 191, 36, 0.28)",
  },
  conflict: {
    color: "var(--danger)",
    background: "rgba(248, 113, 113, 0.12)",
    border: "1px solid rgba(248, 113, 113, 0.28)",
  },
  limitation: {
    color: "var(--warn)",
    background: "rgba(251, 191, 36, 0.12)",
    border: "1px solid rgba(251, 191, 36, 0.28)",
  },
  source: {
    color: "var(--text-muted)",
    background: "rgba(148, 153, 173, 0.12)",
    border: "1px solid rgba(148, 153, 173, 0.25)",
  },
};

export function ProvenanceBadge({ kind, label }: { kind: Provenance; label: string }) {
  const style = PROVENANCE_STYLES[kind] ?? PROVENANCE_STYLES.source;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        fontSize: "11px",
        fontWeight: 600,
        color: style.color,
        background: style.background,
        border: style.border,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
        lineHeight: 1.5,
      }}
      title={label}
    >
      {label}
    </span>
  );
}
