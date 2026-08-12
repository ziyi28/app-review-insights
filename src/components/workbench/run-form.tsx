"use client";

import { useEffect, useState } from "react";
import type { Dictionary, Locale } from "@/i18n";

export type RunFormProps = {
  t: Dictionary;
  onStart: (payload: unknown) => void;
};

export function RunForm({ t, onStart }: RunFormProps) {
  const [mode, setMode] = useState<"live" | "import" | "replay">("live");
  const [url, setUrl] = useState("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684");
  const [goal, setGoal] = useState("");
  const [outputLocale, setOutputLocale] = useState<Locale>("en");
  const [file, setFile] = useState<File | null>(null);
  const [replayRuns, setReplayRuns] = useState<{ runId: string; createdAt: string }[]>([]);
  const [sourceRunId, setSourceRunId] = useState<string>("");

  // Load the replay catalog once so users can start a cached run with no model
  // configured (offline demo) — this is how the bundled real fixture is reached.
  useEffect(() => {
    fetch("/api/runs", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        const runs = (json?.runs ?? []) as { runId: string; canReplay: boolean; createdAt: string }[];
        const replayable = runs.filter((r) => r.canReplay);
        setReplayRuns(replayable.map((r) => ({ runId: r.runId, createdAt: r.createdAt })));
        if (replayable[0]) setSourceRunId(replayable[0].runId);
      })
      .catch(() => {});
  }, []);

  const canStart = mode === "live" ? url.trim().length > 0 : mode === "import" ? file !== null : sourceRunId.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "replay") {
      if (!sourceRunId.trim()) return;
      onStart({ protocolVersion: "1", mode: "cached-replay", sourceRunId: sourceRunId.trim() });
      return;
    }
    if (mode === "live") {
      onStart({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: outputLocale,
        outputLocale,
        goal,
        source: { kind: "live", appStoreUrl: url.trim() },
      });
    } else if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result ?? "");
        onStart({
          protocolVersion: "1",
          mode: "analyze",
          uiLocale: outputLocale,
          outputLocale,
          goal,
          source: {
            kind: "import",
            fileName: file.name,
            mediaType: file.name.endsWith(".csv") ? "text/csv" : "application/json",
            content,
          },
        });
      };
      reader.readAsText(file);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMode("live")} style={{ opacity: mode === "live" ? 1 : 0.6 }}>
          {t.liveMode}
        </button>
        <button type="button" onClick={() => setMode("import")} style={{ opacity: mode === "import" ? 1 : 0.6 }}>
          {t.importMode}
        </button>
        <button type="button" onClick={() => setMode("replay")} style={{ opacity: mode === "replay" ? 1 : 0.6 }}>
          {t.replayMode}
        </button>
      </div>

      {mode === "live" ? (
        <label>
          {t.appStoreUrl}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
          />
        </label>
      ) : mode === "import" ? (
        <label>
          {t.importFile}
          <input type="file" accept=".json,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        <label>
          {t.cachedReplay}
          <select
            value={sourceRunId}
            onChange={(e) => setSourceRunId(e.target.value)}
            style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
          >
            {replayRuns.length === 0 ? (
              <option value="">—</option>
            ) : (
              replayRuns.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.runId} ({new Date(r.createdAt).toLocaleString()})
                </option>
              ))
            )}
          </select>
          {replayRuns.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: "4px 0" }}>{t.noData}</p>
          ) : null}
        </label>
      )}

      <label>
        {t.goal}
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
        />
      </label>

      <label>
        {t.outputLocale}
        <select value={outputLocale} onChange={(e) => setOutputLocale(e.target.value as Locale)} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}>
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
      </label>

      <button type="submit" disabled={!canStart} style={{ padding: "10px", borderRadius: "6px", background: "var(--accent-strong)", color: "#fff", fontWeight: 600 }}>
        {t.start}
      </button>
    </form>
  );
}
