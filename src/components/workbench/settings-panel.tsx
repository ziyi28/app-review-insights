"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/i18n";

export type SettingsPanelProps = {
  t: Dictionary;
  open: boolean;
  onClose: () => void;
};

type ConfigState = {
  modelBaseUrl: string;
  modelName: string;
  jsonMode: "prompt" | "json_object";
  apiKeyConfigured: boolean;
};

/**
 * Modal settings panel for configuring the model connection from the UI. On
 * open it loads the current non-secret status from GET /api/config; saving
 * POSTs the changed fields to /api/config, which applies the override
 * in-process and persists it to the git-ignored `.env.local`. The API key is
 * never returned to the client — the form only shows a "configured" flag and a
 * "clear" action.
 */
export function SettingsPanel({ t, open, onClose }: SettingsPanelProps) {
  const [config, setConfig] = useState<ConfigState>({ modelBaseUrl: "", modelName: "", jsonMode: "prompt", apiKeyConfigured: false });
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      // Reset inside the async loader so the resets are not synchronous
      // setState calls in the effect body (react-hooks/set-state-in-effect).
      setError(null);
      setSaved(false);
      setApiKey("");
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        setConfig({
          modelBaseUrl: (json.modelBaseUrl as string) ?? "",
          modelName: (json.modelName as string) ?? "",
          jsonMode: json.jsonMode === "json_object" ? "json_object" : "prompt",
          apiKeyConfigured: Boolean(json.modelApiKeyConfigured),
        });
      } catch {
        if (!cancelled) setError(t.configApplyError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const body: Record<string, string | null> = {};
    body.modelBaseUrl = config.modelBaseUrl.trim() || null;
    body.modelName = config.modelName.trim() || null;
    body.modelJsonMode = config.jsonMode;
    if (apiKey.trim()) {
      body.modelApiKey = apiKey.trim();
    }
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(t.configApplyError);
      }
      setSaved(true);
      setApiKey("");
      setConfig((c) => ({ ...c, apiKeyConfigured: Boolean(apiKey.trim()) || c.apiKeyConfigured }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelApiKey: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApiKey("");
      setConfig((c) => ({ ...c, apiKeyConfigured: false }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = { width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" } as const;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.settings}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
    >
      <form
        onSubmit={handleSave}
        style={{ width: "min(480px, 100%)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "grid", gap: "12px" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t.settings}</h3>
          <button type="button" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </div>

        <label htmlFor="settings-base-url">{t.modelBaseUrl}</label>
        <input id="settings-base-url" value={config.modelBaseUrl} onChange={(e) => setConfig((c) => ({ ...c, modelBaseUrl: e.target.value }))} placeholder="https://api.example.com/v1" style={fieldStyle} />

        <label htmlFor="settings-api-key">{t.modelApiKey}</label>
        <div style={{ display: "flex", gap: "6px" }}>
          <input id="settings-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.apiKeyConfigured ? t.apiKeyPlaceholder : ""} style={fieldStyle} autoComplete="off" />
          {config.apiKeyConfigured ? (
            <button type="button" onClick={handleClearKey} disabled={saving} style={{ flexShrink: 0 }}>
              {t.apiKeyClear}
            </button>
          ) : null}
        </div>
        {config.apiKeyConfigured ? <span style={{ color: "var(--accent)", fontSize: "12px" }}>{t.apiKeyConfigured}</span> : null}

        <label htmlFor="settings-model-name">{t.modelName}</label>
        <input id="settings-model-name" value={config.modelName} onChange={(e) => setConfig((c) => ({ ...c, modelName: e.target.value }))} placeholder="deepseek-v4-flash" style={fieldStyle} />

        <label htmlFor="settings-json-mode">{t.modelJsonMode}</label>
        <select id="settings-json-mode" value={config.jsonMode} onChange={(e) => setConfig((c) => ({ ...c, jsonMode: e.target.value as "prompt" | "json_object" }))} style={fieldStyle}>
          <option value="prompt">prompt</option>
          <option value="json_object">json_object</option>
        </select>

        {error ? <p style={{ color: "var(--danger)", margin: 0, fontSize: "13px" }}>{error}</p> : null}
        {saved ? <p style={{ color: "var(--accent)", margin: 0, fontSize: "13px" }}>{t.saved}</p> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose}>
            {t.close}
          </button>
          <button type="submit" disabled={saving} style={{ background: "var(--accent-strong)", color: "#fff", fontWeight: 600 }}>
            {t.save}
          </button>
        </div>
      </form>
    </div>
  );
}
