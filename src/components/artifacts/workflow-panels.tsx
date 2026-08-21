"use client";

import { type Dictionary, type Locale, translateCode } from "@/i18n";
import { translateLimitationMessage } from "@/i18n/limitation-messages";
import type { Prd, VersionPlanArtifact, PlanningFactors } from "@/domain/contracts/analysis";
import { deriveClosureStatus, type TraceabilityReport } from "@/domain/traceability/validate";
import type { RunManifest } from "@/server/runs/run-store";
import type { EvidenceValidationReport } from "@/domain/analysis/evidence-validation";
import type { RunEvent } from "@/domain/contracts/events";
import { dedupeLimitations } from "@/lib/limitations";
import { ProvenanceBadge } from "@/components/workbench/provenance-badge";

type TopicCandidate = { id: string; label: string; description: string; supportingReviewIds: string[]; quote: string };

export function ClassificationPanel({
  candidates,
  t,
  onJumpToReview,
}: {
  candidates: TopicCandidate[];
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
}) {
  if (!candidates.length) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {candidates.map((c) => (
        <div key={c.id} className="card" style={{ padding: "14px 16px" }}>
          <div className="card-header" style={{ marginBottom: "4px" }}>
            <div className="card-title-wrap">
              <h4 className="card-title">{c.label}</h4>
              <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
            </div>
            <code style={{ fontSize: "12px", color: "var(--text-muted)" }}>{c.id}</code>
          </div>
          <p className="card-desc" style={{ margin: "4px 0 8px" }}>“{c.quote}”</p>
          <div style={{ color: "var(--text-muted)", fontSize: "12px", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <span>{t.reviewId}:</span>
            {c.supportingReviewIds.map((id, i) => (
              <span key={`${id}-${i}`}>
                {i > 0 ? ", " : ""}
                <code
                  onClick={() => onJumpToReview?.(id)}
                  role={onJumpToReview ? "button" : undefined}
                  tabIndex={onJumpToReview ? 0 : undefined}
                  onKeyDown={
                    onJumpToReview
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onJumpToReview(id);
                          }
                        }
                      : undefined
                  }
                  title={onJumpToReview ? `${t.jumpToReview} ${id}` : undefined}
                  className="code-badge"
                >
                  {id.length > 8 ? id.slice(0, 8) : id}
                </code>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EvidenceValidationPanel({ report, t }: { report: EvidenceValidationReport | null; t: Dictionary }) {
  if (!report) return <p style={{ color: "var(--text-muted)" }}>{t.legacyArtifactUnavailable}</p>;
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div className="stat-grid">
        {[
          { k: `${t.evidenceSufficient}: ${report.sufficientCount}`, v: report.sufficientCount, color: "var(--ok)" },
          { k: `${t.evidenceInsufficient}: ${report.insufficientCount}`, v: report.insufficientCount, color: "var(--warn)" },
          { k: `${t.errors}: ${report.rejectedFindingCount}`, v: report.rejectedFindingCount, color: "var(--danger)" },
        ].map((s) => (
          <div key={s.k} className="stat-card">
            <div className="stat-value" style={{ color: s.color }}>{s.v}</div>
            <div className="stat-label">{s.k}</div>
          </div>
        ))}
      </div>
      {report.findings.map((f) => (
        <div key={f.findingId} className="card" style={{ padding: "14px 16px" }}>
          <div className="card-header">
            <div className="card-title-wrap">
              <code style={{ fontWeight: 600, color: "var(--text)" }}>{f.findingId}</code>
              <ProvenanceBadge kind="computed" label={`${t.confidence}: ${f.confidence}`} />
              <ProvenanceBadge
                kind={f.sufficiency === "sufficient" ? "computed" : "conflict"}
                label={f.sufficiency === "sufficient" ? t.evidenceSufficient : t.evidenceInsufficient}
              />
            </div>
          </div>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "13px" }}>
            {t.supportCount}: <strong>{f.supportCount}</strong> / {f.corpusCount} · {t.supportRatio} {f.supportRatio.toFixed(4)} · {t.conflict}: {f.conflictCount}
          </p>
          {f.reasons.length > 0 ? (
            <p style={{ margin: "4px 0 0", color: "var(--warn)", fontSize: "12.5px" }}>{f.reasons.join(", ")}</p>
          ) : null}
        </div>
      ))}
      {report.rejected.length > 0 ? (
        <div>
          <h4 style={{ margin: "12px 0 6px", fontSize: "14px" }}>{t.errors}</h4>
          {report.rejected.map((r, i) => (
            <div key={i} style={{ fontSize: "13px", margin: "4px 0", display: "flex", gap: "8px", alignItems: "center" }}>
              <ProvenanceBadge kind="conflict" label={r.code} /> <span>{r.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const FACTOR_LABELS: (keyof PlanningFactors)[] = [
  "severity",
  "evidenceStrength",
  "confidence",
  "userImpact",
  "implementationScope",
  "dependencyRequirementIds",
];
const FACTOR_TEXT: Record<string, keyof Dictionary> = {
  severity: "factorSeverity",
  evidenceStrength: "factorEvidenceStrength",
  confidence: "factorConfidence",
  userImpact: "factorUserImpact",
  implementationScope: "factorImplementationScope",
  dependencyRequirementIds: "factorDependency",
};

export function VersionPlanPanel({ versionPlan, t }: { versionPlan: VersionPlanArtifact | null; t: Dictionary }) {
  if (!versionPlan) return <p style={{ color: "var(--text-muted)" }}>{t.legacyArtifactUnavailable}</p>;
  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {versionPlan.versions.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{t.noSchedulableRequirements}</p>
      ) : null}
      
      {versionPlan.versions.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
          {versionPlan.versions.map((v) => (
            <div key={v.id} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <strong style={{ fontSize: "15px", color: "var(--accent)" }}>{v.name}</strong>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{v.requirementIds.length} {t.requirements}</span>
              </div>
              <div style={{ fontSize: "13px", color: "var(--text)", marginBottom: "4px" }}>{v.summary}</div>
              {v.rationale ? (
                <div style={{ margin: "4px 0", fontSize: "12.5px", color: "var(--text-muted)" }}>
                  <strong>{t.versionRationale}:</strong> {v.rationale}
                </div>
              ) : null}
              <div style={{ color: "var(--text-faint)", fontSize: "12px", fontFamily: "monospace", marginTop: "4px" }}>
                {v.requirementIds.join(", ")}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "10px" }}>
        {versionPlan.decisions.map((d) => (
          <div key={d.requirementId} className="card" style={{ padding: "14px 16px" }}>
            <div className="card-header" style={{ marginBottom: "6px" }}>
              <div className="card-title-wrap">
                <code style={{ fontWeight: 600, color: "var(--text)" }}>{d.requirementId}</code>
                <ProvenanceBadge kind="computed" label={`${t.priority}: ${d.priority}`} />
                <span style={{ color: "var(--accent)", fontSize: "12px", fontWeight: 500 }}>{d.versionId ?? t.notChecked}</span>
              </div>
            </div>
            <div className="card-metadata-grid" style={{ marginBottom: "6px" }}>
              {FACTOR_LABELS.map((key) => (
                <div key={key} className="card-metadata-item">
                  <span className="card-metadata-label">{t[FACTOR_TEXT[key]]}</span>
                  <span className="card-metadata-value">
                    {key === "dependencyRequirementIds"
                      ? (d.planningFactors[key] as string[]).join(", ") || "—"
                      : String(d.planningFactors[key])}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              <strong>{t.versionRationale}:</strong> {d.planningFactors.rationale}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type DiagnosticGroup = { label: string; items: { code: string; message: string }[] };

export function RunDiagnosticsPanel({ events, t }: { events: RunEvent[]; t: Dictionary }) {
  const groups: Record<"Error" | "Warning" | "Validation" | "Revision", { code: string; message: string }[]> = {
    Error: [],
    Warning: [],
    Validation: [],
    Revision: [],
  };
  for (const e of events) {
    const data = e.data as Record<string, unknown>;
    if (e.type === "run.failed") {
      groups.Error.push({ code: "run.failed", message: typeof data.error === "string" ? data.error : "run failed" });
    }
    if (e.type === "stage.progress" && data && typeof data === "object" && "code" in data) {
      groups.Warning.push({ code: String(data.code), message: String(data.message ?? "") });
    }
    if (e.type === "limitation.reported" && data && typeof data === "object" && "code" in data) {
      groups.Warning.push({ code: String(data.code), message: String(data.message ?? "") });
    }
    if (e.type === "validation.failed") {
      groups.Validation.push({ code: "validation.failed", message: "traceability validation failed" });
    }
    if (e.type === "revision.started") {
      groups.Revision.push({ code: "revision.started", message: "constrained revision started" });
    }
    if (e.type === "revision.completed") {
      groups.Revision.push({ code: "revision.completed", message: String(data.note ?? "revision completed") });
    }
  }
  const labels: Record<keyof typeof groups, string> = {
    Error: t.diagnosticsError,
    Warning: t.diagnosticsWarning,
    Validation: t.diagnosticsValidation,
    Revision: t.diagnosticsRevision,
  };
  const renderable: DiagnosticGroup[] = (Object.keys(groups) as (keyof typeof groups)[])
    .filter((k) => groups[k].length > 0)
    .map((k) => ({ label: labels[k], items: groups[k] }));

  if (renderable.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {renderable.map((group) => (
        <div key={group.label} className="card" style={{ padding: "14px 16px" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 600 }}>{group.label}</h4>
          <div style={{ display: "grid", gap: "6px" }}>
            {group.items.map((item, i) => (
              <div key={i} style={{ fontSize: "13px", display: "flex", gap: "8px", alignItems: "center" }}>
                <ProvenanceBadge
                  kind={group.label === t.diagnosticsError ? "conflict" : group.label === t.diagnosticsRevision ? "computed" : "limitation"}
                  label={item.code}
                />
                <span style={{ color: "var(--text)" }}>{item.message}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ArtifactPhaseSelector({ revised, phase, onSelect, t }: { revised: boolean; phase: "draft" | "final"; onSelect: (p: "draft" | "final") => void; t: Dictionary }) {
  if (!revised) return <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>{t.noRevisionRequired}</p>;
  return (
    <div className="segmented-control" style={{ marginBottom: "12px" }}>
      {(["draft", "final"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className={`segmented-btn ${phase === p ? "segmented-btn-active" : ""}`}
        >
          {p === "draft" ? t.draft : t.final}
        </button>
      ))}
    </div>
  );
}

type GoalCoveragePanelShape = {
  valid: boolean;
  retried: boolean;
  items: { focusAreaId: string; label: string; status: "covered" | "unsupported" | "uncovered"; findingIds: string[]; requirementIds: string[] }[];
};

export function FinalDeliverablesPanel({ finalPrd, report, manifest, goalCoverage, t, locale = "zh-CN" }: { finalPrd: Prd | null; report: TraceabilityReport | null; manifest: RunManifest | null; goalCoverage?: GoalCoveragePanelShape | null; t: Dictionary; locale?: Locale }) {
  const usage = manifest?.modelUsage as Record<string, unknown> | undefined;
  const attempts = typeof usage?.attempts === "number" ? usage.attempts : typeof usage?.calls === "number" ? usage.calls : 0;
  const retries = typeof usage?.retries === "number" ? usage.retries : 0;
  const retryReasons = Array.isArray(usage?.retryReasons) ? (usage.retryReasons as string[]) : [];
  const promptVersions = Array.isArray(manifest?.promptVersions) ? manifest.promptVersions : Array.isArray(usage?.promptVersions) ? (usage.promptVersions as string[]) : [];

  const handleExportMarkdown = () => {
    let md = `# ${t.exportPackageTitle}\n\n`;
    if (manifest?.appName) md += `**${t.appNameLabel}**: ${manifest.appName}\n`;
    if (manifest?.appUrl) md += `**${t.appStoreLinkLabel}**: ${manifest.appUrl}\n`;
    if (manifest?.goal) md += `**${t.goal}**: ${manifest.goal}\n\n`;
    md += `---\n\n`;

    if (finalPrd?.versions?.length) {
      md += `## 1. ${t.roadmapMilestones}\n\n`;
      for (const v of finalPrd.versions) {
        md += `### ${t.versionLabel} ${v.name}: ${v.summary}\n`;
        md += `- **${t.versionRationale}**: ${v.rationale}\n`;
        md += `- **${t.includedRequirements}**: ${v.requirementIds.join(", ")}\n\n`;
      }
    }

    if (finalPrd?.requirements?.length) {
      md += `## 2. ${t.requirementsSpecs}\n\n`;
      for (const r of finalPrd.requirements) {
        md += `### [${r.priority}] ${r.id}: ${r.title}\n`;
        md += `${r.description}\n\n`;
        md += `**${t.acceptanceCriteria}**:\n`;
        for (const ac of r.acceptanceCriteria) {
          md += `- ${ac}\n`;
        }
        md += `\n**${t.supportingReviewIdsLabel}**: ${r.sourceReviewIds.join(", ")}\n\n`;
      }
    }

    if (finalPrd?.tests?.length) {
      md += `## 3. ${t.verificationPlan}\n\n`;
      for (const tc of finalPrd.tests) {
        md += `### ${tc.id} (${t.exportCorrespondsTo} ${tc.requirementIds.join(", ")})\n`;
        md += `- **${t.precondition}**: ${tc.precondition || t.noneValue}\n`;
        md += `- **${t.testSteps}**:\n`;
        tc.steps.forEach((s, idx) => {
          md += `  ${idx + 1}. ${s}\n`;
        });
        md += `- **${t.expected}**: ${tc.expectedResult}\n\n`;
      }
    }

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `app-review-planner-deliverables-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {/* Top Action Bar */}
      <div className="card" style={{ padding: "14px 18px", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{t.finalDeliverables}</h4>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{t.finalDeliverablesSubtitle}</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleExportMarkdown}>
          📥 {t.exportPackage}
        </button>
      </div>

      {goalCoverage ? (
        <div className="card">
          <div className="card-header" style={{ marginBottom: "6px" }}>
            <h4 className="card-title">
              {t.goalCoverage}
            </h4>
            {goalCoverage.valid ? (
              <ProvenanceBadge kind="computed" label={t.goalCoverageCovered} />
            ) : (
              <ProvenanceBadge kind="conflict" label={t.goalCoverageGap} />
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px" }}>
            {goalCoverage.items.map((item) => (
              <div key={item.focusAreaId} className="card" style={{ padding: "10px 12px", background: "var(--bg-elevated)" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>{item.label}</div>
                <ProvenanceBadge
                  kind={item.status === "covered" ? "computed" : item.status === "uncovered" ? "conflict" : "limitation"}
                  label={item.status === "covered" ? t.goalCoverageCovered : item.status === "uncovered" ? t.goalCoverageUncovered : t.goalCoverageUnsupported}
                />
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                  {t.findingId}: {item.findingIds.length} · {t.requirementId}: {item.requirementIds.length}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        {[
          { k: `${t.versionPlan}`, v: finalPrd?.versions.length ?? 0 },
          { k: t.requirementId, v: finalPrd?.requirements.length ?? 0 },
          { k: t.testCases, v: finalPrd?.tests.length ?? 0 },
        ].map((s) => (
          <div key={s.k} className="stat-card">
            <div className="stat-value">{s.v}</div>
            <div className="stat-label">{s.k}</div>
          </div>
        ))}
      </div>

      {report ? (() => {
        const closureStatus = report.closureStatus ?? deriveClosureStatus(finalPrd, report.violations);
        const isClosed = closureStatus === "closed";
        const isPartial = closureStatus === "partial";
        const isAssumptionOnly = closureStatus === "assumption-only";
        const closureLabel =
          closureStatus === "closed"
            ? t.traceClosureClosed
            : closureStatus === "partial"
              ? t.traceClosurePartial.replace(
                  "{count}",
                  String(
                    finalPrd?.findings.filter((f) => f.evidenceSufficiency?.status === "insufficient").length ||
                    finalPrd?.assumptions.filter((a) => a.origin === "insufficient-finding" || a.origin === "rejected-requirement").length || 0,
                  ),
                )
              : closureStatus === "assumption-only"
                ? t.traceClosureAssumptionOnly
                : t.traceClosureInvalid;

        return (
          <div style={{ display: "grid", gap: "8px" }}>
            <div className="card" style={{ padding: "12px 16px", flexDirection: "row", justifyContent: "space-between", alignItems: "center", background: report.valid ? "var(--ok-soft)" : "var(--danger-soft)", borderColor: report.valid ? "var(--ok-border)" : "var(--danger-border)" }}>
              <div>
                <strong>{t.structuralValidation}: {report.valid ? t.completed : t.failed}</strong> — {t.traceability}
              </div>
              <ProvenanceBadge kind={report.valid ? "computed" : "conflict"} label={report.valid ? "VALID" : "INVALID"} />
            </div>
            <div className="card" style={{ padding: "12px 16px", flexDirection: "row", justifyContent: "space-between", alignItems: "center", background: isClosed ? "var(--ok-soft)" : isPartial || isAssumptionOnly ? "var(--warn-soft)" : "var(--danger-soft)", borderColor: isClosed ? "var(--ok-border)" : isPartial || isAssumptionOnly ? "var(--warn-border)" : "var(--danger-border)" }}>
              <div>
                <strong>{t.productClosure}: {closureLabel}</strong>
              </div>
              <ProvenanceBadge kind={isClosed ? "computed" : isPartial || isAssumptionOnly ? "limitation" : "conflict"} label={closureStatus.toUpperCase()} />
            </div>
          </div>
        );
      })() : null}

      {manifest?.limitations.length ? (
        <div className="card">
          <h4 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 600 }}>{t.limitations}</h4>
          <div style={{ display: "grid", gap: "6px" }}>
            {dedupeLimitations(manifest.limitations).map((l, i) => (
              <div key={i} style={{ fontSize: "13px", display: "flex", gap: "8px", alignItems: "center" }}>
                <ProvenanceBadge kind="limitation" label={translateCode(l.code, locale)} />
                <span style={{ color: "var(--text)" }}>{translateLimitationMessage(l.code, locale, l.params, l.message)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {manifest ? (
        <div className="card" style={{ padding: "14px 16px" }}>
          <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 600 }}>{t.modelStatus}</h4>
          <p style={{ fontSize: "13px", margin: "4px 0", color: "var(--text)" }}>
            {t.logicalCalls}: <strong>{typeof usage?.calls === "number" ? usage.calls : 0}</strong> · {t.modelAttempts}: <strong>{attempts}</strong> · {t.modelRetries}: <strong>{retries}</strong>
          </p>
          {retryReasons.length > 0 ? (
            <p style={{ fontSize: "12.5px", margin: "4px 0", color: "var(--text-muted)" }}>
              {t.modelRetryReasons}: {retryReasons.map((r) => translateCode(r, locale)).join(", ")}
            </p>
          ) : null}
          {promptVersions.length > 0 ? (
            <p style={{ fontSize: "12px", margin: "4px 0", color: "var(--text-faint)", fontFamily: "monospace" }}>
              {t.promptVersions}: {promptVersions.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
