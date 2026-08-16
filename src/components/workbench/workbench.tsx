"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Locale } from "@/i18n";
import { getDictionary } from "@/i18n";

import type { RunEvent } from "@/domain/contracts/events";
import { useRunStream, LAST_RUN_ID_KEY } from "@/hooks/use-run-stream";


import { useRunArtifacts } from "@/hooks/use-run-artifacts";
import { RunForm } from "./run-form";
import { LiveProgress } from "./live-progress";
import { SettingsPanel } from "./settings-panel";
import { HistoryPanel } from "./history-panel";
import { Sidebar, type TabId } from "./sidebar";
import { Icon } from "@/components/ui/icons";
import { RunLogPanel } from "./run-log-panel";
import { ReviewsTable } from "@/components/artifacts/reviews-table";
import { TopicsPanel, FindingsPanel, RequirementsPanel, TestsPanel, TraceabilityPanel } from "@/components/artifacts/panels";
import { ClassificationPanel, EvidenceValidationPanel, VersionPlanPanel, ArtifactPhaseSelector, FinalDeliverablesPanel } from "@/components/artifacts/workflow-panels";
import { ProvenanceBadge } from "./provenance-badge";
import { OverviewTab } from "./overview-tab";
import { ExecutiveReport } from "./executive-report";
import styles from "./workbench.module.css";

type Tab = TabId;

type ViewMode = "workbench" | "report";

let timerNow = 0;

function subscribeTimer(callback: () => void) {
  timerNow = Date.now();
  const interval = setInterval(() => {
    timerNow = Date.now();
    callback();
  }, 1000);
  return () => clearInterval(interval);
}

function getTimerSnapshot() {
  return timerNow;
}

function getServerTimerSnapshot() {
  return 0;
}

const noopSubscribe = () => () => {};

function RunDuration({ events, running }: { events: RunEvent[]; running: boolean }) {
  const now = useSyncExternalStore(
    running ? subscribeTimer : noopSubscribe,
    getTimerSnapshot,
    getServerTimerSnapshot,
  );

  const durationStr = useMemo(() => {
    if (events.length === 0) return null;
    const startEvent = events.find((e) => e.type === "run.accepted") ?? events[0];
    const endEvent = events.find((e) => e.type === "run.completed" || e.type === "run.failed");
    const startTime = new Date(startEvent.timestamp).getTime();
    const endTime = endEvent ? new Date(endEvent.timestamp).getTime() : now;
    const elapsed = Math.max(0, endTime - startTime);
    const min = Math.floor(elapsed / 60000);
    const sec = Math.floor((elapsed % 60000) / 1000);
    return `${min}m ${sec}s`;
  }, [events, now]);

  if (!durationStr) return null;
  return (
    <span className={styles.headerDuration}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {durationStr}
    </span>
  );
}

/** `null` until GET /api/config resolves, so the header shows a neutral
 *  "checking" chip instead of flashing 未配置 → 已配置 on the first frame. */
type ConfigStatus = { modelConfigured: boolean; serpApiConfigured: boolean } | null;

