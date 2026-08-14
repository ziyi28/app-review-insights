"use client";

import { useCallback, useState } from "react";
import type { Dictionary, Locale } from "@/i18n";
import styles from "./run-form.module.css";

export type RunFormProps = {
  t: Dictionary;
  onStart: (payload: unknown) => void;
};

type Step = 1 | 2 | 3;
type Mode = "live" | "import";

type SourcePreviewSummary = {
  protocolVersion: "1";
  previewId: string;
  appId: string;
  canonicalUrl: string;
  createdAt: string;
  expiresAt: string;
  live: {
    provider: "serpapi" | "apple-rss";
    forcedRefresh: boolean;
    cached: boolean | null;
    collectedAt: string;
    status: string;
    reviewCount: number;
    pageCount: number;
    requestCount: number;
    dateRange: { earliest: string | null; latest: string | null };
    limitations: { code: string; message: string }[];
    searchCount: number;
    searchId: string | null;
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

const EXAMPLE_URL = "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684";

const STEP_LABELS: Record<Step, keyof Dictionary> = {
  1: "wizardStepSource",
  2: "wizardStepConfigure",
  3: "wizardStepConfirm",
};

/**
 * Three-step "new run" wizard:
 *   1. choose a data source (live / import)
 *   2. configure the input (URL+goal+language, or file+goal+language)
 *   3. confirm — live shows the checked sample and lets the user pick fresh vs
 *      local-history; import confirms the file.
 *
 * Cached replay is intentionally not a wizard source: it is offered from the
 * history panel, where each completed run already shows its app and goal.
 */
export function RunForm({ t, onStart }: RunFormProps) {
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("live");
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [outputLocale, setOutputLocale] = useState<Locale>("zh-CN");
  const [file, setFile] = useState<File | null>(null);
  const [reviewLimit, setReviewLimit] = useState<100 | 300 | 500>(100);

  // Live-mode preview state: null before checking, "loading" while checking,
  // or a loaded summary after the sample has been checked.
  const [preview, setPreview] = useState<SourcePreviewSummary | null | "loading">(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const checkSample = useCallback(async () => {
    const targetUrl = url.trim();
    if (!targetUrl) return;
    setPreview("loading");
    setPreviewError(null);
    try {
      const res = await fetch("/api/source-previews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: "1", appStoreUrl: targetUrl, reviewLimit }),
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
  }, [url, reviewLimit, t]);

  // A URL change makes the previously checked sample stale: any live run must
  // re-check against the new URL.
  const handleUrlChange = (next: string) => {
    setUrl(next);
    setPreview(null);
    setPreviewError(null);
  };

  // A review-count change makes the previously checked sample stale: the user
  // must re-check against the new cap before starting.
  const handleReviewLimitChange = (next: string) => {
    setReviewLimit(Number(next) as 100 | 300 | 500);
    setPreview(null);
    setPreviewError(null);
  };

  const goalOk = goal.trim().length >= 10;
  // Step 2 can advance only when the mode's required input is filled.
  const step2Valid = mode === "import" ? file !== null && goalOk : url.trim().length > 0 && goalOk;

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

  const startImport = () => {
    if (!file) return;
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
  };

  const handleNext = () => {
    if (step === 2 && step2Valid) {
      setStep(3);
      // Entering the confirm step for a live run checks the sample right away
      // so the user can pick fresh vs local-history without a separate action.
      if (mode === "live" && preview === null) {
        void checkSample();
      }
    }
  };

  const handleBack = () => setStep((s) => (s - 1) as Step);

  const selectMode = (next: Mode) => {
    setMode(next);
    setStep(2);
  };

  // Live sample card state (step 3).
  const liveDisabled = preview !== null && preview !== "loading" && preview.live.reviewCount === 0;
  const stableDisabled = preview !== null && preview !== "loading" && !preview.stable.available;
  const providerLabel =
    preview !== null && preview !== "loading" && preview.live.provider === "serpapi" ? t.serpApiFresh : t.appleRssFallback;
  const fallbackReason =
    preview !== null && preview !== "loading"
      ? preview.live.limitations.find((l) => l.code.startsWith("SERPAPI_"))
      : undefined;

  return (
    <div className={styles.wizard}>
      {/* Step indicator */}
      <ol className={styles.stepper} aria-label={t.wizardStepSource}>
        {([1, 2, 3] as const).map((s) => (
          <li key={s} className={s === step ? `${styles.step} ${styles.stepActive}` : s < step ? `${styles.step} ${styles.stepDone}` : styles.step} aria-current={s === step ? "step" : undefined}>
            <span className={styles.stepDot}>{s}</span>
            <span className={styles.stepLabel}>{t[STEP_LABELS[s]]}</span>
          </li>
        ))}
      </ol>

      {/* Step 1 — choose a source */}
      {step === 1 ? (
        <div className={styles.stepBody}>
          <div role="radiogroup" aria-label={t.wizardStepSource} className={styles.modeGrid}>
            {(["live", "import"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => selectMode(m)}
                className={`${styles.modeCard} ${mode === m ? styles.modeCardSelected : ""}`}
              >
                <span className={styles.modeTitle}>{m === "live" ? t.liveMode : t.importMode}</span>
                <span className={styles.modeDesc}>{m === "live" ? t.liveModeDesc : t.importModeDesc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Step 2 — configure input */}
      {step === 2 ? (
        <div className={styles.stepBody}>
          {mode === "live" ? (
            <>
              <div className={styles.fieldRow}>
                <label className={styles.label}>
                  {t.appStoreUrl}
                  <input
                    className={styles.input}
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://apps.apple.com/us/app/…"
                  />
                </label>
                <button type="button" className={styles.exampleBtn} onClick={() => handleUrlChange(EXAMPLE_URL)}>
                  {t.useExampleApp}
                </button>
              </div>
              <label className={styles.label}>
                {t.reviewLimit}
                <select className={styles.input} value={reviewLimit} onChange={(e) => handleReviewLimitChange(e.target.value)}>
                  <option value={100}>100</option>
                  <option value={300}>300</option>
                  <option value={500}>500</option>
                </select>
              </label>
              <p className={styles.hintMuted}>{t.reviewLimitHint}</p>
              <label className={styles.label}>
                {t.goal}
                <textarea
                  className={styles.input}
                  id="run-form-goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={3}
                  aria-describedby={goal.trim().length > 0 && !goalOk ? "run-form-goal-hint" : undefined}
                />
              </label>
              {goal.trim().length > 0 && !goalOk ? (
                <p id="run-form-goal-hint" className={styles.hintWarn}>
                  {t.goalTooShort}
                </p>
              ) : null}
              <label className={styles.label}>
                {t.outputLocale}
                <select className={styles.input} value={outputLocale} onChange={(e) => setOutputLocale(e.target.value as Locale)}>
                  <option value="en">English</option>
                  <option value="zh-CN">中文</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className={styles.label}>
                {t.importFile}
                <input type="file" accept=".json,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <label className={styles.label}>
                {t.goal}
                <textarea
                  className={styles.input}
                  id="run-form-goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={3}
                  aria-describedby={goal.trim().length > 0 && !goalOk ? "run-form-goal-hint" : undefined}
                />
              </label>
              {goal.trim().length > 0 && !goalOk ? (
                <p id="run-form-goal-hint" className={styles.hintWarn}>
                  {t.goalTooShort}
                </p>
              ) : null}
              <label className={styles.label}>
                {t.outputLocale}
                <select className={styles.input} value={outputLocale} onChange={(e) => setOutputLocale(e.target.value as Locale)}>
                  <option value="en">English</option>
                  <option value="zh-CN">中文</option>
                </select>
              </label>
            </>
          )}
        </div>
      ) : null}

      {/* Step 3 — confirm & start */}
      {step === 3 ? (
        <div className={styles.stepBody}>
          {mode === "live" ? (
            preview === "loading" ? (
              <p className={styles.checking}>{t.checkingSample}</p>
            ) : previewError ? (
              <div className={styles.errorBox} role="alert">
                <p className={styles.errorText}>{previewError}</p>
                <button type="button" className="btn btn-secondary" onClick={() => void checkSample()}>
                  {t.recheck}
                </button>
              </div>
            ) : preview ? (
              <div className={styles.sampleGrid}>
                {/* Live sample card */}
                <div className={`${styles.sampleCard} ${liveDisabled ? styles.sampleCardDisabled : ""}`}>
                  <div className={styles.sampleHead}>
                    <strong>{t.liveSample}</strong>
                    {preview.recommendedSelection === "live" ? <span className="chip chip-accent">{t.recommended}</span> : null}
                  </div>
                  <p className={styles.sampleCount}>
                    {preview.live.reviewCount} {t.freshReviews}
                  </p>
                  <p className={styles.sampleSource}>{providerLabel}</p>
                  {preview.live.collectedAt ? <p className={styles.sampleMeta}>{new Date(preview.live.collectedAt).toLocaleString()}</p> : null}
                  {preview.live.provider === "serpapi" && preview.live.searchCount > 0 ? (
                    <p className={styles.sampleMeta}>
                      {t.searchesUsed}: {preview.live.searchCount}
                    </p>
                  ) : null}
                  {fallbackReason ? <p className={styles.sampleWarn}>{fallbackReason.message}</p> : null}
                  <p className={styles.sampleCaveat}>{t.freshnessCaveat}</p>
                  {liveDisabled ? (
                    <p className={styles.sampleWarn}>{t.noSampleAvailable}</p>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => startWithPreview("live")}>
                      {t.analyzeFresh}
                    </button>
                  )}
                </div>

                {/* Stable sample card */}
                <div className={`${styles.sampleCard} ${stableDisabled ? styles.sampleCardDisabled : ""}`}>
                  <div className={styles.sampleHead}>
                    <strong>{t.stableSample}</strong>
                    {preview.recommendedSelection === "stable" ? <span className="chip chip-accent">{t.recommended}</span> : null}
                  </div>
                  <p className={styles.sampleCount}>
                    {preview.stable.reviewCount} {t.localHistoryReviews}
                  </p>
                  <p className={styles.sampleMeta}>
                    {t.cacheUpdated}: {preview.stable.cacheUpdatedAt ? new Date(preview.stable.cacheUpdatedAt).toLocaleString() : "—"}
                  </p>
                  {stableDisabled ? (
                    <p className={styles.sampleWarn}>{t.noSampleAvailable}</p>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => startWithPreview("stable")}>
                      {t.analyzeHistory}
                    </button>
                  )}
                </div>
              </div>
            ) : null
          ) : (
            <div className={styles.confirmBox}>
              <p className={styles.confirmRow}>
                <span className={styles.muted}>{t.confirmFile}:</span> <strong>{file?.name}</strong>
              </p>
              <p className={styles.confirmRow}>
                <span className={styles.muted}>{t.goal}:</span> {goal}
              </p>
              <p className={styles.confirmRow}>
                <span className={styles.muted}>{t.outputLocale}:</span> {outputLocale === "zh-CN" ? "中文" : "English"}
              </p>
              <button type="button" className="btn btn-primary" onClick={startImport}>
                {t.start}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Footer navigation */}
      <div className={styles.nav}>
        {step > 1 ? (
          <button type="button" className="btn btn-secondary" onClick={handleBack}>
            {t.back}
          </button>
        ) : (
          <span />
        )}
        {step === 2 ? (
          <button type="button" className="btn btn-primary" disabled={!step2Valid} onClick={handleNext}>
            {t.next}
          </button>
        ) : null}
      </div>
    </div>
  );
}
