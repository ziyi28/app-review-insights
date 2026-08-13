"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary, Locale } from "@/i18n";
import { getDictionary } from "@/i18n";
import type { Finding, Prd } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { useRunStream } from "@/hooks/use-run-stream";
import { useArtifactVersions } from "@/hooks/use-artifact-versions";
import { RunForm } from "./run-form";
import { StageRail } from "./stage-rail";
import { EventDrawer } from "./event-drawer";
import { LiveProgress } from "./live-progress";
import { SettingsPanel } from "./settings-panel";
import { HistoryPanel } from "./history-panel";
import { ReviewsTable } from "@/components/artifacts/reviews-table";
import { TopicsPanel, FindingsPanel, RequirementsPanel, TestsPanel, TraceabilityPanel } from "@/components/artifacts/panels";
import { ClassificationPanel, EvidenceValidationPanel, VersionPlanPanel, RunDiagnosticsPanel, ArtifactPhaseSelector, FinalDeliverablesPanel } from "@/components/artifacts/workflow-panels";
import { ProvenanceBadge } from "./provenance-badge";
import type { VersionPlanArtifact } from "@/domain/contracts/analysis";

type Tab = "overview" | "raw" | "cleaned" | "classification" | "topics" | "findings" | "evidence" | "versions" | "prd" | "tests" | "traceability" | "deliverables";

// Stage order for auto-advancing the tab as artifacts land. When a run is in
// flight and the user has not taken over by clicking a tab, the UI follows the
// newest artifact to its tab so results appear without manual clicks.
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
  versionPlan?: VersionPlanArtifact;
  prd?: Prd;
  tests?: { tests: Prd["tests"] };
  traceability?: { valid: boolean; violations: { code: string; message: string }[] };
  finalReport?: { prd?: Prd; report?: { valid: boolean; violations: { code: string; message: string }[] }; limitations?: unknown[] };
};

