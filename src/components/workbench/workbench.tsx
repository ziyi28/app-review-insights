"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Locale } from "@/i18n";
import { getDictionary } from "@/i18n";
import type { Finding, Prd } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import type { RunEvent } from "@/domain/contracts/events";
import { useRunStream, LAST_RUN_ID_KEY, TERMINAL_STATUSES } from "@/hooks/use-run-stream";
import { useArtifactVersions } from "@/hooks/use-artifact-versions";
import { RunForm } from "./run-form";
import { LiveProgress } from "./live-progress";
import { SettingsPanel } from "./settings-panel";
import { HistoryPanel } from "./history-panel";
import { Sidebar, type TabId } from "./sidebar";
import { Icon } from "@/components/ui/icons";
import { RunLogPanel } from "./run-log-panel";
import { ReviewsTable } from "@/components/artifacts/reviews-table";
import { TopicsPanel, FindingsPanel, RequirementsPanel, TestsPanel, TraceabilityPanel } from "@/components/artifacts/panels";
import { RatingDistribution, VersionDistribution, LanguageDistribution } from "@/components/artifacts/stats-panels";
import { ClassificationPanel, EvidenceValidationPanel, VersionPlanPanel, ArtifactPhaseSelector, FinalDeliverablesPanel } from "@/components/artifacts/workflow-panels";
import { ProvenanceBadge } from "./provenance-badge";
import { ExecutiveReport } from "./executive-report";
import type { VersionPlanArtifact } from "@/domain/contracts/analysis";
import styles from "./workbench.module.css";

type Tab = TabId;

type ViewMode = "workbench" | "report";

const AUTO_ADVANCE_ORDER: { key: keyof ArtifactCache; tab: Tab }[] = [
  { key: "topicCandidates", tab: "classification" },
  { key: "topics", tab: "topics" },
  { key: "findings", tab: "findings" },
  { key: "evidenceValidation", tab: "evidence" },
  { key: "versionPlan", tab: "versions" },
  { key: "prd", tab: "prd" },
  { key: "tests", tab: "tests" },
  { key: "traceability", tab: "traceability" },
  { key: "finalReport", tab: "deliverables" },
];

type SourceEvidence = {
  kind: "app-store-reviews" | "apple-rss" | "import";
  provider?: "serpapi" | "apple-rss" | "socialcrawl";
  selection?: "live" | "stable";
};

type AnalysisSampleArtifact = {
  strategy: string;
  eligibleCount: number;
  selectedCount: number;
  limit: number;
  selectedReviewIds: string[];
  layers: { rating: number; language: string; candidates: number; selected: number }[];
};

type GoalCoverageArtifact = {
  valid: boolean;
  retried: boolean;
  items: { focusAreaId: string; label: string; status: "covered" | "unsupported" | "uncovered"; findingIds: string[]; requirementIds: string[] }[];
};

function subscribeTimer(callback: () => void) {
  const interval = setInterval(callback, 1000);
  return () => clearInterval(interval);
}

