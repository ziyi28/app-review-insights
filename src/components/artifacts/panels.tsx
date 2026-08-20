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
                title={onJumpToReview ? `${t.jumpToReview} ${id}` : undefined}
                style={{
                  cursor: onJumpToReview ? "pointer" : "default",
                  color: onJumpToReview ? "var(--accent)" : "inherit",
                  textDecoration: onJumpToReview ? "underline" : "none",
                }}
              >
                {id.length > 8 ? id.slice(0, 8) : id}
              </code>
        </span>
      ))}
      {reviewIds.length > limit ? <span style={{ color: "var(--text-faint)", fontSize: "11px" }}> +{reviewIds.length - limit}</span> : null}
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
    <div style={{ display: "grid", gap: "8px" }}>
      {topics.map((topic) => (
        <div key={topic.id} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <h4 style={{ margin: "0 0 4px" }}>
            {topic.label} <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
          </h4>
          <p style={{ margin: "0 0 4px" }}>{topic.description}</p>
          <div style={{ color: "var(--text-muted)", fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
            <code>{topic.id}</code> · <span>{topic.reviewIds.length} {t.supportCount}:</span>
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
    <div style={{ display: "grid", gap: "10px" }}>
      {findings.map((f) => (
        <div key={f.id} style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
            <h4 style={{ margin: 0 }}>{f.title}</h4>
            <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
            <ProvenanceBadge kind="computed" label={`${t.confidence}: ${f.confidence.level}`} />
            {/* Legacy cached findings predate the sufficiency verdict; only
                new artifacts carry it. */}
            {f.evidenceSufficiency ? (
              <ProvenanceBadge
                kind={f.evidenceSufficiency.status === "sufficient" ? "computed" : "conflict"}
                label={f.evidenceSufficiency.status === "sufficient" ? t.evidenceSufficient : t.evidenceInsufficient}
              />
            ) : null}
          </div>
          <p style={{ margin: "0 0 6px" }}>{f.summary}</p>
          <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
            {t.supportCount}: <strong>{f.supportingSampleCount}</strong> · {t.reviewId}:{" "}
            <ReviewIdList reviewIds={f.supportingReviewIds} onJumpToReview={onJumpToReview} t={t} limit={5} />
          </p>
          {f.evidenceSufficiency ? (
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {t.evidenceStrength}: <strong>{f.supportingSampleCount}</strong> / {f.evidenceSufficiency.corpusReviewCount} · {t.supportRatio}{" "}
              {f.evidenceSufficiency.supportRatio.toFixed(4)}
              {f.evidenceSufficiency.reasons.length > 0 ? ` · ${f.evidenceSufficiency.reasons.join(", ")}` : ""}
            </p>
          ) : null}
          {f.evidenceExcerpts.length > 0 ? (
            <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
              {f.evidenceExcerpts.slice(0, 3).map((e, i) => (
                <li key={i} style={{ fontSize: "13px" }}>
                  “{e.excerpt}”{" "}
                  <code
                    onClick={() => onJumpToReview?.(e.reviewId)}
                    title={onJumpToReview ? `${t.jumpToReview} ${e.reviewId}` : undefined}
                    style={{
                      color: onJumpToReview ? "var(--accent)" : "var(--text-muted)",
                      cursor: onJumpToReview ? "pointer" : "default",
                      textDecoration: onJumpToReview ? "underline" : "none",
                    }}
                  >
                    {e.reviewId.slice(0, 8)}
                  </code>
                </li>
              ))}
            </ul>
          ) : null}
          {f.conflictingReviewIds.length > 0 ? (
            <p style={{ color: "var(--danger)", fontSize: "13px" }}>
              <ProvenanceBadge kind="conflict" label={t.conflict} />{" "}
              <ReviewIdList reviewIds={f.conflictingReviewIds} onJumpToReview={onJumpToReview} t={t} limit={4} />
            </p>
          ) : null}
          {f.uncertainties.length > 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              <strong>{t.uncertain}:</strong> {f.uncertainties.join("; ")}
            </p>
          ) : null}
          {f.limitations.length > 0 ? (
            <p style={{ color: "var(--warn)", fontSize: "13px" }}>
              <ProvenanceBadge kind="limitation" label={t.limitations} /> {f.limitations.join("; ")}
            </p>
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
    <div style={{ display: "grid", gap: "10px" }}>
      {versions.length > 0 ? (
        <div>
          <h4>{t.versionPlan}</h4>
          {versions.map((v) => (
            <div key={v.id} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "6px", marginBottom: "6px", background: "var(--bg-panel)" }}>
              <strong>{v.name}</strong> — {v.summary}
              <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{v.requirementIds.join(", ")}</div>
            </div>
          ))}
        </div>
      ) : null}
      {requirements.map((r) => (
        <div key={r.id} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <h4 style={{ margin: 0 }}>{r.title}</h4>
              <ProvenanceBadge kind="computed" label={`${r.priority}`} />
              <code style={{ fontSize: "12px", color: "var(--text-muted)" }}>{r.id}</code>
            </div>
            {onJumpToTests ? (
              <button
                type="button"
                onClick={() => onJumpToTests(r.id)}
                className="btn btn-ghost"
                style={{ fontSize: "12px", padding: "2px 8px" }}
                title={`${t.viewTestCases} ${r.id}`}
              >
                {t.testCases} →
              </button>
            ) : null}
          </div>
          <p style={{ margin: "4px 0" }}>{r.description}</p>
          <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
            {t.reviewId}: <ReviewIdList reviewIds={r.sourceReviewIds} onJumpToReview={onJumpToReview} t={t} limit={5} />
          </p>
          <div style={{ margin: "4px 0 2px" }}>
            <ProvenanceBadge kind="computed" label={t.acceptanceCriteriaProvenance} />
          </div>
          <ul style={{ margin: "4px 0", fontSize: "13px", paddingLeft: "20px" }}>
            {r.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>

      ))}
      {assumptions.length > 0 ? (
        <div>
          <h4>{t.assumptions}</h4>
          {assumptions.map((a) => (
            <div key={a.id} style={{ padding: "8px", border: "1px dashed var(--border)", borderRadius: "6px", marginBottom: "6px", background: "var(--bg-panel)" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
                <ProvenanceBadge kind="assumption" label={t.assumptions} />
                <strong>{a.text}</strong>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{a.basis}</div>
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
        // Legacy cached artifacts predate the direct Finding/Priority contract;
        // derive the missing fields from the requirements at the display edge
        // without mutating the bundled fixture.
        const findingIds = test.findingIds ?? findingIdsForRequirements(test.requirementIds, requirements);
        const priority = test.priority ?? priorityForRequirements(test.requirementIds, requirements) ?? "P2";
        return (
          <div key={test.id} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <h4 style={{ margin: 0 }}>{test.id}</h4>
                <ProvenanceBadge kind="ai-generated" label={t.aiGenerated} />
                <ProvenanceBadge kind="computed" label={`${t.priority}: ${priority}`} />
              </div>
              {onJumpToPrd ? (
                <button
                  type="button"
                  onClick={() => onJumpToPrd(test.requirementIds[0])}
                  className="btn btn-ghost"
                  style={{ fontSize: "12px", padding: "2px 8px" }}
                  title={t.viewPrdRequirement}
                >
                  PRD →
                </button>
              ) : null}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {t.requirementId}: {test.requirementIds.join(", ")} · {t.findingId}: {findingIds.join(", ")} · {t.reviewId}:{" "}
              <ReviewIdList reviewIds={test.sourceReviewIds} onJumpToReview={onJumpToReview} t={t} limit={4} />
            </p>
            <p style={{ margin: "4px 0", fontSize: "13px" }}>
              <strong>{t.precondition}:</strong> {test.precondition || "—"}
            </p>
            <ol style={{ margin: "4px 0", fontSize: "13px", paddingLeft: "20px" }}>
              {test.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p style={{ margin: 0, fontSize: "13px" }}>
              <strong>{t.expected}:</strong> {test.expectedResult}
            </p>
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

  // En revision is not the end of the story: when a later (final) validation
  // passed after an automatic revision, the draft failure is contextualized
  // instead of read as the run having failed.
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
      ? "rgba(74,222,128,0.08)"
      : closureStatus === "partial" || closureStatus === "assumption-only"
        ? "var(--warn-soft)"
        : revisedAndFixed
          ? "var(--warn-soft)"
          : "rgba(248,113,113,0.08)";

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
      {/* Verification Status */}
      {report ? (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: statusBackground,
            border: `1px solid ${statusColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: statusColor,
              }}
            />
            <strong style={{ color: statusColor }}>{statusLabel}</strong>
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
            padding: "8px 12px",
            border: "1px solid var(--danger)",
            borderRadius: "6px",
            background: "rgba(248,113,113,0.05)",
            fontSize: "13px",
          }}
        >
          <code style={{ color: "var(--danger)", fontWeight: 600 }}>{v.code}</code>: {v.message}
        </div>
      ))}

      {/* End-to-End Traceability Matrix */}
      {findings.length > 0 || requirements.length > 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", background: "var(--bg-panel)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", fontWeight: 600, fontSize: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t.traceMatrixTitle}</span>
            <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}>{t.traceMatrixSubtitle}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", width: "30%" }}>{t.traceColFinding}</th>
                  <th style={{ padding: "10px 12px", width: "18%" }}>{t.traceColReviews}</th>
                  <th style={{ padding: "10px 12px", width: "26%" }}>{t.traceColRequirement}</th>
                  <th style={{ padding: "10px 12px", width: "16%" }}>{t.traceColTests}</th>
                  <th style={{ padding: "10px 12px", width: "10%" }}>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => {
                  // The matrix joins only on the declared findingIds links —
                  // the same single source of truth the validator enforces.
                  const relatedReqs = requirements.filter((r) => r.findingIds.includes(f.id));
                  const relatedReqIds = relatedReqs.map((r) => r.id);
                  // Legacy cached tests predate findingIds; derive them the
                  // same way the TestsPanel does instead of guessing through
                  // requirement overlap.
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
                    <tr
                      key={f.id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        verticalAlign: "top",
                      }}
                    >
                      <td style={{ padding: "12px" }}>
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
                      <td style={{ padding: "12px" }}>
                        <ReviewIdList
                          reviewIds={f.supportingReviewIds}
                          onJumpToReview={onJumpToReview}
                          t={t}
                          limit={3}
                        />
                      </td>
                      <td style={{ padding: "12px" }}>
                        {relatedReqs.length > 0 ? (
                          relatedReqs.map((r) => (
                            <div key={r.id} style={{ marginBottom: "6px" }}>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{r.id}</span>
                              <span style={{ fontSize: "11px", padding: "1px 5px", borderRadius: "4px", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
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
                      <td style={{ padding: "12px" }}>
                        {matchedTests.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {matchedTests.map((tc) => (
                              <span
                                key={tc.id}
                                onClick={() => onJumpToTests?.(relatedReqIds[0])}
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: "var(--bg-elevated)",
                                  border: "1px solid var(--border)",
                                  cursor: onJumpToTests ? "pointer" : "default",
                                  color: onJumpToTests ? "var(--accent)" : "inherit",
                                }}
                                title={t.viewTestCases}
                              >
                                {tc.id}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            ...(traceStatus === "violation"
                              ? { background: "rgba(248,113,113,0.12)", color: "var(--danger)", border: "1px solid rgba(248,113,113,0.3)" }
                              : traceStatus === "insufficient"
                                ? { background: "rgba(251,191,36,0.12)", color: "var(--warn)", border: "1px solid rgba(251,191,36,0.3)" }
                                : traceStatus === "missing-test"
                                  ? { background: "rgba(251,191,36,0.12)", color: "var(--warn)", border: "1px solid rgba(251,191,36,0.3)" }
                                  : traceStatus === "uncovered"
                                    ? { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }
                                    : { background: "rgba(74,222,128,0.12)", color: "var(--ok)", border: "1px solid rgba(74,222,128,0.3)" }),
                          }}
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
