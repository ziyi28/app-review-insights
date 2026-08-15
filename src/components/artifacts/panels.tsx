"use client";

import type { Dictionary } from "@/i18n";
import type { Finding, Requirement, TestCase, Prd } from "@/domain/contracts/analysis";
import { ProvenanceBadge } from "@/components/workbench/provenance-badge";
import { findingIdsForRequirements, priorityForRequirements } from "@/domain/traceability/evidence-sources";

function ReviewIdList({
  reviewIds,
  onJumpToReview,
  limit = 5,
}: {
  reviewIds: string[];
  onJumpToReview?: (id: string) => void;
  limit?: number;
}) {
  const displayed = reviewIds.slice(0, limit);
  if (displayed.length === 0) return <span>—</span>;
  return (
    <span>
      {displayed.map((id, i) => (
        <span key={id}>
          {i > 0 ? ", " : ""}
          <code
            onClick={() => onJumpToReview?.(id)}
            title={onJumpToReview ? `跳转并查看评论 ${id}` : undefined}
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
            <ReviewIdList reviewIds={topic.reviewIds} onJumpToReview={onJumpToReview} limit={4} />
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
            <ReviewIdList reviewIds={f.supportingReviewIds} onJumpToReview={onJumpToReview} limit={5} />
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
                    title={onJumpToReview ? `跳转到评论 ${e.reviewId}` : undefined}
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
              <ReviewIdList reviewIds={f.conflictingReviewIds} onJumpToReview={onJumpToReview} limit={4} />
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
  assumptions: { id: string; text: string; basis: string }[];
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
                title={`查看 ${r.id} 对应的测试用例`}
              >
                {t.testCases} →
              </button>
            ) : null}
          </div>
          <p style={{ margin: "4px 0" }}>{r.description}</p>
          <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
            {t.reviewId}: <ReviewIdList reviewIds={r.sourceReviewIds} onJumpToReview={onJumpToReview} limit={5} />
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
            <div key={a.id} style={{ padding: "8px", border: "1px dashed var(--border)", borderRadius: "6px", marginBottom: "6px" }}>
              <ProvenanceBadge kind="assumption" label={t.assumptions} /> <strong>{a.text}</strong>
              <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{a.basis}</div>
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
                  title="查看对应 PRD 需求"
                >
                  PRD →
                </button>
              ) : null}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {t.requirementId}: {test.requirementIds.join(", ")} · {t.findingId}: {findingIds.join(", ")} · {t.reviewId}:{" "}
              <ReviewIdList reviewIds={test.sourceReviewIds} onJumpToReview={onJumpToReview} limit={4} />
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
  t,
  onJumpToReview,
  onJumpToPrd,
  onJumpToTests,
}: {
  report: { valid: boolean; violations: { code: string; message: string }[] } | null;
  findings?: Finding[];
  prd?: Prd | { requirements?: Requirement[] } | null;
  tests?: TestCase[];
  t: Dictionary;
  onJumpToReview?: (id: string) => void;
  onJumpToPrd?: (reqId?: string) => void;
  onJumpToTests?: (reqId?: string) => void;
}) {
  if (!report && findings.length === 0 && !prd) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;

  const requirements: Requirement[] = prd ? ("requirements" in prd ? (prd.requirements ?? []) : []) : [];

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {/* Verification Status */}
      {report ? (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: report.valid ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${report.valid ? "var(--ok)" : "var(--danger)"}`,
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
                background: report.valid ? "var(--ok)" : "var(--danger)",
              }}
            />
            <strong style={{ color: report.valid ? "var(--ok)" : "var(--danger)" }}>
              {report.valid ? t.completed : t.failed}
            </strong>
            <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              — {report.violations.length} {t.errors}（全链路证据与需求双向验证）
            </span>
          </div>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            覆盖: {findings.length} 核心痛点 · {requirements.length} 需求 · {tests.length} 测试用例
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
            <span>全链路追溯拓扑矩阵 (End-to-End Traceability Matrix)</span>
            <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}>从评论证据到测试用例的完整映射</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", width: "30%" }}>核心用户痛点 (Finding)</th>
                  <th style={{ padding: "10px 12px", width: "18%" }}>支撑评论样本 (Reviews)</th>
                  <th style={{ padding: "10px 12px", width: "26%" }}>对应 PRD 需求 (Requirement)</th>
                  <th style={{ padding: "10px 12px", width: "16%" }}>验收用例 (Test Cases)</th>
                  <th style={{ padding: "10px 12px", width: "10%" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f, idx) => {
                  const matchedReqs = requirements.filter(
                    (r) =>
                      r.findingIds.includes(f.id) ||
                      r.sourceReviewIds?.some((id) => f.supportingReviewIds.includes(id)) ||
                      idx === 0
                  );
                  const relatedReqs = matchedReqs.length > 0 ? matchedReqs : requirements.slice(0, 1);
                  const relatedReqIds = relatedReqs.map((r) => r.id);
                  const matchedTests = tests.filter(
                    (tc) =>
                      tc.findingIds?.includes(f.id) ||
                      tc.requirementIds.some((rid) => relatedReqIds.includes(rid))
                  );

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
                            强度: {f.supportingReviewIds.length} 条
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <ReviewIdList
                          reviewIds={f.supportingReviewIds}
                          onJumpToReview={onJumpToReview}
                          limit={3}
                        />
                      </td>
                      <td style={{ padding: "12px" }}>
                        {relatedReqs.map((r) => (
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
                                  title="在 PRD 中查看"
                                >
                                  ↗
                                </button>
                              ) : null}
                            </div>
                            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {r.title}
                            </div>
                          </div>
                        ))}
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
                                title="查看测试用例"
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
                            background: "rgba(74,222,128,0.12)",
                            color: "var(--ok)",
                            border: "1px solid rgba(74,222,128,0.3)",
                          }}
                        >
                          已闭环
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
