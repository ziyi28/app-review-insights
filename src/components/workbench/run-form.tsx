"use client";

import { useEffect, useState } from "react";
import type { Dictionary, Locale } from "@/i18n";

export type RunFormProps = {
  t: Dictionary;
  onStart: (payload: unknown) => void;
};

type SourcePreviewSummary = {
  protocolVersion: "1";
  previewId: string;
  appId: string;
  canonicalUrl: string;
  createdAt: string;
  expiresAt: string;
  live: {
    status: string;
    reviewCount: number;
    pageCount: number;
    requestCount: number;
    dateRange: { earliest: string | null; latest: string | null };
    limitations: { code: string; message: string }[];
  };
  stable: {
    available: boolean;
    reviewCount: number;
    cacheUpdatedAt: string | null;
    dateRange: { earliest: string | null; latest: string | null };
    bootstrapRunId: string | null;
  };
  recommendedSelection: "live" | "stable" | null;
};

export function RunForm({ t, onStart }: RunFormProps) {
  const [mode, setMode] = useState<"live" | "import" | "replay">("live");
  const [url, setUrl] = useState("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684");
  const [goal, setGoal] = useState("");
  const [outputLocale, setOutputLocale] = useState<Locale>("en");
  const [file, setFile] = useState<File | null>(null);
  const [replayRuns, setReplayRuns] = useState<{ runId: string; createdAt: string }[]>([]);
  const [sourceRunId, setSourceRunId] = useState<string>("");

  // Live-mode preview state: null before checking, "loading" while checking,
  // or a loaded summary after the sample has been checked.
  const [preview, setPreview] = useState<SourcePreviewSummary | null | "loading">(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  // The server requires a goal of at least 10 characters for analyze runs.
  const goalOk = goal.trim().length >= 10;
  const canCheck = mode === "live" && url.trim().length > 0 && goalOk;
  const canStart = mode === "replay" ? sourceRunId.trim().length > 0 : mode === "live" ? preview !== null && preview !== "loading" : file !== null && goalOk;

  const checkSample = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode !== "live") return;
    setPreview("loading");
    setPreviewError(null);
    try {
      const res = await fetch("/api/source-previews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: "1", appStoreUrl: url.trim() }),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.detail ?? problem.title ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SourcePreviewSummary;
      setPreview(json);
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : t.sampleCheckFailed);
    }
  };

  // A URL change makes the previously checked sample stale: any live run must
  // re-check against the new URL.
  const handleUrlChange = (next: string) => {
    setUrl(next);
    setPreview(null);
    setPreviewError(null);
  };

  const startWithPreview = (selection: "live" | "stable") => {
    if (preview === null || preview === "loading") return;
    onStart({
      protocolVersion: "1",
      mode: "analyze",
      uiLocale: outputLocale,
      outputLocale,
      goal,
      source: {
        kind: "live",
        appStoreUrl: url.trim(),
        previewId: preview.previewId,
        reviewSelection: selection,
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "replay") {
      if (!sourceRunId.trim()) return;
      onStart({ protocolVersion: "1", mode: "cached-replay", sourceRunId: sourceRunId.trim() });
      return;
    }
    if (mode === "live") {
      // The form's primary action is now "check the sample"; the analyze action
      // happens through the choice cards below (or the direct live path).
      void checkSample(e);
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

  const liveDisabled = preview !== null && preview !== "loading" && preview.live.reviewCount === 0;
  const stableDisabled = preview !== null && preview !== "loading" && !preview.stable.available;

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => { setMode("live"); setPreview(null); setPreviewError(null); }} style={{ opacity: mode === "live" ? 1 : 0.6 }}>
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
        <>
          <label key="field-live">
            {t.appStoreUrl}
            <input
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
            />
          </label>
          {preview !== null && preview !== "loading" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {/* Live sample card */}
              <div style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)", opacity: liveDisabled ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <strong>{t.liveSample}</strong>
                  {preview.recommendedSelection === "live" ? (
                    <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "10px", background: "var(--accent)", color: "#fff" }}>{t.recommended}</span>
                  ) : null}
                </div>
                <p style={{ fontSize: "13px", margin: "6px 0 2px" }}>{t.liveReviews}: {preview.live.reviewCount}</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0" }}>
                  {preview.live.pageCount} page{preview.live.pageCount === 1 ? "" : "s"} · {preview.live.status}
                </p>
                {liveDisabled ? (
                  <p style={{ fontSize: "12px", color: "var(--warn)", margin: "4px 0" }}>{t.noSampleAvailable}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => startWithPreview("live")}
                    style={{ marginTop: "8px", padding: "8px 12px", borderRadius: "6px", background: "var(--accent-strong)", color: "#fff", fontWeight: 600 }}
                  >
                    {t.chooseLive}
                  </button>
                )}
              </div>

              {/* Stable sample card */}
              <div style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)", opacity: stableDisabled ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <strong>{t.stableSample}</strong>
                  {preview.recommendedSelection === "stable" ? (
                    <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "10px", background: "var(--accent)", color: "#fff" }}>{t.recommended}</span>
                  ) : null}
                </div>
                <p style={{ fontSize: "13px", margin: "6px 0 2px" }}>{t.stableReviews}: {preview.stable.reviewCount}</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0" }}>
                  {t.cacheUpdated}: {preview.stable.cacheUpdatedAt ? new Date(preview.stable.cacheUpdatedAt).toLocaleString() : "—"}
                </p>
                {stableDisabled ? (
                  <p style={{ fontSize: "12px", color: "var(--warn)", margin: "4px 0" }}>{t.noSampleAvailable}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => startWithPreview("stable")}
                    style={{ marginTop: "8px", padding: "8px 12px", borderRadius: "6px", background: "var(--accent-strong)", color: "#fff", fontWeight: 600 }}
                  >
                    {t.chooseStable}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      ) : mode === "import" ? (
        <label key="field-import">
          {t.importFile}
          <input type="file" accept=".json,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        <label key="field-replay">
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

      <div>
        <label htmlFor="run-form-goal">{t.goal}</label>
        <textarea
          id="run-form-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          aria-describedby={goal.trim().length > 0 && !goalOk ? "run-form-goal-hint" : undefined}
          style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
        />
        {goal.trim().length > 0 && !goalOk ? (
          <p id="run-form-goal-hint" style={{ color: "var(--warn)", fontSize: "12px", margin: "4px 0 0" }}>
            {t.goalTooShort}
          </p>
        ) : null}
      </div>

      <label>
        {t.outputLocale}
        <select value={outputLocale} onChange={(e) => setOutputLocale(e.target.value as Locale)} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}>
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
      </label>

      {previewError ? <p style={{ color: "var(--danger)", fontSize: "13px" }}>{previewError}</p> : null}

      {mode === "live" ? (
        <button type="submit" disabled={!canCheck} style={{ padding: "10px", borderRadius: "6px", background: "var(--accent-strong)", color: "#fff", fontWeight: 600 }}>
          {preview === "loading" ? t.checkingSample : preview !== null ? t.recheck : t.checkSample}
        </button>
      ) : (
        <button type="submit" disabled={!canStart} style={{ padding: "10px", borderRadius: "6px", background: "var(--accent-strong)", color: "#fff", fontWeight: 600 }}>
          {t.start}
        </button>
      )}

      {mode === "live" && preview !== null && preview !== "loading" && liveDisabled && stableDisabled ? (
        <p style={{ fontSize: "12px", color: "var(--warn)", margin: "0" }}>
          {t.noSampleAvailable} <button type="button" onClick={() => setMode("import")} style={{ textDecoration: "underline" }}>{t.useImportInstead}</button>
        </p>
      ) : null}

      {mode === "live" && preview === null ? <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0" }}>{t.notChecked}</p> : null}
    </form>
  );
}