export function Workbench() {
  const [uiLocale, setUiLocale] = useState<Locale>("zh-CN");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = getDictionary(uiLocale);

  // Keep the document language in sync with the UI locale so assistive
  // technology and translation tooling use the right language.
  useEffect(() => {
    document.documentElement.lang = uiLocale === "zh-CN" ? "zh-CN" : "en";
  }, [uiLocale]);

  const { runId, status, events, running, reconnecting, gone, error, canRetry, start, reset, retry, loadHistory } = useRunStream();
  const [tab, setTab] = useState<Tab>("overview");
  const [viewMode, setViewMode] = useState<ViewMode>("workbench");
  const [reviewSearchQuery, setReviewSearchQuery] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>(null);

  const userNavigated = useRef(false);

  const {
    cache,
    cleanedReviews,
    stats,
    versions,
    prdPhase,
    setPrdPhase,
    prdDraft,
    prdFinal,
    activePrd,
    testsPhase,
    setTestsPhase,
    testsFinal,
    activeTests,
    tracePhase,
    setTracePhase,
    traceDraft,
    traceFinal,
    activeTrace,
    versionPhase,
    setVersionPhase,
    versionPlanFinal,
    activeVersionPlan,
    resetArtifacts,
  } = useRunArtifacts({
    runId,
    status,
    events,
    running,
    tab,
    userNavigatedRef: userNavigated,
    onAutoAdvanceTab: (jumpedTab) => {
      setTab(jumpedTab);
    },
  });


  // URL state persistence (tab & mode). The restore is deferred to a microtask
  // so it isn't a synchronous setState inside the effect (which the compiler
  // flags as a cascading-render risk); microtasks run before the next paint, so
  // the observable timing is unchanged.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    const urlTab = search.get("tab") as Tab | null;
    const urlMode = search.get("mode") as ViewMode | null;
    queueMicrotask(() => {
      if (urlTab) {
        setTab(urlTab);
        userNavigated.current = true;
      }
      if (urlMode === "report" || urlMode === "workbench") {
        setViewMode(urlMode);
      }
    });
  }, []);

  const updateUrlState = useCallback((nextTab: Tab, nextMode: ViewMode) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    url.searchParams.set("mode", nextMode);
    window.history.pushState({ tab: nextTab, mode: nextMode }, "", url.toString());
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const search = new URLSearchParams(window.location.search);
      const urlTab = search.get("tab") as Tab | null;
      const urlMode = search.get("mode") as ViewMode | null;
      if (urlTab) {
        setTab(urlTab);
        userNavigated.current = true;
      }
      if (urlMode === "report" || urlMode === "workbench") {
        setViewMode(urlMode);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleSelectTab = useCallback((nextTab: Tab) => {
    userNavigated.current = true;
    setTab(nextTab);
    updateUrlState(nextTab, viewMode);
  }, [viewMode, updateUrlState]);

  const handleSelectViewMode = useCallback((nextMode: ViewMode) => {
    setViewMode(nextMode);
    updateUrlState(tab, nextMode);
  }, [tab, updateUrlState]);

  const jumpToReview = useCallback((reviewId: string) => {
    setReviewSearchQuery(reviewId);
    handleSelectTab("cleaned");
    handleSelectViewMode("workbench");
  }, [handleSelectTab, handleSelectViewMode]);

  const jumpToTests = useCallback(() => {
    handleSelectTab("tests");
    handleSelectViewMode("workbench");
  }, [handleSelectTab, handleSelectViewMode]);

  const jumpToPrd = useCallback(() => {
    handleSelectTab("prd");
    handleSelectViewMode("workbench");
  }, [handleSelectTab, handleSelectViewMode]);

  const handleCancelNewRun = useCallback(() => {
    const lastRunId = typeof window !== "undefined" ? localStorage.getItem(LAST_RUN_ID_KEY) : null;
    if (lastRunId) {
      loadHistory(lastRunId);
    }
  }, [loadHistory]);

  // Non-secret config status for the header badges. Fetched once on mount and
  // refreshed after the settings panel saves/clears.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const json = (await res.json()) as { modelConfigured?: boolean; serpApiKeyConfigured?: boolean };
        if (!cancelled) {
          setConfigStatus({ modelConfigured: Boolean(json.modelConfigured), serpApiConfigured: Boolean(json.serpApiKeyConfigured) });
        }
      } catch {
        // Non-fatal: badges simply stay "not configured".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Source provenance: prefer the structured source-evidence artifact, then the
  // event/limitation signals, over the deliveryMode fallback — so Imported /
  // Partial / Suspect Empty and the SocialCrawl provider are never mislabeled.
  const sourceBadge = useMemo(() => {
    const last = events.at(-1);
    if (last?.deliveryMode === "cached-replay") return { kind: "limitation" as const, label: t.cachedReplay };
    const evidence = cache.sourceEvidence;
    if (evidence?.kind === "app-store-reviews" && evidence.provider === "serpapi") {
      return { kind: "source" as const, label: evidence.selection === "stable" ? t.sourceSerpApiHistory : t.sourceSerpApi };
    }
    // Legacy replay only: old cached artifacts may still carry socialcrawl
    // provenance; it is read-only and never produced by new previews or runs.
    if (evidence?.kind === "app-store-reviews" && evidence.provider === "socialcrawl") {
      return { kind: "source" as const, label: evidence.selection === "stable" ? t.sourceSerpApiHistory : t.sourceSerpApi };
    }
    if (evidence?.kind === "app-store-reviews" && evidence.provider === "apple-rss") {
      return { kind: "source" as const, label: evidence.selection === "stable" ? t.sourceRssHistory : t.sourceRssFallback };
    }
    const texts = events.map((e) => JSON.stringify(e.data ?? {}));
    // A stable sample augmented by the review cache is a hybrid source.
    if (texts.some((s) => s.includes("LOCAL_HISTORY_SELECTED") || s.includes("RSS_CACHE_AUGMENTED"))) return { kind: "source" as const, label: t.sourceLiveCache };
    if (texts.some((s) => s.includes("RSS_SUSPECT_EMPTY"))) return { kind: "conflict" as const, label: t.sourceSuspectEmpty };
    if (texts.some((s) => s.includes("IMPORT_ERROR") || s.includes("RSS_PARTIAL") || s.includes("RSS_UNSTABLE_PAGINATION"))) return { kind: "conflict" as const, label: t.sourcePartial };
    // If a limitation.reported carries no import/partial marker but the run
    // used an import source, the limitation code list distinguishes it.
    if (texts.some((s) => s.includes('"kind":"import"') || s.includes("IMPORT_") || s.includes("import:"))) {
      return { kind: "source" as const, label: t.sourceImported };
    }
    return { kind: "source" as const, label: t.sourceLive };
  }, [events, cache.sourceEvidence, t]);


  const handleNewRun = () => {
    reset();
    resetArtifacts();
    setTab("overview");
    userNavigated.current = false;
  };

  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetryHistory = useCallback(async (sourceRunId: string) => {
    setHistoryOpen(false);
    setIsRetrying(true);
    let requestToStart: unknown = null;
    try {
      const res = await fetch(`/api/runs/${sourceRunId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as {
        goal?: string;
        appName?: string;
        appUrl?: string;
        startRequest?: { source?: { kind: string; appStoreUrl?: string; previewId?: string; reviewSelection?: string; reviewLimit?: 100 | 300 | 500 } };
      };
      if (manifest.startRequest) {
        const req = manifest.startRequest;
        // If retrying a historical live run, strip previewId so it freshly collects or leverages local cache without stale preview snapshot issues. reviewSelection must be stripped together (the server requires previewId + reviewSelection to be paired).
        requestToStart = {
          ...req,
          source: req.source?.kind === "live" && req.source.appStoreUrl
            ? {
                kind: "live",
                appStoreUrl: req.source.appStoreUrl,
                ...(req.source.reviewLimit ? { reviewLimit: req.source.reviewLimit } : {}),
              }
            : req.source,
        };
      } else if (manifest.appUrl && manifest.goal) {
        // Fallback for older historical runs without saved startRequest: reconstruct start request
        requestToStart = {
          protocolVersion: "1",
          mode: "analyze",
          uiLocale,
          outputLocale: uiLocale,
          goal: manifest.goal,
          source: { kind: "live", appStoreUrl: manifest.appUrl },
        };
      }
    } catch {
      // ignore
    } finally {
      setIsRetrying(false);
    }

    if (requestToStart) {
      resetArtifacts();
      setTab("overview");
      userNavigated.current = false;
      void start(requestToStart);
    } else {
      loadHistory(sourceRunId);
    }
  }, [start, loadHistory, uiLocale, resetArtifacts]);


  // Refresh recovery: on mount, restore the latest in-flight run (or the last
  // viewed run) so a page refresh keeps monitoring the same analysis. A stored
  // id that no longer resolves simply falls back to the idle state.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const restored = localStorage.getItem(LAST_RUN_ID_KEY);
    if (!restored) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/runs", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { runs?: { runId: string; status: string }[] };
        if (cancelled) return;
        const runs = json.runs ?? [];
        const runningRun = runs.find((r) => r.status === "running");
        const target = runningRun?.runId ?? (runs.some((r) => r.runId === restored) ? restored : null);
        if (target && !cancelled) loadHistory(target);
      } catch {
        // Non-fatal: the idle state remains.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  const idle = !running && events.length === 0 && !isRetrying;
  const starting = running && runId === null;

  const runFailed = useMemo(() => {
    if (running) return false;
    // A gone run is terminal even when no event ever arrived (e.g. loading
    // the history of a since-deleted run).
    if (gone) return true;
    if (events.length === 0) return false;
    if (Boolean(error)) return true;
    if (status === "failed") return true;
    if (status === "interrupted") return true;
    if (events.some((e) => e.type === "run.failed")) return true;
    return false;
  }, [running, error, gone, events, status]);

  const runFailedMessage = useMemo(() => {
    if (error) return error;
    if (gone) return t.runNotFound;
    const failedEvent = events.find((e) => e.type === "run.failed");
    if (failedEvent) {
      const data = failedEvent.data as { error?: string; outcome?: string } | undefined;
      return data?.error ?? (data?.outcome ? `Outcome: ${data.outcome}` : t.failed);
    }
    if (status === "interrupted") return t.interrupted;
    if (status === "failed") return t.failed;
    return null;
  }, [error, gone, events, status, t]);

  const handleRetryCurrent = useCallback(() => {
    if (canRetry) {
      void retry();
    } else if (runId) {
      void handleRetryHistory(runId);
    }
  }, [canRetry, retry, runId, handleRetryHistory]);

  const statusLabel = useMemo(() => {
    if (status === "running") return t.running;
    if (status === "interrupted") return t.interrupted;
    if (status === "completed") return t.completed;
    if (status === "failed") return t.failed;
    return null;
  }, [status, t]);

  const runningStatusText = running
    ? (starting ? t.starting : t.running)
    : reconnecting
      ? t.reconnecting
      : statusLabel ?? t.waiting;

  return (
    <div className={styles.shell}>
      {/* Visually-hidden live region for run status. */}
      <div className="live-region" aria-live="polite">
        {runningStatusText}
      </div>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brandWrap}>
          <div className={styles.brandLogo}>
            <Icon name="sparkles" size={14} />
          </div>
          <h1 className={styles.brand}>{t.appTitle}</h1>
        </div>

        <div className={styles.headerStatus}>
          {configStatus === null ? (
            <span className="chip chip-muted" title={t.modelStatus}>
              {t.modelStatus}: {t.modelStatusLoading}
            </span>
          ) : (
            <span className={configStatus.modelConfigured ? "chip chip-ok" : "chip chip-muted"} title={t.modelStatus}>
              {t.modelStatus}: {configStatus.modelConfigured ? t.modelConfigured : t.modelNotConfigured}
            </span>
          )}
          <span className="chip chip-accent" title={t.collectionStatus}>
            {t.collectionStatus}: {t.collectionConfigured}
          </span>
          <RunDuration events={events} running={running} />
        </div>

        <span className={styles.spacer} />

        <ProvenanceBadge kind={sourceBadge.kind} label={sourceBadge.label} />

        <div className={styles.modeSwitcher} role="group" aria-label={t.viewModeWorkbench}>
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === "workbench" ? styles.modeBtnActive : ""}`}
            onClick={() => {
              handleSelectViewMode("workbench");
              if (idle) {
                handleCancelNewRun();
              }
            }}
          >
            <Icon name="overview" size={13} />
            <span>{t.viewModeWorkbench}</span>
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === "report" ? styles.modeBtnActive : ""}`}
            onClick={() => {
              handleSelectViewMode("report");
              if (idle) {
                handleCancelNewRun();
              }
            }}
          >
            <Icon name="report" size={13} />
            <span>{t.viewModeReport}</span>
          </button>
        </div>

        <div className={styles.headerActions}>
          {runFailed ? (
            <button className="btn btn-danger" onClick={handleRetryCurrent} disabled={isRetrying}>
              <Icon name="refresh" size={13} />
              <span>{isRetrying ? t.retrying : t.retry}</span>
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={handleNewRun} disabled={isRetrying}>
            <Icon name="plus" size={13} />
            <span>{t.newRun}</span>
          </button>
          <button className="btn btn-ghost" onClick={() => setHistoryOpen(true)} title={t.history}>
            <Icon name="history" size={13} />
            <span>{t.history}</span>
          </button>
          <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)} title={t.settings}>
            <Icon name="settings" size={13} />
            <span>{t.settings}</span>
          </button>
          <select
            className={styles.langSelect}
            value={uiLocale}
            onChange={(e) => setUiLocale(e.target.value as Locale)}
            aria-label={t.language}
          >
            <option value="en">English</option>
            <option value="zh-CN">中文</option>
          </select>
        </div>

        <SettingsPanel
          t={t}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onConfigChange={(status) => setConfigStatus(status)}
        />
        <HistoryPanel
          t={t}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onView={(runId) => {
            setHistoryOpen(false);
            loadHistory(runId);
          }}
          onReplay={(runId) => {
            setHistoryOpen(false);
            void start({ protocolVersion: "1", mode: "cached-replay", sourceRunId: runId });
          }}
          onRetry={handleRetryHistory}
        />
      </header>

      {/* Idle: centered analysis wizard */}
      {idle ? (
        <div className={styles.idle}>
          <div className={styles.wizardCard}>
            <RunForm t={t} onStart={start} onCancel={handleCancelNewRun} />
            <p className={styles.waiting}>{t.waiting}</p>
          </div>
        </div>
      ) : starting ? (
        <div className={styles.startingWrap}>
          <div className={styles.starting}>
            <span className={styles.startingDot} />
            <span>{t.starting}</span>
          </div>
        </div>
      ) : (
        <div className={styles.workbench}>
          {/* Left: Sidebar Navigation */}
          <Sidebar
            activeTab={tab}
            onSelectTab={handleSelectTab}
            viewMode={viewMode}
            onSelectViewMode={handleSelectViewMode}
            t={t}
            onUserNavigate={() => {
              userNavigated.current = true;
            }}
          />

          {/* Right: main content */}
          <main className={styles.content}>
            {runFailed ? (
              <div className="card" style={{ borderLeft: "3px solid var(--danger)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, color: "var(--danger)" }}>
                    <Icon name="alertCircle" size={16} />
                    <span>{t.runFailed}</span>
                  </div>
                  {runFailedMessage ? <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>{runFailedMessage}</p> : null}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" className="btn btn-danger" onClick={handleRetryCurrent} disabled={isRetrying}>
                    {isRetrying ? t.retrying : t.retry}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleNewRun} disabled={isRetrying}>
                    {t.newRun}
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.progressRow}>
              <LiveProgress events={events} running={running} t={t} />
            </div>

            {viewMode === "report" ? (
              <ExecutiveReport
                manifest={versions.manifest}
                findings={cache.findings?.findings ?? []}
                versionPlan={activeVersionPlan}
                prd={activePrd}
                stats={stats ? {
                  rawCount: stats.rawCount,
                  includedCount: stats.includedCount,
                  ratingDistribution: stats.ratingDistribution,
                } : undefined}
                goalCoverage={cache.goalCoverage}
                t={t}
                onJumpToReview={jumpToReview}
                onSwitchToWorkbench={() => setViewMode("workbench")}
              />
            ) : (
              <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "overview" ? (
                <OverviewTab
                  manifest={versions.manifest}
                  stats={stats}
                  findings={cache.findings?.findings}
                  goalCoverage={cache.goalCoverage}
                  cleaned={cache.cleaned}
                  finalReport={cache.finalReport}
                  activePrd={activePrd}
                  sourceBadge={sourceBadge}
                  t={t}
                  locale={uiLocale}
                  onSelectTab={handleSelectTab}
                />
              ) : null}

              {(tab === "raw" || tab === "cleaned") && cleanedReviews.length > 0 ? (
                <ReviewsTable
                  reviews={cleanedReviews}
                  t={t}
                  searchQuery={reviewSearchQuery}
                  onSearchChange={setReviewSearchQuery}
                />
              ) : (tab === "raw" || tab === "cleaned") && !running ? (
                <p className="muted">{t.noData}</p>
              ) : null}

              {tab === "classification" ? <ClassificationPanel candidates={cache.topicCandidates?.candidates ?? []} t={t} onJumpToReview={jumpToReview} /> : null}
              {tab === "topics" ? <TopicsPanel topics={cache.topics?.topics ?? []} t={t} onJumpToReview={jumpToReview} /> : null}
              {tab === "findings" ? <FindingsPanel findings={cache.findings?.findings ?? []} t={t} onJumpToReview={jumpToReview} /> : null}
              {tab === "evidence" ? <EvidenceValidationPanel report={cache.evidenceValidation as never} t={t} /> : null}
              {tab === "versions" ? (
                <>
                  <ArtifactPhaseSelector revised={versionPlanFinal !== null} phase={versionPhase} onSelect={setVersionPhase} t={t} />
                  <VersionPlanPanel versionPlan={activeVersionPlan} t={t} />
                </>
              ) : null}
              {tab === "prd" ? (
                <>
                  <ArtifactPhaseSelector revised={prdFinal !== null} phase={prdPhase} onSelect={setPrdPhase} t={t} />
                  <RequirementsPanel
                    requirements={activePrd?.requirements ?? []}
                    versions={activePrd?.versions ?? []}
                    assumptions={activePrd?.assumptions ?? []}
                    t={t}
                    onJumpToReview={jumpToReview}
                    onJumpToTests={jumpToTests}
                  />
                </>
              ) : null}
              {tab === "tests" ? (
                <>
                  <ArtifactPhaseSelector revised={testsFinal.length > 0} phase={testsPhase} onSelect={setTestsPhase} t={t} />
                  <TestsPanel
                    tests={activeTests}
                    requirements={activePrd?.requirements ?? []}
                    t={t}
                    onJumpToReview={jumpToReview}
                    onJumpToPrd={jumpToPrd}
                  />
                </>
              ) : null}
              {tab === "traceability" ? (
                <>
                  <ArtifactPhaseSelector revised={traceFinal !== null} phase={tracePhase} onSelect={setTracePhase} t={t} />
                  <TraceabilityPanel
                    report={activeTrace}
                    findings={cache.findings?.findings}
                    prd={activePrd}
                    tests={activeTests}
                    t={t}
                    onJumpToReview={jumpToReview}
                    onJumpToPrd={jumpToPrd}
                    onJumpToTests={jumpToTests}
                  />
                </>
              ) : null}
              {tab === "deliverables" ? <FinalDeliverablesPanel finalPrd={prdFinal ?? prdDraft} report={traceFinal ?? traceDraft} manifest={versions.manifest} goalCoverage={cache.goalCoverage} t={t} locale={uiLocale} /> : null}
              {tab === "diagnostics" ? <RunLogPanel events={events} t={t} locale={uiLocale} /> : null}
            </div>
          )}
        </main>
      </div>
        )}
    </div>
  );
}
