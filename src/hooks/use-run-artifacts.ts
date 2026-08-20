"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding, Prd, VersionPlanArtifact } from "@/domain/contracts/analysis";
import type { TraceabilityReport } from "@/domain/traceability/validate";

import type { NormalizedReview } from "@/domain/contracts/review";
import type { RunEvent } from "@/domain/contracts/events";
import { TERMINAL_STATUSES, type RunStatus } from "./use-run-stream";
import { useArtifactVersions } from "./use-artifact-versions";
import type { TabId } from "@/components/workbench/sidebar";

export type SourceEvidence = {
  kind: "app-store-reviews" | "apple-rss" | "import";
  provider?: "serpapi" | "apple-rss" | "socialcrawl";
  selection?: "live" | "stable";
};

export type GoalCoverageArtifact = {
  valid: boolean;
  retried: boolean;
  items: { focusAreaId: string; label: string; status: "covered" | "unsupported" | "uncovered"; findingIds: string[]; requirementIds: string[] }[];
};

export type ArtifactCache = {
  runId: string | null;
  scope?: unknown;
  cleaned?: { reviews: unknown[]; stats?: unknown; cleaning?: unknown };
  stats?: unknown;
  sourceEvidence?: SourceEvidence;
  topicCandidates?: { candidates: { id: string; label: string; description: string; supportingReviewIds: string[]; quote: string }[] };
  topics?: { topics: { id: string; label: string; description: string; reviewIds: string[] }[] };
  findings?: { findings: Finding[] };
  evidenceValidation?: unknown;
  goalCoverage?: GoalCoverageArtifact;
  versionPlan?: VersionPlanArtifact;
  prd?: Prd;
  tests?: { tests: Prd["tests"] };
  traceability?: TraceabilityReport;
  finalReport?: { prd?: Prd; report?: TraceabilityReport; limitations?: unknown[]; goalCoverage?: GoalCoverageArtifact };
};

export const AUTO_ADVANCE_ORDER: { key: keyof ArtifactCache; tab: TabId }[] = [
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

export type UseRunArtifactsOptions = {
  runId: string | null;
  status: RunStatus | null;
  events: RunEvent[];
  running: boolean;
  tab: TabId;
  userNavigatedRef?: { current: boolean };
  onAutoAdvanceTab?: (tab: TabId) => void;
};


export function useRunArtifacts({
  runId,
  status,
  events,
  running,
  tab,
  userNavigatedRef,
  onAutoAdvanceTab,
}: UseRunArtifactsOptions) {
  const [cache, setCache] = useState<ArtifactCache>({ runId: null });
  const autoJumpedKeys = useRef<Set<keyof ArtifactCache>>(new Set());
  const loadedArtifactKeys = useRef<Set<string>>(new Set());
  const seenRunId = useRef<string | null>(null);

  const [prdPhase, setPrdPhase] = useState<"draft" | "final">("draft");
  const [testsPhase, setTestsPhase] = useState<"draft" | "final">("draft");
  const [tracePhase, setTracePhase] = useState<"draft" | "final">("draft");
  const [versionPhase, setVersionPhase] = useState<"draft" | "final">("draft");

  const artifactNameToKey = useMemo(() => {
    const map: Record<string, keyof ArtifactCache> = {
      "scope": "scope",
      "cleaned-reviews": "cleaned",
  "stats": "stats",
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

  const resetArtifacts = () => {
    seenRunId.current = null;
    loadedArtifactKeys.current.clear();
    setCache({ runId: null });
    setPrdPhase("draft");
    setTestsPhase("draft");
    setTracePhase("draft");
    setVersionPhase("draft");
    autoJumpedKeys.current.clear();
  };

  useEffect(() => {
    if (!runId) {
      if (seenRunId.current !== null) {
        resetArtifacts();
      }
      return;
    }
    if (seenRunId.current !== runId) {
      seenRunId.current = runId;
      loadedArtifactKeys.current.clear();
      setCache({ runId });
      setPrdPhase("draft");
      setTestsPhase("draft");
      setTracePhase("draft");
      setVersionPhase("draft");
      autoJumpedKeys.current.clear();
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

  useEffect(() => {
    if (!running) return;
    if (userNavigatedRef?.current) return;
    let jumpedTarget: TabId | null = null;
    for (const { key, tab: target } of AUTO_ADVANCE_ORDER) {
      if (cache[key] !== undefined && !autoJumpedKeys.current.has(key)) {
        autoJumpedKeys.current.add(key);
        jumpedTarget = target;
      }
    }
    if (jumpedTarget && onAutoAdvanceTab) {
      onAutoAdvanceTab(jumpedTarget);
    }
  }, [cache, running, userNavigatedRef, onAutoAdvanceTab]);


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

  const terminal = status !== null && TERMINAL_STATUSES.includes(status);
  const versions = useArtifactVersions(runId, terminal);

  const prdDraft = (terminal ? versions.prd.draft : null) ?? cache.prd ?? null;
  const prdFinal = (terminal ? versions.prd.final : null) ?? cache.finalReport?.prd ?? null;
  const testsDraft = (terminal ? versions.tests.draft?.tests : null) ?? cache.tests?.tests ?? [];
  const testsFinal = (terminal ? versions.tests.final?.tests : null) ?? cache.finalReport?.prd?.tests ?? [];
  const traceDraft = (terminal ? versions.traceability.draft : null) ?? cache.traceability ?? null;
  const traceFinal = (terminal ? versions.traceability.final : null) ?? cache.finalReport?.report ?? null;
  const versionPlanDraft = (terminal ? versions.versionPlan.draft : null) ?? cache.versionPlan ?? null;
  const versionPlanFinal = (terminal ? versions.versionPlan.final : null) ?? null;

  const activePrd = prdPhase === "final" && prdFinal ? prdFinal : prdDraft;
  const activeTests = testsPhase === "final" && testsFinal.length > 0 ? testsFinal : testsDraft;
  const activeTrace = tracePhase === "final" && traceFinal ? traceFinal : traceDraft;
  const activeVersionPlan = versionPhase === "final" && versionPlanFinal ? versionPlanFinal : versionPlanDraft;

  return {
    cache,
    setCache,
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
    testsDraft,
    testsFinal,
    activeTests,
    tracePhase,
    setTracePhase,
    traceDraft,
    traceFinal,
    activeTrace,
    versionPhase,
    setVersionPhase,
    versionPlanDraft,
    versionPlanFinal,
    activeVersionPlan,
    resetArtifacts,
  };
}
