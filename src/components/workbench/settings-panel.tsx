"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n";
import { useModal } from "./use-modal";
import styles from "./modal.module.css";

export type SettingsPanelProps = {
  t: Dictionary;
  open: boolean;
  onClose: () => void;
  onConfigChange?: (status: { modelConfigured: boolean; serpApiConfigured: boolean }) => void;
};

type ConfigState = {
  modelBaseUrl: string;
  modelName: string;
  jsonMode: "prompt" | "json_object";
  apiKeyConfigured: boolean;
  serpApiKeyConfigured: boolean;
};

/**
 * Modal settings panel for configuring the model connection and the server-only
 * SerpApi key from the UI. On open it loads the current non-secret status
 * from GET /api/config; saving POSTs the changed fields to /api/config, which
 * applies the override in-process and persists it to the git-ignored
 * `.env.local`. Neither API key is ever returned to the client — the form only
 * shows a "configured" flag and a "clear" action, and the SerpApi input is
 * always blank (no prefilled secret, no reveal).
 */
export function SettingsPanel({ t, open, onClose, onConfigChange }: SettingsPanelProps) {
  const [config, setConfig] = useState<ConfigState>({ modelBaseUrl: "", modelName: "", jsonMode: "prompt", apiKeyConfigured: false, serpApiKeyConfigured: false });
  const [apiKey, setApiKey] = useState("");
  const [serpApiKey, setSerpApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown } = useModal(open, onClose, containerRef);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      // Reset inside the async loader so the resets are not synchronous
      // setState calls in the effect body (react-hooks/set-state-in-effect).
      setError(null);
      setSaved(false);
      setApiKey("");
      setSerpApiKey("");
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        setConfig({
          modelBaseUrl: (json.modelBaseUrl as string) ?? "",
          modelName: (json.modelName as string) ?? "",
          jsonMode: json.jsonMode === "json_object" ? "json_object" : "prompt",
          apiKeyConfigured: Boolean(json.modelApiKeyConfigured),
          serpApiKeyConfigured: Boolean(json.serpApiKeyConfigured),
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
    if (serpApiKey.trim()) {
      body.serpApiKey = serpApiKey.trim();
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
      const json = (await res.json()) as { serpApiKeyConfigured?: boolean; modelConfigured?: boolean };
      setSaved(true);
      setApiKey("");
      setSerpApiKey("");
      setConfig((c) => ({
        ...c,
        apiKeyConfigured: Boolean(apiKey.trim()) || c.apiKeyConfigured,
        serpApiKeyConfigured: json.serpApiKeyConfigured ?? c.serpApiKeyConfigured,
      }));
      onConfigChange?.({
        modelConfigured: Boolean(json.modelConfigured),
        serpApiConfigured: Boolean(json.serpApiKeyConfigured),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearSerpApiKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serpApiKey: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { serpApiKeyConfigured?: boolean; modelConfigured?: boolean };
      setSerpApiKey("");
      setConfig((c) => ({ ...c, serpApiKeyConfigured: Boolean(json.serpApiKeyConfigured) }));
      setSaved(true);
      onConfigChange?.({
        modelConfigured: Boolean(json.modelConfigured),
        serpApiConfigured: Boolean(json.serpApiKeyConfigured),
      });
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
      const json = (await res.json()) as { modelConfigured?: boolean; serpApiKeyConfigured?: boolean };
      setApiKey("");
      setConfig((c) => ({ ...c, apiKeyConfigured: false }));
      setSaved(true);
      onConfigChange?.({
        modelConfigured: Boolean(json.modelConfigured),
        serpApiConfigured: Boolean(json.serpApiKeyConfigured),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <form onSubmit={handleSave} style={{ display: "grid", gap: "12px" }}>
          <div className={styles.dialogHead}>
            <h3 className={styles.dialogTitle}>{t.settings}</h3>
            <button type="button" onClick={onClose} aria-label={t.close} className={styles.closeBtn}>
              ×
            </button>
          </div>

          <label className="field-label" htmlFor="settings-base-url">
            {t.modelBaseUrl}
          </label>
          <input id="settings-base-url" className="field" value={config.modelBaseUrl} onChange={(e) => setConfig((c) => ({ ...c, modelBaseUrl: e.target.value }))} placeholder="https://api.example.com/v1" />

          <label className="field-label" htmlFor="settings-api-key">
            {t.modelApiKey}
          </label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input id="settings-api-key" className="field" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.apiKeyConfigured ? t.apiKeyPlaceholder : ""} autoComplete="off" />
            {config.apiKeyConfigured ? (
              <button type="button" className="btn btn-secondary" onClick={handleClearKey} disabled={saving} style={{ flexShrink: 0 }}>
                {t.apiKeyClear}
              </button>
            ) : null}
          </div>
          {config.apiKeyConfigured ? <span className="chip chip-accent">{t.apiKeyConfigured}</span> : null}

          <label className="field-label" htmlFor="settings-model-name">
            {t.modelName}
          </label>
          <input id="settings-model-name" className="field" value={config.modelName} onChange={(e) => setConfig((c) => ({ ...c, modelName: e.target.value }))} placeholder="deepseek-v4-flash" />

          <label className="field-label" htmlFor="settings-json-mode">
            {t.modelJsonMode}
          </label>
          <select id="settings-json-mode" className="field" value={config.jsonMode} onChange={(e) => setConfig((c) => ({ ...c, jsonMode: e.target.value as "prompt" | "json_object" }))}>
            <option value="prompt">prompt</option>
            <option value="json_object">json_object</option>
          </select>

          <h4 style={{ margin: "12px 0 0" }}>{t.dataSourceSettings}</h4>
          <label className="field-label" htmlFor="settings-serpapi-api-key">
            {t.serpApiKey}
          </label>
          <p id="settings-serpapi-api-key-hint" style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>{t.serpApiKeyHint}</p>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              id="settings-serpapi-api-key"
              className="field"
              aria-describedby="settings-serpapi-api-key-hint"
              type="password"
              autoComplete="off"
              value={serpApiKey}
              onChange={(event) => setSerpApiKey(event.target.value)}
              placeholder={config.serpApiKeyConfigured ? t.apiKeyPlaceholder : ""}
            />
            {config.serpApiKeyConfigured ? (
              <button type="button" className="btn btn-secondary" onClick={() => handleClearSerpApiKey()} disabled={saving} style={{ flexShrink: 0 }}>
                {t.serpApiKeyClear}
              </button>
            ) : null}
          </div>
          {config.serpApiKeyConfigured ? <span className="chip chip-accent">{t.serpApiKeyConfigured}</span> : null}

          {error ? <p style={{ color: "var(--danger)", margin: 0, fontSize: "13px" }}>{error}</p> : null}
          {saved ? <p style={{ color: "var(--accent)", margin: 0, fontSize: "13px" }}>{t.saved}</p> : null}

          <div className={styles.dialogFoot}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t.close}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
