"use client";

import { useEffect, useState } from "react";
import type { Prd, VersionPlanArtifact } from "@/domain/contracts/analysis";
import type { TraceabilityReport } from "@/domain/traceability/validate";
import type { RunManifest } from "@/server/runs/run-store";

export type ArtifactPair<T> = { draft: T | null; final: T | null; revised: boolean };

export type ArtifactVersionState = {
  manifest: RunManifest | null;
  prd: ArtifactPair<Prd>;
  tests: ArtifactPair<{ tests: Prd["tests"]; prd?: Prd }>;
  traceability: ArtifactPair<TraceabilityReport>;
  versionPlan: ArtifactPair<VersionPlanArtifact>;
  loading: boolean;
  error: string | null;
};

const PAIRS: (keyof ArtifactVersionState & ("prd" | "tests" | "traceability" | "versionPlan"))[] = [
  "prd",
  "tests",
  "traceability",
  "versionPlan",
];

const EMPTY_STATE: ArtifactVersionState = {
  manifest: null,
  prd: { draft: null, final: null, revised: false },
  tests: { draft: null, final: null, revised: false },
  traceability: { draft: null, final: null, revised: false },
  versionPlan: { draft: null, final: null, revised: false },
  loading: false,
  error: null,
};

/**
 * Loads a completed run's Draft/Final artifact pair (attempt 1 vs the manifest's
 * latest attempt) only once the run is terminal. A run that was never revised
 * has latest === 1, so `revised` is false and the final is null (the draft
 * IS the final). Missing artifacts resolve to null without failing the hook;
 * only a manifest fetch failure writes `error`.
 */
export function useArtifactVersions(runId: string | null, terminal: boolean): ArtifactVersionState {
  const [state, setState] = useState<ArtifactVersionState>(EMPTY_STATE);

  useEffect(() => {
    if (!runId || !terminal) {
      setState(EMPTY_STATE);
      return;
    }
    const controller = new AbortController();
    let stale = false;
    const runAtLoad = runId;

    setState({ ...EMPTY_STATE, loading: true });


    void (async () => {
      try {
        const manifestRes = await fetch(`/api/runs/${runAtLoad}`, { cache: "no-store", signal: controller.signal });
        if (!manifestRes.ok) throw new Error(`manifest HTTP ${manifestRes.status}`);
        const manifest = (await manifestRes.json()) as RunManifest;
        if (stale || controller.signal.aborted) return;
        const latest: Record<(typeof PAIRS)[number], number> = {
          prd: manifest.artifacts.prd?.attempt ?? 1,
          tests: manifest.artifacts.tests?.attempt ?? 1,
          traceability: manifest.artifacts.traceability?.attempt ?? 1,
          versionPlan: manifest.artifacts["version-plan"]?.attempt ?? 1,
        };

        const pairs: Partial<ArtifactVersionState> = {};
        for (const key of PAIRS) {
          const artifactName = key === "versionPlan" ? "version-plan" : key;
          const latestAttempt = latest[key];
          if (latestAttempt < 1) {
            pairs[key] = { draft: null, final: null, revised: false };
            continue;
          }
          const draft = await fetchArtifact(runAtLoad, artifactName, 1, controller.signal);
          if (stale || controller.signal.aborted) return;
          let final: unknown = null;
          if (latestAttempt > 1) {
            final = await fetchArtifact(runAtLoad, artifactName, latestAttempt, controller.signal);
            if (stale || controller.signal.aborted) return;
          }
          pairs[key] = { draft, final, revised: latestAttempt > 1 } as ArtifactPair<never>;
        }

        if (!stale) {
          setState((s) => ({
            ...s,
            manifest,
            ...(pairs as Partial<ArtifactVersionState>),
            loading: false,
          }));
        }
      } catch (err) {
        if (controller.signal.aborted || stale) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
      }
    })();

    return () => {
      stale = true;
      controller.abort();
    };
  }, [runId, terminal]);

  return state;
}

async function fetchArtifact(runId: string, artifactName: string, attempt: number, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`/api/runs/${runId}/artifacts/${artifactName}?attempt=${attempt}`, { cache: "no-store", signal });
  if (!res.ok) return null; // missing artifact -> null, not a hook failure
  return res.json();
}
