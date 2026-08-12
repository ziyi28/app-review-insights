"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary, Locale } from "@/i18n";
import { getDictionary } from "@/i18n";
import type { Finding, Prd } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { useRunStream } from "@/hooks/use-run-stream";
import { RunForm } from "./run-form";
import { StageRail } from "./stage-rail";
import { EventDrawer } from "./event-drawer";
import { SettingsPanel } from "./settings-panel";
import { ReviewsTable } from "@/components/artifacts/reviews-table";
import { TopicsPanel, FindingsPanel, RequirementsPanel, TestsPanel, TraceabilityPanel } from "@/components/artifacts/panels";
import { ProvenanceBadge } from "./provenance-badge";

type Tab = "overview" | "raw" | "cleaned" | "topics" | "findings" | "plan" | "tests" | "traceability";

const TABS: { id: Tab; labelKey: keyof Dictionary }[] = [
  { id: "overview", labelKey: "overview" },
  { id: "raw", labelKey: "rawReviews" },
  { id: "cleaned", labelKey: "cleanedData" },
  { id: "topics", labelKey: "topics" },
  { id: "findings", labelKey: "findings" },
  { id: "plan", labelKey: "prd" },
  { id: "tests", labelKey: "testCases" },
  { id: "traceability", labelKey: "traceability" },
];

