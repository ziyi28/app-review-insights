"use client";

import { type Dictionary, translateCode } from "@/i18n";
import type { Prd, VersionPlanArtifact, PlanningFactors } from "@/domain/contracts/analysis";
import type { TraceabilityReport } from "@/domain/traceability/validate";
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
    <div style={{ display: "grid", gap: "8px" }}>
      {candidates.map((c) => (
        <div key={c.id} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <h4 style={{ margin: "0 0 4px" }}>
            {c.label} <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
          </h4>
          <p style={{ margin: "0 0 4px", fontSize: "13px" }}>“{c.quote}”</p>
          <div style={{ color: "var(--text-muted)", fontSize: "12px", display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }}>
            <span>{t.reviewId}:</span>
            {c.supportingReviewIds.map((id, i) => (
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
        </div>
      ))}
    </div>
  );
}

export function EvidenceValidationPanel({ report, t }: { report: EvidenceValidationReport | null; t: Dictionary }) {
  if (!report) return <p style={{ color: "var(--text-muted)" }}>{t.legacyArtifactUnavailable}</p>;
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
        {[
          { k: `${t.evidenceSufficient}: ${report.sufficientCount}`, v: report.sufficientCount },
          { k: `${t.evidenceInsufficient}: ${report.insufficientCount}`, v: report.insufficientCount },
          { k: `${t.errors}: ${report.rejectedFindingCount}`, v: report.rejectedFindingCount },
        ].map((s) => (
          <div key={s.k} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
            <div style={{ fontSize: "20px", fontWeight: 700 }}>{s.v}</div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{s.k}</div>
          </div>
        ))}
      </div>
      {report.findings.map((f) => (
        <div key={f.findingId} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <code>{f.findingId}</code>
            <ProvenanceBadge kind="computed" label={`${t.confidence}: ${f.confidence}`} />
            <ProvenanceBadge
              kind={f.sufficiency === "sufficient" ? "computed" : "conflict"}
              label={f.sufficiency === "sufficient" ? t.evidenceSufficient : t.evidenceInsufficient}
            />
          </div>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "13px" }}>
            {t.supportCount}: {f.supportCount} / {f.corpusCount} · {t.supportRatio} {f.supportRatio.toFixed(4)} · {t.conflict}: {f.conflictCount}
          </p>
          {f.reasons.length > 0 ? (
            <p style={{ margin: "4px 0 0", color: "var(--warn)", fontSize: "13px" }}>{f.reasons.join(", ")}</p>
          ) : null}
        </div>
      ))}
      {report.rejected.length > 0 ? (
        <div>
          <h4>{t.errors}</h4>
          {report.rejected.map((r, i) => (
            <p key={i} style={{ fontSize: "13px", margin: "4px 0" }}>
              <ProvenanceBadge kind="conflict" label={r.code} /> {r.message}
            </p>
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
    <div style={{ display: "grid", gap: "10px" }}>
      {versionPlan.versions.length === 0 && versionPlan.decisions.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>
      ) : null}
      {versionPlan.versions.map((v) => (
        <div key={v.id} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <strong>{v.name}</strong> — {v.summary}
          {v.rationale ? (
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
              <strong>{t.versionRationale}:</strong> {v.rationale}
            </p>
          ) : null}
          <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>{v.requirementIds.join(", ")}</div>
        </div>
      ))}
      {versionPlan.decisions.map((d) => (
        <div key={d.requirementId} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <code>{d.requirementId}</code>
            <ProvenanceBadge kind="computed" label={`${t.priority}: ${d.priority}`} />
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{d.versionId ?? t.notChecked}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "6px", marginTop: "6px" }}>
            {FACTOR_LABELS.map((key) => (
              <div key={key} style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                <strong>{t[FACTOR_TEXT[key]]}:</strong>{" "}
                {key === "dependencyRequirementIds"
                  ? (d.planningFactors[key] as string[]).join(", ") || "—"
                  : String(d.planningFactors[key])}
              </div>
            ))}
          </div>
          <div style={{ marginTop: "6px", fontSize: "13px" }}>
            <strong>{t.versionRationale}:</strong> {d.planningFactors.rationale}
          </div>
        </div>
      ))}
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
    <div style={{ display: "grid", gap: "10px" }}>
      {renderable.map((group) => (
        <div key={group.label}>
          <h4>{group.label}</h4>
          {group.items.map((item, i) => (
            <p key={i} style={{ fontSize: "13px", margin: "4px 0" }}>
              <ProvenanceBadge kind={group.label === t.diagnosticsError ? "conflict" : group.label === t.diagnosticsRevision ? "computed" : "limitation"} label={item.code} /> {item.message}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ArtifactPhaseSelector({ revised, phase, onSelect, t }: { revised: boolean; phase: "draft" | "final"; onSelect: (p: "draft" | "final") => void; t: Dictionary }) {
  if (!revised) return <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>{t.noRevisionRequired}</p>;
  return (
    <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
      {(["draft", "final"] as const).map((p) => (
        <button
          key={p}
          onClick={() => onSelect(p)}
          style={{ padding: "4px 12px", borderRadius: "6px", border: phase === p ? "1px solid var(--accent)" : "1px solid var(--border)", background: phase === p ? "var(--bg-elevated)" : "transparent" }}
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

export function FinalDeliverablesPanel({ finalPrd, report, manifest, goalCoverage, t }: { finalPrd: Prd | null; report: TraceabilityReport | null; manifest: RunManifest | null; goalCoverage?: GoalCoveragePanelShape | null; t: Dictionary }) {
  const usage = manifest?.modelUsage as Record<string, unknown> | undefined;
  const attempts = typeof usage?.attempts === "number" ? usage.attempts : typeof usage?.calls === "number" ? usage.calls : 0;
  const retries = typeof usage?.retries === "number" ? usage.retries : 0;
  const retryReasons = Array.isArray(usage?.retryReasons) ? (usage.retryReasons as string[]) : [];
  const promptVersions = Array.isArray(manifest?.promptVersions) ? manifest.promptVersions : Array.isArray(usage?.promptVersions) ? (usage.promptVersions as string[]) : [];

  const handleExportMarkdown = () => {
    let md = `# App 评论分析与产品规划全案交付包\n\n`;
    if (manifest?.appName) md += `**应用名称**: ${manifest.appName}\n`;
    if (manifest?.appUrl) md += `**App Store 链接**: ${manifest.appUrl}\n`;
    if (manifest?.goal) md += `**分析目标**: ${manifest.goal}\n\n`;
    md += `---\n\n`;

    if (finalPrd?.versions?.length) {
      md += `## 1. 版本规划路线图\n\n`;
      for (const v of finalPrd.versions) {
        md += `### 版本 ${v.name}: ${v.summary}\n`;
        md += `- **发布理由**: ${v.rationale}\n`;
        md += `- **包含需求**: ${v.requirementIds.join(", ")}\n\n`;
      }
    }

    if (finalPrd?.requirements?.length) {
      md += `## 2. PRD 需求规格与验收准则\n\n`;
      for (const r of finalPrd.requirements) {
        md += `### [${r.priority}] ${r.id}: ${r.title}\n`;
        md += `${r.description}\n\n`;
        md += `**验收标准**:\n`;
        for (const ac of r.acceptanceCriteria) {
          md += `- ${ac}\n`;
        }
        md += `\n**支撑评论 ID**: ${r.sourceReviewIds.join(", ")}\n\n`;
      }
    }

    if (finalPrd?.tests?.length) {
      md += `## 3. 测试用例与验证计划\n\n`;
      for (const tc of finalPrd.tests) {
        md += `### ${tc.id} (对应 ${tc.requirementIds.join(", ")})\n`;
        md += `- **前置条件**: ${tc.precondition || "无"}\n`;
        md += `- **测试步骤**:\n`;
        tc.steps.forEach((s, idx) => {
          md += `  ${idx + 1}. ${s}\n`;
        });
        md += `- **预期结果**: ${tc.expectedResult}\n\n`;
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
    <div style={{ display: "grid", gap: "12px" }}>
      {/* Top Action Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-panel)", padding: "12px 16px", borderRadius: "8px", border: "1px solid var(--border)" }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{t.finalDeliverables}</h4>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>包含版本计划、PRD 规格书、测试用例与全链路追溯</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleExportMarkdown}>
          📥 {t.exportPackage}
        </button>
      </div>

      {goalCoverage ? (
        <div className="card">
          <h4 style={{ margin: 0 }}>
            {t.goalCoverage} {goalCoverage.valid ? <ProvenanceBadge kind="computed" label={t.goalCoverageCovered} /> : <ProvenanceBadge kind="conflict" label={t.goalCoverageGap} />}
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px", marginTop: "6px" }}>
            {goalCoverage.items.map((item) => (
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
        {[
          { k: `${t.versionPlan}`, v: finalPrd?.versions.length ?? 0 },
          { k: t.requirementId, v: finalPrd?.requirements.length ?? 0 },
          { k: t.testCases, v: finalPrd?.tests.length ?? 0 },
        ].map((s) => (
          <div key={s.k} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
            <div style={{ fontSize: "20px", fontWeight: 700 }}>{s.v}</div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{s.k}</div>
          </div>
        ))}
      </div>
      {report ? (
        <div style={{ padding: "10px", borderRadius: "8px", background: report.valid ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)", border: `1px solid ${report.valid ? "var(--ok)" : "var(--danger)"}` }}>
          <strong>{report.valid ? t.completed : t.failed}</strong> — {t.traceability}
        </div>
      ) : null}
      {manifest?.limitations.length ? (
        <div className="card">
          <h4 style={{ margin: "0 0 8px" }}>{t.limitations}</h4>
          {dedupeLimitations(manifest.limitations).map((l, i) => (
            <p key={i} style={{ fontSize: "13px", margin: "6px 0", display: "flex", gap: "8px", alignItems: "center" }}>
              <ProvenanceBadge kind="limitation" label={translateCode(l.code)} />
              <span>{l.message}</span>
            </p>
          ))}
        </div>
      ) : null}
      {manifest ? (
        <div style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <h4 style={{ margin: "0 0 6px" }}>{t.modelStatus}</h4>
          <p style={{ fontSize: "13px", margin: "4px 0" }}>
            {t.logicalCalls}: <strong>{typeof usage?.calls === "number" ? usage.calls : 0}</strong> · {t.modelAttempts}: <strong>{attempts}</strong> · {t.modelRetries}: <strong>{retries}</strong>
          </p>
          {retryReasons.length > 0 ? (
            <p style={{ fontSize: "13px", margin: "4px 0" }}>{t.modelRetryReasons}: {retryReasons.map((r) => translateCode(r)).join(", ")}</p>
          ) : null}
          {promptVersions.length > 0 ? (
            <p style={{ fontSize: "13px", margin: "4px 0" }}>{t.promptVersions}: {promptVersions.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