function getTimerSnapshot() {
  return Date.now();
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

type ArtifactCache = {
  runId: string | null;
  scope?: unknown;
  cleaned?: { reviews: unknown[]; stats?: unknown; cleaning?: unknown };
  stats?: unknown;
  analysisSample?: AnalysisSampleArtifact;
  sourceEvidence?: SourceEvidence;
  topicCandidates?: { candidates: { id: string; label: string; description: string; supportingReviewIds: string[]; quote: string }[] };
  topics?: { topics: { id: string; label: string; description: string; reviewIds: string[] }[] };
  findings?: { findings: Finding[] };
  evidenceValidation?: unknown;
  goalCoverage?: GoalCoverageArtifact;
  versionPlan?: VersionPlanArtifact;
  prd?: Prd;
  tests?: { tests: Prd["tests"] };
  traceability?: { valid: boolean; violations: { code: string; message: string }[] };
  finalReport?: { prd?: Prd; report?: { valid: boolean; violations: { code: string; message: string }[] }; limitations?: unknown[]; goalCoverage?: GoalCoverageArtifact };
};

type ConfigStatus = { modelConfigured: boolean; serpApiConfigured: boolean };

export function Workbench() {
  const [uiLocale, setUiLocale] = useState<Locale>("zh-CN");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = getDictionary(uiLocale);

  // Keep the document language in sync with the UI locale so assistive
  // technology and translation tooling use the right language.
  useEffect(() => {
    document.documentElement.lang = uiLocale === "zh-CN" ? "zh-CN" : "en";
  }, [uiLocale]);

  const { runId, status, events, running, reconnecting, error, canRetry, start, reset, retry, loadHistory } = useRunStream();
  const [tab, setTab] = useState<Tab>("overview");
  const [viewMode, setViewMode] = useState<ViewMode>("workbench");
  const [reviewSearchQuery, setReviewSearchQuery] = useState<string>("");
  const [cache, setCache] = useState<ArtifactCache>({ runId: null });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>({ modelConfigured: false, serpApiConfigured: false });

  const jumpToReview = useCallback((reviewId: string) => {
    setReviewSearchQuery(reviewId);
    setTab("cleaned");
    setViewMode("workbench");
  }, []);

  const jumpToTests = useCallback(() => {
    setTab("tests");
    setViewMode("workbench");
  }, []);

  const jumpToPrd = useCallback(() => {
    setTab("prd");
    setViewMode("workbench");
  }, []);

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

  // Auto-advance bookkeeping: which artifact keys we already jumped to, and
  // whether the user has manually chosen a tab (which stops auto-advancing for
  // the rest of the run).
  const autoJumpedKeys = useRef<Set<keyof ArtifactCache>>(new Set());
  const userNavigated = useRef(false);

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

  // Load artifacts as they become available via the event stream.
  const artifactNameToKey = useMemo(() => {
    const map: Record<string, keyof ArtifactCache> = {
      "scope": "scope",
      "cleaned-reviews": "cleaned",
      "stats": "stats",
      "analysis-sample": "analysisSample",
      "source-evidence": "sourceEvidence",
      "topic-candidates": "topicCandidates",
      "topics": "topics",
      "findings": "findings",
      "evidence-validation": "evidenceValidation",
      "goal-coverage": "goalCoverage",
      "version-plan": "versionPlan",
      "prd": "prd",
      "tests": "tests",
      "traceability": "traceability",
      "final-report": "finalReport",
    };
    return map;
  }, []);

  // Derive the artifact attempts that have been announced by the event stream.
  // The UI only fetches an artifact once its `artifact.available` event has
  // arrived — never by unconditionally polling every name. A revised attempt 2
  // replaces attempt 1 because the map tracks the latest announced attempt.
  const availableArtifacts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.type === "artifact.available") {
        const d = e.data as { artifact?: string; attempt?: number };
        if (d.artifact) map.set(d.artifact, d.attempt ?? 1);
      }
    }
    return map;
  }, [events]);

  // Fetch each announced artifact exactly once, keyed by name+attempt+runId so a
  // stale request can never overwrite a newer attempt or a different run.
  const loadedArtifactKeys = useRef<Set<string>>(new Set());
  const seenRunId = useRef<string | null>(null);
  useEffect(() => {
    if (!runId) return;
    if (seenRunId.current !== runId) {
      seenRunId.current = runId;
      loadedArtifactKeys.current.clear();
      setCache({ runId });
      setTab("overview");
      autoJumpedKeys.current.clear();
      userNavigated.current = false;
    }
    let cancelled = false;
    const fetchMissing = async () => {
      for (const [name, attempt] of availableArtifacts) {
        const key = artifactNameToKey[name];
        if (!key) continue;
        const loadKey = `${runId}:${name}:${attempt}`;
        if (loadedArtifactKeys.current.has(loadKey)) continue;
        loadedArtifactKeys.current.add(loadKey);
        try {
          const res = await fetch(`/api/runs/${runId}/artifacts/${name}?attempt=${attempt}`, { cache: "no-store" });
          if (!res.ok) {
            loadedArtifactKeys.current.delete(loadKey);
            continue;
          }
          const value = await res.json();
          if (!cancelled) setCache((c) => ({ ...c, runId, [key]: value }));
        } catch {
          loadedArtifactKeys.current.delete(loadKey);
        }
      }
    };
    void fetchMissing();
    return () => {
      cancelled = true;
    };
  }, [runId, availableArtifacts, artifactNameToKey]);

  // Auto-advance the active tab to the newest artifact as it lands, so a live
  // run shows results without manual clicking. Stops the moment the user picks
  // a tab themselves (userNavigated), once a key has already been followed, or
  // once the run is no longer in flight (a completed history view stays pinned
  // to Overview rather than jumping to whichever tab loaded last).
  useEffect(() => {
    if (!running) return;
    if (userNavigated.current) return;
    let jumpedTarget: Tab | null = null;
    for (const { key, tab: target } of AUTO_ADVANCE_ORDER) {
      if (cache[key] !== undefined && !autoJumpedKeys.current.has(key)) {
        autoJumpedKeys.current.add(key);
        jumpedTarget = target;
      }
    }
    if (jumpedTarget) {
      setTab(jumpedTarget);
    }
  }, [cache, running]);

  const cleanedReviews = useMemo(() => {
    const prepared = cache.cleaned as { reviews?: NormalizedReview[] } | undefined;
    if (!prepared?.reviews) return [] as NormalizedReview[];
    const all = prepared.reviews;
    const included = all.filter((r) => r.includedInAnalysis);
    if (tab === "raw") return all;
    return included;
  }, [cache.cleaned, tab]);

  const stats = useMemo(() => {
    const s = (cache.stats ??
      (cache.cleaned as { stats?: unknown } | undefined)?.stats) as
      | {
          rawCount: number;
          includedCount: number;
          duplicateCount: number;
          identityConflictCount: number;
          ratingDistribution: Record<number, number>;
          versionDistribution: Record<string, number>;
          languageDistribution: Record<string, number>;
        }
      | undefined;
    return s;
  }, [cache.stats, cache.cleaned]);

  // Terminal state: fetch the Draft/Final artifact pairs once the run finishes
  // so revised runs show attempt 1 vs attempt 2 and never a stale draft.
  const terminal = status !== null && TERMINAL_STATUSES.includes(status);
  const versions = useArtifactVersions(runId, terminal);
  const [prdPhase, setPrdPhase] = useState<"draft" | "final">("draft");
  const [testsPhase, setTestsPhase] = useState<"draft" | "final">("draft");
  const [tracePhase, setTracePhase] = useState<"draft" | "final">("draft");
  const [versionPhase, setVersionPhase] = useState<"draft" | "final">("draft");

  // Authoritative panels: during a run use the live cache (marked Draft); at
  // terminal, prefer the hook's attempt 1/latest pair. A never-revised run
  // shows the draft as the final (no revision required).
  const prdDraft = versions.prd.draft ?? cache.prd ?? null;
  const prdFinal = versions.prd.final ?? cache.finalReport?.prd ?? null;
  const testsDraft = versions.tests.draft?.tests ?? cache.tests?.tests ?? [];
  const testsFinal = versions.tests.final?.tests ?? cache.finalReport?.prd?.tests ?? [];
  const traceDraft = versions.traceability.draft ?? cache.traceability ?? null;
  const traceFinal = versions.traceability.final ?? cache.finalReport?.report ?? null;
  const versionPlanDraft = versions.versionPlan.draft ?? cache.versionPlan ?? null;
  const versionPlanFinal = versions.versionPlan.final ?? null;

  const activePrd = prdPhase === "final" && prdFinal ? prdFinal : prdDraft;
  const activeTests = testsPhase === "final" && testsFinal.length > 0 ? testsFinal : testsDraft;
  const activeTrace = tracePhase === "final" && traceFinal ? traceFinal : traceDraft;
  const activeVersionPlan = versionPhase === "final" && versionPlanFinal ? versionPlanFinal : versionPlanDraft;

  const handleNewRun = () => {
    reset();
    seenRunId.current = null;
    setCache({ runId: null });
    setTab("overview");
    autoJumpedKeys.current.clear();
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
        // If retrying a historical live run, strip previewId so it freshly collects or leverages local cache without stale preview snapshot issues
        requestToStart = {
          ...req,
          source: req.source?.kind === "live" && req.source.appStoreUrl
            ? {
                kind: "live",
                appStoreUrl: req.source.appStoreUrl,
                ...(req.source.reviewSelection ? { reviewSelection: req.source.reviewSelection } : {}),
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
      seenRunId.current = null;
      setCache({ runId: null });
      setTab("overview");
      autoJumpedKeys.current.clear();
      userNavigated.current = false;
      void start(requestToStart);
    } else {
      loadHistory(sourceRunId);
    }
  }, [start, loadHistory, uiLocale]);

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
    if (running || events.length === 0) return false;
    if (Boolean(error)) return true;
    if (status === "failed") return true;
    if (status === "interrupted") return true;
    if (events.some((e) => e.type === "run.failed")) return true;
    return false;
  }, [running, error, events, status]);

  const runFailedMessage = useMemo(() => {
    if (error) return error;
    const failedEvent = events.find((e) => e.type === "run.failed");
    if (failedEvent) {
      const data = failedEvent.data as { error?: string; outcome?: string } | undefined;
      return data?.error ?? (data?.outcome ? `Outcome: ${data.outcome}` : t.failed);
    }
    if (status === "interrupted") return t.interrupted;
    if (status === "failed") return t.failed;
    return null;
  }, [error, events, status, t]);

  const handleRetryCurrent = useCallback(() => {
    if (canRetry) {
      void retry();
    } else if (runId) {
      void handleRetryHistory(runId);
    }
  }, [canRetry, retry, runId, handleRetryHistory]);

  const statusLabel = useMemo(() => {
    if (status === "running") return running ? t.running : t.running;
    if (status === "interrupted") return t.interrupted;
    if (status === "completed") return t.completed;
    if (status === "failed") return t.failed;
    return null;
  }, [status, running, t]);

  const runningStatusText = running
    ? (starting ? t.starting : t.running)
    : reconnecting
      ? t.reconnecting
      : statusLabel ?? (events.length > 0 ? t.waiting : t.waiting);

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
          <span className={configStatus.modelConfigured ? "chip chip-ok" : "chip chip-muted"} title={t.modelStatus}>
            {t.modelStatus}: {configStatus.modelConfigured ? t.modelConfigured : t.modelNotConfigured}
          </span>
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
            onClick={() => setViewMode("workbench")}
          >
            <Icon name="overview" size={13} />
            <span>{t.viewModeWorkbench}</span>
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === "report" ? styles.modeBtnActive : ""}`}
            onClick={() => setViewMode("report")}
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
            <RunForm t={t} onStart={start} />
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
            onSelectTab={(id) => setTab(id)}
            viewMode={viewMode}
            onSelectViewMode={(mode) => setViewMode(mode)}
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
                <div style={{ display: "grid", gap: "14px" }}>
                  {stats ? (
                    <div className="stat-grid">
                      {[
                        { k: t.rawReviews, v: stats.rawCount },
                        { k: t.cleanedData, v: stats.includedCount },
                        { k: t.duplicates, v: stats.duplicateCount },
                        { k: t.identityConflicts, v: stats.identityConflictCount },
                      ].map((s) => (
                        <div key={s.k} className="stat-card">
                          <div className="stat-value">{s.v}</div>
                          <div className="stat-label">{s.k}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {stats && (stats.ratingDistribution || stats.versionDistribution || stats.languageDistribution) ? (
                    <div className="card" style={{ display: "grid", gap: "16px" }}>
                      <div>
                        <h4 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>{t.ratingDistribution}</h4>
                        <RatingDistribution distribution={stats.ratingDistribution ?? {}} t={t} />
                      </div>
                      <div>
                        <h4 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>{t.versionDistribution}</h4>
                        <VersionDistribution distribution={stats.versionDistribution ?? {}} t={t} />
                      </div>
                      <div>
                        <h4 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>{t.languageDistribution}</h4>
                        <LanguageDistribution distribution={stats.languageDistribution ?? {}} t={t} />
                      </div>
                    </div>
                  ) : null}
                  {cache.analysisSample ? (
                    <div className="card">
                      <div className="card-header">
                        <div className="card-title-wrap">
                          <h4 className="card-title">
                            {t.sampleAnalyzed}: {cache.analysisSample.selectedCount} {t.sampleOf} {cache.analysisSample.eligibleCount}
                          </h4>
                        </div>
                        <ProvenanceBadge kind="computed" label={cache.analysisSample.strategy} />
                      </div>
                      <p className="card-desc muted" style={{ fontSize: "12.5px" }}>
                        {t.sampleStratified}
                      </p>
                    </div>
                  ) : null}
                  {cache.goalCoverage ? (
                    <div className="card">
                      <div className="card-header">
                        <div className="card-title-wrap">
                          <h4 className="card-title">{t.goalCoverage}</h4>
                        </div>
                        <ProvenanceBadge
                          kind={cache.goalCoverage.valid ? "computed" : "conflict"}
                          label={cache.goalCoverage.valid ? t.goalCoverageCovered : t.goalCoverageGap}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginTop: "4px" }}>
                        {cache.goalCoverage.items.map((item) => (
                          <div key={item.focusAreaId} className="card card-elevated" style={{ padding: "10px 12px", gap: "6px" }}>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{item.label}</div>
                            <div>
                              <ProvenanceBadge
                                kind={item.status === "covered" ? "computed" : item.status === "uncovered" ? "conflict" : "limitation"}
                                label={item.status === "covered" ? t.goalCoverageCovered : item.status === "uncovered" ? t.goalCoverageUncovered : t.goalCoverageUnsupported}
                              />
                            </div>
                            <div className="muted" style={{ fontSize: "12px" }}>
                              {t.findingId}: {item.findingIds.length} · {t.requirementId}: {item.requirementIds.length}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(() => {
                    const cleaning = (cache.cleaned as { cleaning?: { unicodeNormalizedCount: number; whitespaceCollapsedCount: number; caseFoldedCount: number; exactDuplicateRemovedCount: number; identityConflictCount: number; keptShortUniqueCount: number; languageLabels: { tag: string; count: number }[] } } | undefined)?.cleaning;
                    if (!cleaning) return null;
                    return (
                      <div className="card">
                        <div className="card-header">
                          <h4 className="card-title">{t.cleaningUnicode}</h4>
                        </div>
                        <div className="card-metadata-grid">
                          <div className="card-metadata-item">
                            <span className="card-metadata-label">{t.cleaningUnicode}</span>
                            <span className="card-metadata-value">{cleaning.unicodeNormalizedCount}</span>
                          </div>
                          <div className="card-metadata-item">
                            <span className="card-metadata-label">{t.cleaningWhitespace}</span>
                            <span className="card-metadata-value">{cleaning.whitespaceCollapsedCount}</span>
                          </div>
                          <div className="card-metadata-item">
                            <span className="card-metadata-label">{t.cleaningCaseFolded}</span>
                            <span className="card-metadata-value">{cleaning.caseFoldedCount}</span>
                          </div>
                          <div className="card-metadata-item">
                            <span className="card-metadata-label">{t.cleaningExactDuplicates}</span>
                            <span className="card-metadata-value">{cleaning.exactDuplicateRemovedCount}</span>
                          </div>
                          <div className="card-metadata-item">
                            <span className="card-metadata-label">{t.cleaningIdentityConflicts}</span>
                            <span className="card-metadata-value">{cleaning.identityConflictCount}</span>
                          </div>
                          <div className="card-metadata-item">
                            <span className="card-metadata-label">{t.cleaningShortKept}</span>
                            <span className="card-metadata-value">{cleaning.keptShortUniqueCount}</span>
                          </div>
                        </div>
                        {cleaning.languageLabels.length > 0 ? (
                          <div className="card-section">
                            <span className="card-section-title">{t.cleaningLanguages}</span>
                            <div className="card-badges">
                              {cleaning.languageLabels.map((l) => (
                                <span key={l.tag} className="chip chip-muted">
                                  {l.tag}: {l.count}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                  {cache.finalReport ? (
                    <div className="card">
                      <div className="card-header">
                        <h4 className="card-title">{t.limitations}</h4>
                      </div>
                      <div style={{ display: "grid", gap: "6px" }}>
                        {(cache.finalReport as { limitations?: { code: string; message: string }[] }).limitations?.map((l, i) => (
                          <div key={i} style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <ProvenanceBadge kind="limitation" label={l.code} />
                            <span>{l.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
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
                  <TraceabilityPanel report={activeTrace} t={t} />
                </>
              ) : null}
              {tab === "deliverables" ? <FinalDeliverablesPanel finalPrd={prdFinal ?? prdDraft} report={traceFinal ?? traceDraft} manifest={versions.manifest} goalCoverage={cache.goalCoverage} t={t} /> : null}
              {tab === "diagnostics" ? <RunLogPanel events={events} t={t} /> : null}
            </div>
          )}
        </main>
      </div>
        )}
    </div>
  );
}