export function Workbench() {
  const [uiLocale, setUiLocale] = useState<Locale>("en");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = getDictionary(uiLocale);

  // Keep the document language in sync with the UI locale so assistive
  // technology and translation tooling use the right language.
  useEffect(() => {
    document.documentElement.lang = uiLocale === "zh-CN" ? "zh-CN" : "en";
  }, [uiLocale]);
  const { events, running, error, droppedEvents, start, reset, loadHistory } = useRunStream();
  const [tab, setTab] = useState<Tab>("overview");
  const [cache, setCache] = useState<ArtifactCache>({ runId: null });
  const [historyOpen, setHistoryOpen] = useState(false);

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
  // a tab themselves (userNavigated) or once a key has already been followed.
  useEffect(() => {
    if (userNavigated.current) return;
    for (const { key, tab: target } of AUTO_ADVANCE_ORDER) {
      if (cache[key] !== undefined && !autoJumpedKeys.current.has(key)) {
        autoJumpedKeys.current.add(key);
        setTab(target);
        break;
      }
    }
  }, [cache]);

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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gridTemplateRows: "auto 1fr auto", minHeight: "100vh" }}>
      {/* Header */}
      <header style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: "18px" }}>{t.appTitle}</h1>
        <span style={{ flex: 1 }} />
        <ProvenanceBadge kind={sourceBadge.kind} label={sourceBadge.label} />
        <button onClick={handleNewRun}>{t.newRun}</button>
        <button onClick={() => setHistoryOpen(true)}>{t.history}</button>
        <button onClick={() => setSettingsOpen(true)}>{t.settings}</button>
        <select value={uiLocale} onChange={(e) => setUiLocale(e.target.value as Locale)} aria-label={t.language}>
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
        <SettingsPanel t={t} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
        />
      </header>

      {/* Left: stage rail */}
      <aside style={{ borderRight: "1px solid var(--border)", padding: "12px", overflowY: "auto" }}>
        <StageRail events={events} t={t} />
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        {running ? <p style={{ color: "var(--accent)" }}>{t.running}</p> : null}
        {!running && droppedEvents > 0 ? <p style={{ color: "var(--warn)", fontSize: "12px" }}>{t.someEventsDropped}</p> : null}
      </aside>

      {/* Right: tabs + content */}
      <main style={{ padding: "16px", overflowY: "auto" }}>
        {!running && events.length === 0 ? (
          <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px", border: "1px solid var(--border)", borderRadius: "12px", background: "var(--bg-panel)" }}>
            <RunForm t={t} onStart={start} />
            <p style={{ color: "var(--text-muted)", marginTop: "12px" }}>{t.waiting}</p>
          </div>
        ) : runId === null ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg-panel)", fontSize: "13px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0, animation: "pulse 1.2s ease-in-out infinite" }} />
            <span>{t.starting}</span>
          </div>
        ) : (
          <>
            <LiveProgress events={events} running={running} t={t} />

            <nav style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "12px" }}>
              {TABS.map((tabDef) => (
                <button
                  key={tabDef.id}
                  onClick={() => {
                    userNavigated.current = true;
                    setTab(tabDef.id);
                  }}
                  style={{ padding: "6px 12px", borderRadius: "6px", border: tab === tabDef.id ? "1px solid var(--accent)" : "1px solid var(--border)", background: tab === tabDef.id ? "var(--bg-elevated)" : "transparent" }}
                >
                  {t[tabDef.labelKey]}
                </button>
              ))}
            </nav>

            <div>
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
                        <div key={s.k} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
                          <div style={{ fontSize: "20px", fontWeight: 700 }}>{s.v}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{s.k}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {cache.analysisSample ? (
                    <div style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
                      <h4>
                        {t.sampleAnalyzed}: {cache.analysisSample.selectedCount} {t.sampleOf} {cache.analysisSample.eligibleCount}
                      </h4>
                      <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0" }}>
                        {t.sampleStratified} · {cache.analysisSample.strategy}
                      </p>
                    </div>
                  ) : null}
                  {(() => {
                    const cleaning = (cache.cleaned as { cleaning?: { unicodeNormalizedCount: number; whitespaceCollapsedCount: number; caseFoldedCount: number; exactDuplicateRemovedCount: number; identityConflictCount: number; keptShortUniqueCount: number; languageLabels: { tag: string; count: number }[] } } | undefined)?.cleaning;
                    if (!cleaning) return null;
                    return (
                      <div style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
                        <h4>{t.cleaningUnicode}</h4>
                        <p style={{ fontSize: "13px", margin: "4px 0", color: "var(--text-muted)" }}>
                          {cleaning.unicodeNormalizedCount} {t.cleaningUnicode} · {cleaning.whitespaceCollapsedCount} {t.cleaningWhitespace} · {cleaning.caseFoldedCount} {t.cleaningCaseFolded}
                        </p>
                        <p style={{ fontSize: "13px", margin: "4px 0", color: "var(--text-muted)" }}>
                          {t.cleaningExactDuplicates}: {cleaning.exactDuplicateRemovedCount} · {t.cleaningIdentityConflicts}: {cleaning.identityConflictCount} · {t.cleaningShortKept}: {cleaning.keptShortUniqueCount}
                        </p>
                        <p style={{ fontSize: "12px", margin: "4px 0", color: "var(--text-muted)" }}>
                          {t.cleaningLanguages}: {cleaning.languageLabels.map((l) => `${l.tag} ${l.count}`).join(" · ")}
                        </p>
                      </div>
                    );
                  })()}
                  {cache.finalReport ? (
                    <div style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
                      <h4>{t.limitations}</h4>
                      {(cache.finalReport as { limitations?: { code: string; message: string }[] }).limitations?.map((l, i) => (
                        <p key={i} style={{ fontSize: "13px", margin: "4px 0" }}>
                          <ProvenanceBadge kind="limitation" label={l.code} /> {l.message}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <RunDiagnosticsPanel events={events} t={t} />
                </div>
              ) : null}

              {(tab === "raw" || tab === "cleaned") && cleanedReviews.length > 0 ? (
                <ReviewsTable reviews={cleanedReviews} t={t} />
              ) : (tab === "raw" || tab === "cleaned") && !running ? (
                <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>
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
              {tab === "deliverables" ? <FinalDeliverablesPanel finalPrd={prdFinal ?? prdDraft} report={traceFinal ?? traceDraft} manifest={versions.manifest} t={t} /> : null}
            </div>
          </>
        )}
      </main>

      {/* Footer: event drawer */}
      <footer style={{ gridColumn: "1 / -1" }}>
        <EventDrawer events={events} t={t} />
      </footer>
    </div>
  );
}
