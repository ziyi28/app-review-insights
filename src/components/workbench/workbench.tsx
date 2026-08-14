"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary, Locale } from "@/i18n";
import { getDictionary } from "@/i18n";
import type { Finding, Prd } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { useRunStream } from "@/hooks/use-run-stream";
import { useArtifactVersions } from "@/hooks/use-artifact-versions";
import { RunForm } from "./run-form";
import { StageRail } from "./stage-rail";
import { LiveProgress } from "./live-progress";
import { SettingsPanel } from "./settings-panel";
import { HistoryPanel } from "./history-panel";
import { TabList } from "./tab-list";
import { RunLogPanel } from "./run-log-panel";
import { ReviewsTable } from "@/components/artifacts/reviews-table";
import { TopicsPanel, FindingsPanel, RequirementsPanel, TestsPanel, TraceabilityPanel } from "@/components/artifacts/panels";
import { ClassificationPanel, EvidenceValidationPanel, VersionPlanPanel, ArtifactPhaseSelector, FinalDeliverablesPanel } from "@/components/artifacts/workflow-panels";
import { ProvenanceBadge } from "./provenance-badge";
import type { VersionPlanArtifact } from "@/domain/contracts/analysis";
import styles from "./workbench.module.css";

type Tab = "overview" | "raw" | "cleaned" | "classification" | "topics" | "findings" | "evidence" | "versions" | "prd" | "tests" | "traceability" | "deliverables" | "diagnostics";

// Stage order for auto-advancing the tab as artifacts land. When a run is in
// flight and the user has not taken over by clicking a tab, the UI follows the
// newest artifact to its tab so results appear without manual clicks. Only
// applies while a live run is `running` — viewing a completed history run stays
// pinned to Overview.
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

