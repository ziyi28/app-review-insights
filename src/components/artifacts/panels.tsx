"use client";

import type { Dictionary } from "@/i18n";
import type { Finding, Requirement, TestCase, Prd, Assumption } from "@/domain/contracts/analysis";
import { ProvenanceBadge } from "@/components/workbench/provenance-badge";
import { findingIdsForRequirements, priorityForRequirements } from "@/domain/traceability/evidence-sources";
import { deriveClosureStatus, type ClosureStatus } from "@/domain/traceability/validate";

function ReviewIdList({
  reviewIds,
  onJumpToReview,
  t,
  limit = 5,
}: {
  reviewIds: string[];
  onJumpToReview?: (id: string) => void;
  t: Dictionary;
  limit?: number;
}) {
  const displayed = reviewIds.slice(0, limit);
  if (displayed.length === 0) return <span>—</span>;
  return (
    <span>
      {displayed.map((id, i) => (
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
      {reviewIds.length > limit ? (
        <span style={{ color: "var(--text-faint)", fontSize: "11px", marginLeft: "4px" }}>
          +{reviewIds.length - limit}
        </span>
      ) : null}
    </span>
  );
}

export function TopicsPanel({
  topics,
  t,
  onJumpToReview,
}: {
  topics: { id: string; label: string; description: string; reviewIds: string[] }[];
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
}) {
  if (!topics.length) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {topics.map((topic) => (
        <div key={topic.id} className="card" style={{ padding: "14px 16px" }}>
          <div className="card-header" style={{ marginBottom: "6px" }}>
            <div className="card-title-wrap">
              <h4 className="card-title">{topic.label}</h4>
              <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
            </div>
            <code style={{ fontSize: "12px", color: "var(--text-muted)" }}>{topic.id}</code>
          </div>
          <p className="card-desc" style={{ margin: 0 }}>{topic.description}</p>
          <div style={{ color: "var(--text-muted)", fontSize: "12px", display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
            <span>{topic.reviewIds.length} {t.supportCount}:</span>
            <ReviewIdList reviewIds={topic.reviewIds} onJumpToReview={onJumpToReview} t={t} limit={4} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FindingsPanel({
  findings,
  t,
  onJumpToReview,
}: {
  findings: Finding[];
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
}) {
  if (!findings.length) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {findings.map((f) => (
        <div key={f.id} className="card" style={{ padding: "16px 18px" }}>
          <div className="card-header">
            <div className="card-title-wrap">
              <h4 className="card-title">{f.title}</h4>
              <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
              <ProvenanceBadge kind="computed" label={`${t.confidence}: ${f.confidence.level}`} />
              {f.evidenceSufficiency ? (
                <ProvenanceBadge
                  kind={f.evidenceSufficiency.status === "sufficient" ? "computed" : "conflict"}
                  label={f.evidenceSufficiency.status === "sufficient" ? t.evidenceSufficient : t.evidenceInsufficient}
                />
              ) : null}
            </div>
            <code style={{ fontSize: "12px", color: "var(--text-muted)" }}>{f.id}</code>
          </div>
          <p className="card-desc" style={{ margin: "4px 0 8px" }}>{f.summary}</p>

          <div className="card-metadata-grid" style={{ marginBottom: "8px" }}>
            <div className="card-metadata-item">
              <span className="card-metadata-label">{t.supportCount}</span>
              <span className="card-metadata-value">
                <strong>{f.supportingSampleCount}</strong> · <ReviewIdList reviewIds={f.supportingReviewIds} onJumpToReview={onJumpToReview} t={t} limit={5} />
              </span>
            </div>
            {f.evidenceSufficiency ? (
              <div className="card-metadata-item">
                <span className="card-metadata-label">{t.evidenceStrength}</span>
                <span className="card-metadata-value">
                  <strong>{f.supportingSampleCount}</strong> / {f.evidenceSufficiency.corpusReviewCount} ({t.supportRatio} {f.evidenceSufficiency.supportRatio.toFixed(4)})
                  {f.evidenceSufficiency.reasons.length > 0 ? ` · ${f.evidenceSufficiency.reasons.join(", ")}` : ""}
                </span>
              </div>
            ) : null}
          </div>

          {f.evidenceExcerpts.length > 0 ? (
            <div className="card-section">
              <span className="card-section-title">{t.evidenceExcerpts}</span>
              <ul style={{ margin: "4px 0", paddingLeft: "18px", display: "grid", gap: "4px" }}>
                {f.evidenceExcerpts.slice(0, 3).map((e, i) => (
                  <li key={i} style={{ fontSize: "13px", color: "var(--text)" }}>
                    “{e.excerpt}”{" "}
                    <code
                      onClick={() => onJumpToReview?.(e.reviewId)}
                      role={onJumpToReview ? "button" : undefined}
                      tabIndex={onJumpToReview ? 0 : undefined}
                      onKeyDown={
                        onJumpToReview
                          ? (ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                onJumpToReview(e.reviewId);
                              }
                            }
                          : undefined
                      }
                      title={onJumpToReview ? `${t.jumpToReview} ${e.reviewId}` : undefined}
                      className="code-badge"
                    >
                      {e.reviewId.slice(0, 8)}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {f.conflictingReviewIds.length > 0 ? (
            <div style={{ color: "var(--danger)", fontSize: "13px", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
              <ProvenanceBadge kind="conflict" label={t.conflict} />{" "}
              <ReviewIdList reviewIds={f.conflictingReviewIds} onJumpToReview={onJumpToReview} t={t} limit={4} />
            </div>
          ) : null}

          {f.uncertainties.length > 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
              <strong>{t.uncertain}:</strong> {f.uncertainties.join("; ")}
            </div>
          ) : null}

          {f.limitations.length > 0 ? (
            <div style={{ color: "var(--warn)", fontSize: "13px", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
              <ProvenanceBadge kind="limitation" label={t.limitations} /> {f.limitations.join("; ")}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RequirementsPanel({
  requirements,
  versions,
  assumptions,
  t,
  onJumpToReview,
  onJumpToTests,
}: {
  requirements: Requirement[];
  versions: { id: string; name: string; summary: string; requirementIds: string[] }[];
  assumptions: Assumption[];
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
  onJumpToTests?: (reqId?: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {versions.length > 0 ? (
        <div style={{ display: "grid", gap: "8px" }}>
          <h4 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 600 }}>{t.versionPlan}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
            {versions.map((v) => (
              <div key={v.id} className="card" style={{ padding: "12px 14px", background: "var(--bg-card)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "14px", color: "var(--accent)" }}>{v.name}</strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{v.requirementIds.length} {t.requirements}</span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--text)", marginBottom: "6px" }}>{v.summary}</div>
                <div style={{ color: "var(--text-faint)", fontSize: "12px", fontFamily: "monospace" }}>{v.requirementIds.join(", ")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "10px" }}>
        {requirements.map((r) => (
          <div key={r.id} className="card" style={{ padding: "16px 18px" }}>
            <div className="card-header">
              <div className="card-title-wrap">
                <h4 className="card-title">{r.title}</h4>
                <ProvenanceBadge kind="computed" label={`${r.priority}`} />
                <code style={{ fontSize: "12px", color: "var(--text-muted)" }}>{r.id}</code>
              </div>
              {onJumpToTests ? (
                <button
                  type="button"
                  onClick={() => onJumpToTests(r.id)}
                  className="btn btn-ghost"
                  style={{ fontSize: "12px", padding: "3px 10px", height: "auto" }}
                  title={`${t.viewTestCases} ${r.id}`}
                >
                  {t.testCases} →
                </button>
              ) : null}
            </div>
            <p className="card-desc" style={{ margin: "4px 0 8px" }}>{r.description}</p>
            <div style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "8px" }}>
              {t.reviewId}: <ReviewIdList reviewIds={r.sourceReviewIds} onJumpToReview={onJumpToReview} t={t} limit={5} />
            </div>
            <div className="card-section">
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <ProvenanceBadge kind="computed" label={t.acceptanceCriteriaProvenance} />
              </div>
              <ul style={{ margin: "2px 0", fontSize: "13px", paddingLeft: "18px", display: "grid", gap: "3px" }}>
                {r.acceptanceCriteria.map((c, i) => (
                  <li key={i} style={{ color: "var(--text)" }}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {assumptions.length > 0 ? (
        <div style={{ marginTop: "8px" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: "15px", fontWeight: 600 }}>{t.assumptions}</h4>
          <div style={{ display: "grid", gap: "8px" }}>
            {assumptions.map((a) => (
              <div key={a.id} className="card" style={{ padding: "12px 14px", borderStyle: "dashed" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                  <ProvenanceBadge kind="assumption" label={t.assumptions} />
                  <strong style={{ fontSize: "13.5px" }}>{a.text}</strong>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "12.5px" }}>{a.basis}</div>
                {a.sourceFindingIds && a.sourceFindingIds.length > 0 ? (
                  <div style={{ color: "var(--text-faint)", fontSize: "12px", marginTop: "4px" }}>
                    <strong>{t.sourceFindings}:</strong> {a.sourceFindingIds.join(", ")}
                  </div>
                ) : null}
                {a.sourceReviewIds && a.sourceReviewIds.length > 0 ? (
                  <div style={{ color: "var(--text-faint)", fontSize: "12px", marginTop: "2px" }}>
                    <strong>{t.sourceReviews}:</strong> <ReviewIdList reviewIds={a.sourceReviewIds} onJumpToReview={onJumpToReview} t={t} limit={5} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TestsPanel({
  tests,
  requirements,
  t,
  onJumpToReview,
  onJumpToPrd,
}: {
  tests: TestCase[];
  requirements: Requirement[];
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
  onJumpToPrd?: (reqId?: string) => void;
}) {
  if (!tests.length) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {tests.map((test) => {
        const findingIds = test.findingIds ?? findingIdsForRequirements(test.requirementIds, requirements);
        const priority = test.priority ?? priorityForRequirements(test.requirementIds, requirements) ?? "P2";
        return (
          <div key={test.id} className="card" style={{ padding: "14px 16px" }}>
            <div className="card-header">
              <div className="card-title-wrap">
                <h4 className="card-title" style={{ fontFamily: "monospace" }}>{test.id}</h4>
                <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
                <ProvenanceBadge kind="computed" label={`${t.priority}: ${priority}`} />
              </div>
              {onJumpToPrd ? (
                <button
                  type="button"
                  onClick={() => onJumpToPrd(test.requirementIds[0])}
                  className="btn btn-ghost"
                  style={{ fontSize: "12px", padding: "3px 10px", height: "auto" }}
                  title={t.viewPrdRequirement}
                >
                  PRD →
                </button>
              ) : null}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "12.5px", margin: "4px 0" }}>
              {t.requirementId}: <code style={{ color: "var(--accent)" }}>{test.requirementIds.join(", ")}</code> · {t.findingId}: <code>{findingIds.join(", ")}</code> · {t.reviewId}:{" "}
              <ReviewIdList reviewIds={test.sourceReviewIds} onJumpToReview={onJumpToReview} t={t} limit={4} />
            </div>
            <div style={{ margin: "4px 0", fontSize: "13px" }}>
              <strong>{t.precondition}:</strong> {test.precondition || "—"}
            </div>
            <div className="card-section">
              <span className="card-section-title">{t.steps}</span>
              <ol style={{ margin: "2px 0", fontSize: "13px", paddingLeft: "18px", display: "grid", gap: "2px" }}>
                {test.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            <div style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--ok)" }}>
              <strong>{t.expected}:</strong> {test.expectedResult}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TraceabilityPanel({
  report,
  findings = [],
  prd,
  tests = [],
  revisedAndValid = false,
  t,
  onJumpToReview,
  onJumpToPrd,
  onJumpToTests,
}: {
  report: { valid: boolean; closureStatus?: ClosureStatus; violations: { code: string; message: string; entity?: string }[] } | null;
  findings?: Finding[];
  prd?: Prd | { requirements?: Requirement[]; assumptions?: Assumption[] } | null;
  tests?: TestCase[];
  revisedAndValid?: boolean;
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
  onJumpToPrd?: (reqId?: string) => void;
  onJumpToTests?: (reqId?: string) => void;
}) {
  if (!report && findings.length === 0 && !prd) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;

  const requirements: Requirement[] = prd ? ("requirements" in prd ? (prd.requirements ?? []) : []) : [];
  const closureStatus: ClosureStatus =
    report?.closureStatus ??
    deriveClosureStatus(prd as Prd, report?.violations ?? []);

  const insufficientCount =
    findings.filter((f) => f.evidenceSufficiency?.status === "insufficient").length ||
    (prd && "assumptions" in prd
      ? (prd.assumptions ?? []).filter((a) => a.origin === "insufficient-finding" || a.origin === "rejected-requirement").length
      : 0);

  const revisedAndFixed = !!report && !report.valid && revisedAndValid;
  const statusColor =
    closureStatus === "closed"
      ? "var(--ok)"
      : closureStatus === "partial" || closureStatus === "assumption-only"
        ? "var(--warn)"
        : revisedAndFixed
          ? "var(--warn)"
          : "var(--danger)";

  const statusBackground =
    closureStatus === "closed"
      ? "var(--ok-soft)"
      : closureStatus === "partial" || closureStatus === "assumption-only"
        ? "var(--warn-soft)"
        : revisedAndFixed
          ? "var(--warn-soft)"
          : "var(--danger-soft)";

  const statusLabel =
    closureStatus === "closed"
      ? t.traceClosureClosed
      : closureStatus === "partial"
        ? t.traceClosurePartial.replace("{count}", String(insufficientCount))
        : closureStatus === "assumption-only"
          ? t.traceClosureAssumptionOnly
          : revisedAndFixed
            ? t.traceRevisedPassed.replace("{count}", String(report?.violations.length ?? 0))
            : t.failed;

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {/* Verification Status Banner */}
      {report ? (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: "var(--radius)",
            background: statusBackground,
            border: `1px solid ${statusColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: statusColor,
              }}
            />
            <strong style={{ color: statusColor, fontSize: "14px" }}>{statusLabel}</strong>
            <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              — {report.violations.length} {t.errors} ({t.traceValidationSummary})
            </span>
          </div>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            {t.traceCoverageLabel}: {findings.length} {t.traceCoverageFindings} · {requirements.length} {t.traceCoverageRequirements} · {tests.length} {t.testCases}
          </span>
        </div>
      ) : null}

      {report?.violations.map((v, i) => (
        <div
          key={i}
          style={{
            padding: "10px 14px",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius-sm)",
            background: "var(--danger-soft)",
            fontSize: "13px",
          }}
        >
          <code style={{ color: "var(--danger)", fontWeight: 600 }}>{v.code}</code>: {v.message}
        </div>
      ))}

      {/* End-to-End Traceability Matrix */}
      {findings.length > 0 || requirements.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>{t.traceMatrixTitle}</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{t.traceMatrixSubtitle}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr>
                  <th style={{ width: "28%" }}>{t.traceColFinding}</th>
                  <th style={{ width: "18%" }}>{t.traceColReviews}</th>
                  <th style={{ width: "26%" }}>{t.traceColRequirement}</th>
                  <th style={{ width: "16%" }}>{t.traceColTests}</th>
                  <th style={{ width: "12%" }}>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => {
                  const relatedReqs = requirements.filter((r) => r.findingIds.includes(f.id));
                  const relatedReqIds = relatedReqs.map((r) => r.id);
                  const matchedTests = tests.filter((tc) =>
                    (tc.findingIds ?? findingIdsForRequirements(tc.requirementIds, requirements)).includes(f.id),
                  );
                  const isInsufficient = f.evidenceSufficiency?.status === "insufficient";
                  const hasViolation = report?.violations.some((v) => v.entity === f.id) ?? false;
                  const traceStatus = hasViolation
                    ? "violation"
                    : isInsufficient
                      ? "insufficient"
                      : relatedReqs.length === 0
                        ? "uncovered"
                        : matchedTests.length === 0
                          ? "missing-test"
                          : "closed";

                  return (
                    <tr key={f.id}>
                      <td>
                        <div style={{ fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>
                          {f.title}
                        </div>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <ProvenanceBadge
                            kind="ai-generated"
                            label={`${t.confidence}: ${typeof f.confidence === "object" && f.confidence !== null ? f.confidence.level : f.confidence}`}
                          />
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {t.evidenceStrength}: {f.supportingReviewIds.length}
                          </span>
                        </div>
                      </td>
                      <td>
                        <ReviewIdList
                          reviewIds={f.supportingReviewIds}
                          onJumpToReview={onJumpToReview}
                          t={t}
                          limit={3}
                        />
                      </td>
                      <td>
                        {relatedReqs.length > 0 ? (
                          relatedReqs.map((r) => (
                            <div key={r.id} style={{ marginBottom: "6px" }}>
                              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <span style={{ fontWeight: 600, color: "var(--accent)" }}>{r.id}</span>
                                <span className={`badge-p${r.priority === "P0" ? "0" : r.priority === "P1" ? "1" : "2"}`} style={{ fontSize: "11px", padding: "1px 5px", borderRadius: "var(--radius-xs)" }}>
                                  {r.priority}
                                </span>
                                {onJumpToPrd ? (
                                  <button
                                    type="button"
                                    onClick={() => onJumpToPrd(r.id)}
                                    className="btn btn-ghost"
                                    style={{ padding: "0 4px", fontSize: "11px", height: "auto" }}
                                    title={t.viewPrdRequirement}
                                  >
                                    ↗
                                  </button>
                                ) : null}
                              </div>
                              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                                {r.title}
                              </div>
                            </div>
                          ))
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>—</span>
                        )}
                      </td>
                      <td>
                        {matchedTests.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {matchedTests.map((tc) => (
                              <button
                                key={tc.id}
                                type="button"
                                onClick={() => onJumpToTests?.(relatedReqIds[0])}
                                className="code-badge"
                                title={t.viewTestCases}
                              >
                                {tc.id}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`chip ${
                            traceStatus === "violation"
                              ? "chip-danger"
                              : traceStatus === "insufficient" || traceStatus === "missing-test"
                                ? "chip-warn"
                                : traceStatus === "uncovered"
                                  ? "chip-muted"
                                  : "chip-ok"
                          }`}
                        >
                          {traceStatus === "violation"
                            ? t.traceStatusViolation
                            : traceStatus === "insufficient"
                              ? t.traceStatusAssumption
                              : traceStatus === "missing-test"
                                ? t.traceStatusMissingTest
                                : traceStatus === "uncovered"
                                  ? t.traceStatusUncovered
                                  : t.traceStatusClosed}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
