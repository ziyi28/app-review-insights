"use client";

import { type Dictionary, type Locale, translateCode } from "@/i18n";
import type { Finding, Prd } from "@/domain/contracts/analysis";
import type { RunManifest } from "@/server/runs/run-store";
import type { GoalCoverageArtifact } from "@/hooks/use-run-artifacts";
import { ProvenanceBadge, type Provenance } from "./provenance-badge";
import { RatingDistribution, VersionDistribution, LanguageDistribution } from "@/components/artifacts/stats-panels";
import { dedupeLimitations } from "@/lib/limitations";

/** The stats fields the overview renders (the artifact cache carries a subset
 *  of ReviewStats, so the prop is structural). */
type StatsShape = {
  rawCount: number;
  includedCount: number;
  ratingDistribution: Record<number, number>;
  versionDistribution: Record<string, number>;
  languageDistribution: Record<string, number>;
};

type CleaningDetails = {
  unicodeNormalizedCount: number;
  whitespaceCollapsedCount: number;
  caseFoldedCount: number;
  exactDuplicateRemovedCount: number;
  identityConflictCount: number;
  keptShortUniqueCount: number;
  languageLabels: { tag: string; count: number }[];
};

export function OverviewTab({
  manifest,
  stats,
  findings,
  goalCoverage,
  cleaned,
  finalReport,
  activePrd,
  sourceBadge,
  t,
  locale = "zh-CN",
  onSelectTab,
}: {
  manifest: RunManifest | null;
  stats: StatsShape | null | undefined;
  findings: Finding[] | undefined;
  goalCoverage: GoalCoverageArtifact | undefined;
  cleaned: unknown;
  finalReport: unknown;
  activePrd: Prd | null;
  sourceBadge: { kind: Provenance; label: string };
  t: Dictionary;
  locale?: Locale;
  onSelectTab: (tab: "findings") => void;
}) {
  const cleaning = (cleaned as { cleaning?: CleaningDetails } | undefined)?.cleaning;

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {/* App & Goal Banner */}
      {(manifest?.appName || manifest?.appUrl || manifest?.goal) ? (
        <div className="card" style={{ background: "linear-gradient(135deg, var(--bg-panel) 0%, var(--bg-elevated) 100%)", border: "1px solid var(--border)", display: "grid", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>{manifest?.appName || t.appSummary}</span>
                {manifest?.appUrl ? (
                  <a
                    href={manifest.appUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "12px", color: "var(--accent)", textDecoration: "none" }}
                    title={t.openInAppStore}
                  >
                    ↗ App Store
                  </a>
                ) : null}
              </h3>
              {manifest?.goal ? (
                <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  <strong>{t.goal}:</strong> {manifest.goal}
                </p>
              ) : null}
            </div>
            <ProvenanceBadge kind={sourceBadge.kind} label={sourceBadge.label} />
          </div>
        </div>
      ) : null}

      {/* Core Business Metrics */}
      {stats ? (
        <div className="stat-grid">
          {[
            { k: t.rawReviews, v: stats.rawCount },
            { k: t.cleanedData, v: stats.includedCount },
            { k: t.findings, v: findings?.length ?? 0 },
            { k: t.requirementsSpecs, v: (activePrd?.requirements.length ?? 0) },
          ].map((s) => (
            <div key={s.k} className="stat-card">
              <div className="stat-value">{s.v}</div>
              <div className="stat-label">{s.k}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Top Key Findings Highlight */}
      {findings && findings.length > 0 ? (
        <div className="card" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div className="card-header" style={{ marginBottom: "8px" }}>
            <div className="card-title-wrap">
              <h4 className="card-title" style={{ fontSize: "14px", fontWeight: 600 }}>
                {t.topFindings} ({findings.length})
              </h4>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: "12px", padding: "2px 8px" }}
              onClick={() => onSelectTab("findings")}
            >
              {t.findings} →
            </button>
          </div>
          <div style={{ display: "grid", gap: "8px" }}>
            {findings.slice(0, 3).map((f) => (
              <div
                key={f.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: "6px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "13px", color: "var(--text)" }}>{f.title}</strong>
                  <ProvenanceBadge
                    kind="ai-generated"
                    label={`${t.confidence}: ${typeof f.confidence === "object" && f.confidence !== null ? f.confidence.level : f.confidence}`}
                  />
                </div>
                <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  {(f.summary ?? "").length > 120 ? `${f.summary.slice(0, 120)}…` : (f.summary ?? "")}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Distributions */}
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

      {/* Goal Coverage */}
      {goalCoverage ? (
        <div className="card">
          <div className="card-header">
            <div className="card-title-wrap">
              <h4 className="card-title">{t.goalCoverage}</h4>
            </div>
            <ProvenanceBadge
              kind={goalCoverage.valid ? "computed" : "conflict"}
              label={goalCoverage.valid ? t.goalCoverageCovered : t.goalCoverageGap}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginTop: "4px" }}>
            {goalCoverage.items.map((item) => (
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

      {/* Collapsible Data Quality Details */}
      {cleaning ? (
        <details className="card" style={{ cursor: "pointer" }} open>
          <summary style={{ fontWeight: 600, fontSize: "14px", outline: "none" }}>
            {t.dataCleaningDetails}
          </summary>
          <div className="card-metadata-grid" style={{ marginTop: "12px" }}>
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
            <div className="card-section" style={{ marginTop: "10px" }}>
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
        </details>
      ) : null}

      {/* Limitations with translation */}
      {finalReport ? (
        <div className="card">
          <div className="card-header">
            <h4 className="card-title">{t.limitations}</h4>
          </div>
          <div style={{ display: "grid", gap: "6px" }}>
            {dedupeLimitations((finalReport as { limitations?: { code: string; message: string }[] }).limitations ?? []).map((l, i) => (
              <div key={i} style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                <ProvenanceBadge kind="limitation" label={translateCode(l.code, locale)} />
                <span>{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