const TABS: { id: Tab; labelKey: keyof Dictionary }[] = [
  { id: "overview", labelKey: "overview" },
  { id: "raw", labelKey: "rawReviews" },
  { id: "cleaned", labelKey: "cleanedData" },
  { id: "classification", labelKey: "classification" },
  { id: "topics", labelKey: "topics" },
  { id: "findings", labelKey: "findings" },
  { id: "evidence", labelKey: "evidenceValidation" },
  { id: "versions", labelKey: "versionPlan" },
  { id: "prd", labelKey: "prd" },
  { id: "tests", labelKey: "testCases" },
  { id: "traceability", labelKey: "traceability" },
  { id: "deliverables", labelKey: "finalDeliverables" },
  { id: "diagnostics", labelKey: "runLog" },
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

  const { events, running, error, droppedEvents, canRetry, start, reset, retry, loadHistory } = useRunStream();
  const [tab, setTab] = useState<Tab>("overview");
  const [cache, setCache] = useState<ArtifactCache>({ runId: null });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>({ modelConfigured: false, serpApiConfigured: false });

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

  const runId = useMemo(() => events.find((e) => e.type === "run.accepted")?.runId ?? null, [events]);

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

  // Poll the run's artifacts until every expected one has loaded OR the run
  // reached a terminal state (which may legitimately lack some artifacts, e.g.
  // insufficient-data or early failure). Polling continues for as long as the
  // run is in flight: a real run took ~25min (topics alone ~17min), so a fixed
  // attempt ceiling must never stop the poller while the run is still healthy.
  // The normal exit is the terminal-event signal below; after termination one
  // final flush tries once more so artifacts published right before the
  // terminal event (e.g. final-report) are still fetched, then the poller stops.
  const loadedArtifacts = useRef<Set<string>>(new Set());
  const seenRunId = useRef<string | null>(null);
  const runTerminatedRef = useRef(false);
  const flushedAfterTerminationRef = useRef(false);
  useEffect(() => {
    if (!runId) return;
    // New run -> fresh cache (never show the previous run's artifacts). The
    // reset happens inside the async loader so it is not a synchronous setState
    // in the effect body.
    loadedArtifacts.current.clear();
    runTerminatedRef.current = false;
    flushedAfterTerminationRef.current = false;
    autoJumpedKeys.current.clear();
    userNavigated.current = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loadOnce = async () => {
      if (cancelled) return;
      if (seenRunId.current !== runId) {
        seenRunId.current = runId;
        setCache({ runId });
        setTab("overview");
      }
      const names = Object.keys(artifactNameToKey);
      const next: Record<string, unknown> = {};
      for (const name of names) {
        if (loadedArtifacts.current.has(name)) continue;
        const key = artifactNameToKey[name];
        try {
          const res = await fetch(`/api/runs/${runId}/artifacts/${name}`, { cache: "no-store" });
          if (!res.ok) continue;
          const value = await res.json();
          next[key] = value;
          loadedArtifacts.current.add(name);
        } catch {
          // retry below
        }
      }
      if (!cancelled) setCache((c) => ({ ...c, runId, ...(next as Partial<ArtifactCache>) }));
      // Keep polling while the run is still in flight. Once it terminates, a
      // final flush runs once more (in case the last artifacts appeared between
      // the previous poll and the terminal event) and then stops — artifacts a
      // terminated run never produced will never appear.
      const terminated = runTerminatedRef.current;
      if (cancelled) return;
      if (loadedArtifacts.current.size >= names.length) return;
      if (terminated) {
        if (flushedAfterTerminationRef.current) return;
        flushedAfterTerminationRef.current = true;
      }
      timer = setTimeout(loadOnce, 800);
    };
    void loadOnce();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, artifactNameToKey]);

  // Flip the terminal flag the moment the run stream reports completion or
  // failure. Read through a ref so the poll loop above observes it without
  // being rebuilt on every streamed event.
  useEffect(() => {
    if (events.some((e) => e.type === "run.completed" || e.type === "run.failed")) {
      runTerminatedRef.current = true;
    }
  }, [events]);

  // Auto-advance the active tab to the newest artifact as it lands, so a live
  // run shows results without manual clicking. Stops the moment the user picks
  // a tab themselves (userNavigated), once a key has already been followed, or
  // once the run is no longer in flight (a completed history view stays pinned
  // to Overview rather than jumping to whichever tab loaded last).
  useEffect(() => {
    if (!running) return;
    if (userNavigated.current) return;
    for (const { key, tab: target } of AUTO_ADVANCE_ORDER) {
      if (cache[key] !== undefined && !autoJumpedKeys.current.has(key)) {
        autoJumpedKeys.current.add(key);
        setTab(target);
        break;
      }
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
          ratingDistribution: Record<string, number>;
        }
      | undefined;
    return s;
  }, [cache.stats, cache.cleaned]);

  // Terminal state: fetch the Draft/Final artifact pairs once the run finishes
  // so revised runs show attempt 1 vs attempt 2 and never a stale draft.
  const terminal = events.some((e) => e.type === "run.completed" || e.type === "run.failed");
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

  const handleRetryHistory = useCallback(async (sourceRunId: string) => {
    setHistoryOpen(false);
    try {
      const res = await fetch(`/api/runs/${sourceRunId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as { startRequest?: { source?: { kind: string; appStoreUrl?: string; previewId?: string; reviewSelection?: string } } };
      if (manifest.startRequest) {
        const req = manifest.startRequest;
        // If retrying a historical live run, strip previewId so it freshly collects from App Store without stale preview snapshot issues
        const cleanRequest = {
          ...req,
          source: req.source?.kind === "live" && req.source.appStoreUrl
            ? { kind: "live", appStoreUrl: req.source.appStoreUrl }
            : req.source,
        };
        seenRunId.current = null;
        setCache({ runId: null });
        setTab("overview");
        autoJumpedKeys.current.clear();
        userNavigated.current = false;
        void start(cleanRequest);
      } else {
        void loadHistory(sourceRunId);
      }
    } catch {
      void loadHistory(sourceRunId);
    }
  }, [start, loadHistory]);

  const idle = !running && events.length === 0;
  const starting = running && runId === null;

  const runFailed = useMemo(() => {
    return !running && (Boolean(error) || events.some((e) => e.type === "run.failed"));
  }, [running, error, events]);

  const runFailedMessage = useMemo(() => {
    if (error) return error;
    const failedEvent = events.find((e) => e.type === "run.failed");
    if (!failedEvent) return null;
    const data = failedEvent.data as { error?: string; outcome?: string } | undefined;
    return data?.error ?? (data?.outcome ? `Outcome: ${data.outcome}` : t.failed);
  }, [error, events, t]);

  const runningStatusText = running ? (starting ? t.starting : t.running) : events.length > 0 ? (terminal ? (runFailed ? t.failed : t.completed) : t.waiting) : t.waiting;

  return (
    <div className={styles.shell}>
      {/* Visually-hidden live region for run status. */}
      <div className="live-region" aria-live="polite">
        {runningStatusText}
      </div>

      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.brand}>{t.appTitle}</h1>
        <div className={styles.headerStatus}>
          <span className={configStatus.modelConfigured ? "chip chip-ok" : "chip chip-muted"} title={t.modelStatus}>
            {t.modelStatus}: {configStatus.modelConfigured ? t.modelConfigured : t.modelNotConfigured}
          </span>
          <span className="chip chip-accent" title={t.collectionStatus}>
            {t.collectionStatus}: {t.collectionConfigured}
          </span>
        </div>
        <span className={styles.spacer} />
        <ProvenanceBadge kind={sourceBadge.kind} label={sourceBadge.label} />
        <button className="btn btn-primary" onClick={handleNewRun} disabled={running}>
          {t.newRun}
        </button>
        <button className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
          {t.history}
        </button>
        <button className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>
          {t.settings}
        </button>
        <select className="field" value={uiLocale} onChange={(e) => setUiLocale(e.target.value as Locale)} aria-label={t.language} style={{ width: "auto", padding: "6px 8px" }}>
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
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
            void loadHistory(runId);
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
          {/* Left: stage rail */}
          <aside className={styles.rail}>
            <StageRail events={events} t={t} />
            {error ? <p className={styles.railError}>{error}</p> : null}
            {running ? <p className={styles.railRunning}>{t.running}</p> : null}
            {!running && droppedEvents > 0 ? <p className={styles.railDropped}>{t.someEventsDropped}</p> : null}
          </aside>

          {/* Right: tabs + content */}
          <main className={styles.content}>
            {runFailed ? (
              <div className="card" style={{ borderLeft: "4px solid var(--danger)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, color: "var(--danger)" }}>
                    <span>✗</span>
                    <span>{t.runFailed}</span>
                  </div>
                  {runFailedMessage ? <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>{runFailedMessage}</p> : null}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  {canRetry ? (
                    <button type="button" className="btn btn-primary" onClick={() => void retry()}>
                      {t.retry}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-secondary" onClick={handleNewRun}>
                    {t.newRun}
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.progressRow}>
              <LiveProgress events={events} running={running} t={t} />
            </div>

            <TabList
              tabs={TABS.map((tabDef) => ({ id: tabDef.id, label: t[tabDef.labelKey] }))}
              active={tab}
              label={t.overview}
              onSelect={(id) => setTab(id as Tab)}
              onUserNavigate={() => {
                userNavigated.current = true;
              }}
            />

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "overview" ? (
                <div style={{ display: "grid", gap: "12px" }}>
                  {stats ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
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
                  {cache.analysisSample ? (
                    <div className="card">
                      <h4 style={{ margin: 0 }}>
                        {t.sampleAnalyzed}: {cache.analysisSample.selectedCount} {t.sampleOf} {cache.analysisSample.eligibleCount}
                      </h4>
                      <p className="muted" style={{ fontSize: "12px", margin: "4px 0 0" }}>
                        {t.sampleStratified} · {cache.analysisSample.strategy}
                      </p>
                    </div>
                  ) : null}
                  {cache.goalCoverage ? (
                    <div className="card">
                      <h4 style={{ margin: 0 }}>
                        {t.goalCoverage} {cache.goalCoverage.valid ? <ProvenanceBadge kind="computed" label={t.goalCoverageCovered} /> : <ProvenanceBadge kind="conflict" label={t.goalCoverageGap} />}
                      </h4>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px", marginTop: "6px" }}>
                        {cache.goalCoverage.items.map((item) => (
                          <div key={item.focusAreaId} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--bg-panel)" }}>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{item.label}</div>
                            <ProvenanceBadge
                              kind={item.status === "covered" ? "computed" : item.status === "uncovered" ? "conflict" : "limitation"}
                              label={item.status === "covered" ? t.goalCoverageCovered : item.status === "uncovered" ? t.goalCoverageUncovered : t.goalCoverageUnsupported}
                            />
                            <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
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
                        <h4 style={{ margin: 0 }}>{t.cleaningUnicode}</h4>
                        <p className="muted" style={{ fontSize: "13px", margin: "4px 0" }}>
                          {cleaning.unicodeNormalizedCount} {t.cleaningUnicode} · {cleaning.whitespaceCollapsedCount} {t.cleaningWhitespace} · {cleaning.caseFoldedCount} {t.cleaningCaseFolded}
                        </p>
                        <p className="muted" style={{ fontSize: "13px", margin: "4px 0" }}>
                          {t.cleaningExactDuplicates}: {cleaning.exactDuplicateRemovedCount} · {t.cleaningIdentityConflicts}: {cleaning.identityConflictCount} · {t.cleaningShortKept}: {cleaning.keptShortUniqueCount}
                        </p>
                        <p className="muted" style={{ fontSize: "12px", margin: "4px 0 0" }}>
                          {t.cleaningLanguages}: {cleaning.languageLabels.map((l) => `${l.tag} ${l.count}`).join(" · ")}
                        </p>
                      </div>
                    );
                  })()}
                  {cache.finalReport ? (
                    <div className="card">
                      <h4 style={{ margin: 0 }}>{t.limitations}</h4>
                      {(cache.finalReport as { limitations?: { code: string; message: string }[] }).limitations?.map((l, i) => (
                        <p key={i} style={{ fontSize: "13px", margin: "4px 0" }}>
                          <ProvenanceBadge kind="limitation" label={l.code} /> {l.message}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {(tab === "raw" || tab === "cleaned") && cleanedReviews.length > 0 ? (
                <ReviewsTable reviews={cleanedReviews} t={t} />
              ) : (tab === "raw" || tab === "cleaned") && !running ? (
                <p className="muted">{t.noData}</p>
              ) : null}

              {tab === "classification" ? <ClassificationPanel candidates={cache.topicCandidates?.candidates ?? []} t={t} /> : null}
              {tab === "topics" ? <TopicsPanel topics={cache.topics?.topics ?? []} t={t} /> : null}
              {tab === "findings" ? <FindingsPanel findings={cache.findings?.findings ?? []} t={t} /> : null}
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
                  <RequirementsPanel requirements={activePrd?.requirements ?? []} versions={activePrd?.versions ?? []} assumptions={activePrd?.assumptions ?? []} t={t} />
                </>
              ) : null}
              {tab === "tests" ? (
                <>
                  <ArtifactPhaseSelector revised={testsFinal.length > 0} phase={testsPhase} onSelect={setTestsPhase} t={t} />
                  <TestsPanel tests={activeTests} requirements={activePrd?.requirements ?? []} t={t} />
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
          </main>
        </div>
      )}
    </div>
  );
}
