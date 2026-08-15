"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n";
import type { Finding, Prd, VersionPlanArtifact } from "@/domain/contracts/analysis";
import type { RunManifest } from "@/server/runs/run-store";
import { Icon } from "@/components/ui/icons";
import { ProvenanceBadge } from "@/components/workbench/provenance-badge";
import { RatingDistribution } from "@/components/artifacts/stats-panels";
import styles from "./executive-report.module.css";

export interface GoalCoverageSummary {
  valid: boolean;
  retried: boolean;
  items: { focusAreaId: string; label: string; status: "covered" | "unsupported" | "uncovered"; findingIds: string[]; requirementIds: string[] }[];
}

export interface ExecutiveReportProps {
  manifest: RunManifest | null;
  findings: Finding[];
  versionPlan: VersionPlanArtifact | null;
  prd: Prd | null;
  stats?: {
    rawCount?: number;
    includedCount?: number;
    ratingDistribution?: Record<string, number>;
  };
  goalCoverage?: GoalCoverageSummary | null;
  t: Dictionary;
  onJumpToReview?: (reviewId: string) => void;
  onSwitchToWorkbench?: () => void;
}

function buildMarkdownReport(props: ExecutiveReportProps): string {
  const { manifest, findings, versionPlan, prd, t } = props;
  const lines: string[] = [];

  lines.push(`# ${manifest?.goal ? `${manifest.goal} — ` : ""}${t.appTitle} ${t.viewModeReport}`);
  lines.push("");
  if (manifest?.appUrl) lines.push(`- **App**: ${manifest.appUrl}`);
  if (manifest?.goal) lines.push(`- **${t.goal}**: ${manifest.goal}`);
  if (manifest?.createdAt) lines.push(`- **Date**: ${new Date(manifest.createdAt).toLocaleString()}`);
  lines.push("");

  // Findings
  lines.push(`## 1. ${t.keyFindings}`);
  lines.push("");
  if (findings.length === 0) {
    lines.push(`_${t.noData}_`);
  } else {
    findings.forEach((f, i) => {
      lines.push(`### 1.${i + 1} ${f.title}`);
      lines.push(`- **${t.confidenceLevel}**: ${f.confidence.level} · **${t.supportCount}**: ${f.supportingSampleCount}`);
      lines.push(`- **${t.overview}**: ${f.summary}`);
      if (f.evidenceExcerpts.length > 0) {
        lines.push(`- **${t.userQuote}**:`);
        f.evidenceExcerpts.slice(0, 3).forEach((e) => {
          lines.push(`  > "${e.excerpt}" (${e.reviewId.slice(0, 8)})`);
        });
      }
      lines.push("");
    });
  }

  // Version Roadmap
  lines.push(`## 2. ${t.roadmapMilestones}`);
  lines.push("");
  if (!versionPlan || !Array.isArray(versionPlan.versions) || versionPlan.versions.length === 0) {
    lines.push(`_${t.noData}_`);
  } else {
    versionPlan.versions.forEach((v) => {
      lines.push(`### ${v.name}: ${v.summary}`);
      if (v.rationale) lines.push(`- **${t.versionRationale}**: ${v.rationale}`);
      lines.push(`- **${t.requirementId}**: ${(v.requirementIds ?? []).join(", ")}`);
      lines.push("");
    });
  }

  // PRD Requirements
  lines.push(`## 3. ${t.requirementsSpecs}`);
  lines.push("");
  if (!prd || !Array.isArray(prd.requirements) || prd.requirements.length === 0) {
    lines.push(`_${t.noData}_`);
  } else {
    prd.requirements.forEach((r) => {
      lines.push(`### [${r.priority}] ${r.title} (${r.id})`);
      lines.push(`${r.description}`);
      lines.push("");
      lines.push(`**${t.acceptanceCriteria}**:`);
      (r.acceptanceCriteria ?? []).forEach((ac) => {
        lines.push(`- [ ] ${ac}`);
      });
      lines.push("");
    });
  }

  // Test Verification
  lines.push(`## 4. ${t.verificationPlan}`);
  lines.push("");
  if (!prd || !Array.isArray(prd.tests) || prd.tests.length === 0) {
    lines.push(`_${t.noData}_`);
  } else {
    prd.tests.forEach((test) => {
      lines.push(`### ${test.id} [${test.priority ?? "P2"}]`);
      if (test.precondition) lines.push(`- **${t.precondition}**: ${test.precondition}`);
      lines.push(`- **${t.stageTests}**:`);
      (test.steps ?? []).forEach((step, idx) => {
        lines.push(`  ${idx + 1}. ${step}`);
      });
      lines.push(`- **${t.expected}**: ${test.expectedResult}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}

export function ExecutiveReport(props: ExecutiveReportProps) {
  const { manifest, findings, versionPlan, prd, stats, goalCoverage, t, onJumpToReview, onSwitchToWorkbench } = props;
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = async () => {
    try {
      const md = buildMarkdownReport(props);
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className={styles.container}>
      {/* Top Header Card */}
      <header className={styles.reportHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.reportTitle}>
            {manifest?.goal || t.viewModeReport}
          </h2>
          <div className={styles.reportMeta}>
            {manifest?.appUrl ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <Icon name="externalLink" size={12} />
                <span>{manifest.appUrl}</span>
              </span>
            ) : null}
            {stats?.includedCount ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <Icon name="data" size={12} />
                <span>{stats.includedCount} {t.cleanedData}</span>
              </span>
            ) : null}
            {goalCoverage ? (
              <ProvenanceBadge
                kind={goalCoverage.valid ? "computed" : "conflict"}
                label={goalCoverage.valid ? t.goalCoverageCovered : t.goalCoverageGap}
              />
            ) : null}
          </div>
        </div>

        <div className={styles.actions}>
          {onSwitchToWorkbench ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onSwitchToWorkbench}
              title={t.viewModeWorkbench}
            >
              <Icon name="overview" size={13} />
              <span>{t.viewModeWorkbench}</span>
            </button>
          ) : null}
          {copied ? <span className={styles.toast}>✓ {t.copied}</span> : null}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCopyMarkdown}
            title={t.copyMarkdownReport}
          >
            <Icon name="copy" size={13} />
            <span>{t.copyMarkdownReport}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handlePrint}
            title={t.printReport}
          >
            <Icon name="printer" size={13} />
            <span>{t.printReport}</span>
          </button>
        </div>
      </header>

      {/* Table of Contents Quick Nav */}
      <nav className={styles.tocBar} aria-label="Report Table of Contents">
        <span style={{ color: "var(--text-faint)", fontSize: "12px" }}>目录:</span>
        {stats?.ratingDistribution ? (
          <button type="button" className={styles.tocItem} onClick={() => scrollToSection("report-ratings")}>
            {t.ratingDistribution}
          </button>
        ) : null}
        <button type="button" className={styles.tocItem} onClick={() => scrollToSection("report-findings")}>
          {t.keyFindings} ({findings.length})
        </button>
        {versionPlan?.versions && versionPlan.versions.length > 0 ? (
          <button type="button" className={styles.tocItem} onClick={() => scrollToSection("report-versions")}>
            {t.roadmapMilestones}
          </button>
        ) : null}
        {prd?.requirements && prd.requirements.length > 0 ? (
          <button type="button" className={styles.tocItem} onClick={() => scrollToSection("report-prd")}>
            {t.requirementsSpecs} ({prd.requirements.length})
          </button>
        ) : null}
        {prd?.tests && prd.tests.length > 0 ? (
          <button type="button" className={styles.tocItem} onClick={() => scrollToSection("report-tests")}>
            {t.verificationPlan} ({prd.tests.length})
          </button>
        ) : null}
      </nav>

      {/* Stats Summary if present */}
      {stats?.ratingDistribution ? (
        <section id="report-ratings" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              <Icon name="table" size={16} />
              <span>{t.ratingDistribution}</span>
            </h3>
          </div>
          <RatingDistribution distribution={stats.ratingDistribution} t={t} />
        </section>
      ) : null}

      {/* 1. Key Findings */}
      <section id="report-findings" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <Icon name="findings" size={16} />
            <span>{t.keyFindings} ({findings.length})</span>
          </h3>
        </div>
        {findings.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>{t.noData}</p>
        ) : (
          <div className={styles.gridCards}>
            {findings.map((f) => (
              <div key={f.id} className={styles.findingCard}>
                <div className={styles.findingHead}>
                  <h4 className={styles.findingTitle}>{f.title}</h4>
                  <ProvenanceBadge kind="computed" label={`${t.confidenceLevel}: ${f.confidence.level}`} />
                  {f.evidenceSufficiency ? (
                    <ProvenanceBadge
                      kind={f.evidenceSufficiency.status === "sufficient" ? "computed" : "conflict"}
                      label={f.evidenceSufficiency.status === "sufficient" ? t.evidenceSufficient : t.evidenceInsufficient}
                    />
                  ) : null}
                </div>
                <p className={styles.findingSummary}>{f.summary}</p>
                <div style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "6px", display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }}>
                  <span>{t.supportCount}: <strong>{f.supportingSampleCount}</strong> · {t.reviewId}:</span>
                  {f.supportingReviewIds.slice(0, 6).map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      <code
                        onClick={() => onJumpToReview?.(id)}
                        title={onJumpToReview ? `跳转到评论 ${id}` : undefined}
                        style={{
                          color: onJumpToReview ? "var(--accent)" : "inherit",
                          cursor: onJumpToReview ? "pointer" : "default",
                          textDecoration: onJumpToReview ? "underline" : "none",
                        }}
                      >
                        {id.length > 8 ? id.slice(0, 8) : id}
                      </code>
                    </span>
                  ))}
                </div>

                {f.evidenceExcerpts.length > 0 ? (
                  <div style={{ display: "grid", gap: "6px", marginTop: "8px" }}>
                    {f.evidenceExcerpts.slice(0, 3).map((e, idx) => (
                      <div key={idx} className="quote-box">
                        “{e.excerpt}”
                        <div className="quote-meta">
                          <span>
                            {t.reviewId}:{" "}
                            <code
                              onClick={() => onJumpToReview?.(e.reviewId)}
                              title={onJumpToReview ? `跳转到评论 ${e.reviewId}` : undefined}
                              style={{
                                color: onJumpToReview ? "var(--accent)" : "inherit",
                                cursor: onJumpToReview ? "pointer" : "default",
                                textDecoration: onJumpToReview ? "underline" : "none",
                              }}
                            >
                              {e.reviewId.slice(0, 8)}
                            </code>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Version Roadmap */}
      {versionPlan?.versions && versionPlan.versions.length > 0 ? (
        <section id="report-versions" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              <Icon name="versions" size={16} />
              <span>{t.roadmapMilestones}</span>
            </h3>
          </div>
          <div className={styles.gridCards}>
            {versionPlan.versions.map((v) => (
              <div key={v.id} className="card card-elevated">
                <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 600 }}>{v.name} — {v.summary}</h4>
                {v.rationale ? (
                  <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--text-muted)" }}>
                    <strong>{t.versionRationale}:</strong> {v.rationale}
                  </p>
                ) : null}
                <div style={{ fontSize: "12px", color: "var(--text-faint)" }}>
                  {t.requirementId}: {(v.requirementIds ?? []).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 3. PRD Requirements */}
      {prd?.requirements && prd.requirements.length > 0 ? (
        <section id="report-prd" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              <Icon name="prd" size={16} />
              <span>{t.requirementsSpecs} ({prd.requirements.length})</span>
            </h3>
          </div>
          <div className={styles.gridCards}>
            {prd.requirements.map((r) => {
              const pClass = r.priority === "P0" ? styles.reqCardP0 : r.priority === "P1" ? styles.reqCardP1 : styles.reqCardP2;
              return (
                <div key={r.id} className={`${styles.reqCard} ${pClass}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{r.title}</h4>
                    <ProvenanceBadge kind="computed" label={r.priority} />
                    <code style={{ fontSize: "12px", color: "var(--text-muted)" }}>{r.id}</code>
                  </div>
                  <p style={{ margin: "4px 0", fontSize: "13px" }}>{r.description}</p>
                  {(r.acceptanceCriteria ?? []).length > 0 ? (
                    <div>
                      <strong style={{ fontSize: "12px", color: "var(--text-muted)" }}>{t.acceptanceCriteria}:</strong>
                      <ul className={styles.criteriaList}>
                        {(r.acceptanceCriteria ?? []).map((ac, idx) => (
                          <li key={idx}>{ac}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 4. Test Verification Plan */}
      {prd?.tests && prd.tests.length > 0 ? (
        <section id="report-tests" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              <Icon name="tests" size={16} />
              <span>{t.verificationPlan} ({prd.tests.length})</span>
            </h3>
          </div>
          <div className={styles.gridCards}>
            {prd.tests.map((test) => (
              <div key={test.id} className={styles.testCard}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 600 }}>{test.id}</h4>
                  <ProvenanceBadge kind="computed" label={test.priority ?? "P2"} />
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                  {t.requirementId}: {(test.requirementIds ?? []).join(", ")}
                </div>
                {test.precondition ? (
                  <div style={{ fontSize: "13px", marginTop: "4px" }}>
                    <strong>{t.precondition}:</strong> {test.precondition}
                  </div>
                ) : null}
                <ol className={styles.stepList}>
                  {(test.steps ?? []).map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ol>
                <div style={{ fontSize: "13px", color: "var(--ok)" }}>
                  <strong>{t.expected}:</strong> {test.expectedResult}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