type ArtifactCache = {
  runId: string | null;
  scope?: unknown;
  cleaned?: { reviews: unknown[] };
  topics?: { topics: { id: string; label: string; description: string; reviewIds: string[] }[] };
  findings?: { findings: Finding[] };
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
  const { events, running, error, start, reset } = useRunStream();
  const [tab, setTab] = useState<Tab>("overview");
  const [cache, setCache] = useState<ArtifactCache>({ runId: null });

  const runId = useMemo(() => events.find((e) => e.type === "run.accepted")?.runId ?? null, [events]);

  // Source provenance: prefer the structured event data (limitation codes)
  // over the deliveryMode fallback, so Imported / Partial / Suspect Empty are
  // never mislabeled as Live.
  const sourceBadge = useMemo(() => {
    const last = events.at(-1);
    if (last?.deliveryMode === "cached-replay") return { kind: "limitation" as const, label: t.cachedReplay };
    const texts = events.map((e) => JSON.stringify(e.data ?? {}));
    if (texts.some((s) => s.includes("RSS_SUSPECT_EMPTY"))) return { kind: "conflict" as const, label: t.sourceSuspectEmpty };
    if (texts.some((s) => s.includes("IMPORT_ERROR") || s.includes("RSS_PARTIAL"))) return { kind: "conflict" as const, label: t.sourcePartial };
    // If a limitation.reported carries no import/partial marker but the run
    // used an import source, the limitation code list distinguishes it.
    if (texts.some((s) => s.includes('"kind":"import"') || s.includes("IMPORT_") || s.includes("import:"))) {
      return { kind: "source" as const, label: t.sourceImported };
    }
    return { kind: "source" as const, label: t.sourceLive };
  }, [events, t]);

  // Load artifacts as they become available via the event stream.
  const artifactNameToKey = useMemo(() => {
    const map: Record<string, keyof ArtifactCache> = {
      "scope": "scope",
      "cleaned-reviews": "cleaned",
      "topics": "topics",
      "findings": "findings",
      "prd": "prd",
      "tests": "tests",
      "traceability": "traceability",
      "final-report": "finalReport",
    };
    return map;
  }, []);

  // Poll the run's artifacts until every expected one has loaded OR the run
  // reached a terminal state (which may legitimately lack some artifacts, e.g.
  // insufficient-data or early failure). The poll also stops after a bounded
  // number of attempts so a broken run cannot trigger an infinite 404 loop.
  const loadedArtifacts = useRef<Set<string>>(new Set());
  const seenRunId = useRef<string | null>(null);
  useEffect(() => {
    if (!runId) return;
    // New run -> fresh cache (never show the previous run's artifacts). The
    // reset happens inside the async loader so it is not a synchronous setState
    // in the effect body.
    loadedArtifacts.current.clear();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // ~48s of 800ms polls, then give up

    const loadOnce = async () => {
      if (cancelled) return;
      if (seenRunId.current !== runId) {
        seenRunId.current = runId;
        setCache({ runId });
        setTab("overview");
      }
      attempts += 1;
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
      // Keep polling until every artifact is loaded OR we hit the attempt
      // ceiling. A run that legitimately lacks some artifacts (insufficient
      // data, early failure) will exhaust MAX_ATTEMPTS and stop; a completed
      // run loads everything it produced.
      if (!cancelled && loadedArtifacts.current.size < names.length && attempts < MAX_ATTEMPTS) {
        timer = setTimeout(loadOnce, 800);
      }
    };
    void loadOnce();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, artifactNameToKey]);

  const cleanedReviews = useMemo(() => {
    const prepared = cache.cleaned as { reviews?: NormalizedReview[] } | undefined;
    if (!prepared?.reviews) return [] as NormalizedReview[];
    const all = prepared.reviews;
    const included = all.filter((r) => r.includedInAnalysis);
    if (tab === "raw") return all;
    return included;
  }, [cache.cleaned, tab]);

  const stats = useMemo(() => {
    const s = (cache.cleaned as { stats?: unknown } | undefined)?.stats as
      | {
          rawCount: number;
          includedCount: number;
          duplicateCount: number;
          identityConflictCount: number;
          ratingDistribution: Record<string, number>;
        }
      | undefined;
    return s;
  }, [cache.cleaned]);

  // Authoritative panels: prefer the final report when present (it holds the
  // post-revision PRD/report), else the intermediate artifacts.
  const planPrd = cache.finalReport?.prd ?? cache.prd;
  const traceReport = cache.finalReport?.report ?? cache.traceability ?? null;
  const testCases = cache.tests?.tests ?? cache.finalReport?.prd?.tests ?? [];

  const handleNewRun = () => {
    reset();
    seenRunId.current = null;
    setCache({ runId: null });
    setTab("overview");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gridTemplateRows: "auto 1fr auto", minHeight: "100vh" }}>
      {/* Header */}
      <header style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: "18px" }}>{t.appTitle}</h1>
        <span style={{ flex: 1 }} />
        <ProvenanceBadge kind={sourceBadge.kind} label={sourceBadge.label} />
        <button onClick={handleNewRun}>{t.newRun}</button>
        <button onClick={() => setSettingsOpen(true)}>{t.settings}</button>
        <select value={uiLocale} onChange={(e) => setUiLocale(e.target.value as Locale)} aria-label={t.language}>
          <option value="en">English</option>
          <option value="zh-CN">中文</option>
        </select>
        <SettingsPanel t={t} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </header>

      {/* Left: stage rail */}
      <aside style={{ borderRight: "1px solid var(--border)", padding: "12px", overflowY: "auto" }}>
        <StageRail events={events} t={t} />
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        {running ? <p style={{ color: "var(--accent)" }}>{t.running}</p> : null}
      </aside>

      {/* Right: tabs + content */}
      <main style={{ padding: "16px", overflowY: "auto" }}>
        {events.length === 0 ? (
          <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px", border: "1px solid var(--border)", borderRadius: "12px", background: "var(--bg-panel)" }}>
            <RunForm t={t} onStart={start} />
            <p style={{ color: "var(--text-muted)", marginTop: "12px" }}>{t.waiting}</p>
          </div>
        ) : (
          <>
            <nav style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "12px" }}>
              {TABS.map((tabDef) => (
                <button
                  key={tabDef.id}
                  onClick={() => setTab(tabDef.id)}
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
                </div>
              ) : null}

              {(tab === "raw" || tab === "cleaned") && cleanedReviews.length > 0 ? (
                <ReviewsTable reviews={cleanedReviews} t={t} />
              ) : (tab === "raw" || tab === "cleaned") && !running ? (
                <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>
              ) : null}

              {tab === "topics" ? <TopicsPanel topics={cache.topics?.topics ?? []} t={t} /> : null}
              {tab === "findings" ? <FindingsPanel findings={cache.findings?.findings ?? []} t={t} /> : null}
              {tab === "plan" ? <RequirementsPanel requirements={planPrd?.requirements ?? []} versions={planPrd?.versions ?? []} assumptions={planPrd?.assumptions ?? []} t={t} /> : null}
              {tab === "tests" ? <TestsPanel tests={testCases} t={t} /> : null}
              {tab === "traceability" ? <TraceabilityPanel report={traceReport} t={t} /> : null}
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
