"use client";

import { Fragment, useMemo, useState } from "react";
import type { NormalizedReview } from "@/domain/contracts/review";
import type { Dictionary } from "@/i18n";
import { ProvenanceBadge } from "@/components/workbench/provenance-badge";

export function ReviewsTable({
  reviews,
  t,
  searchQuery,
  onSearchChange,
}: {
  reviews: NormalizedReview[];
  t: Dictionary;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}) {
  const [internalQuery, setInternalQuery] = useState("");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const query = searchQuery !== undefined ? searchQuery : internalQuery;
  const handleQueryChange = (val: string) => {
    setInternalQuery(val);
    onSearchChange?.(val);
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return reviews.filter((r) => {
      if (q) {
        const matchId =
          r.reviewId.toLowerCase().includes(q) ||
          (r.sourceReviewId && r.sourceReviewId.toLowerCase().includes(q));
        const matchBody =
          r.bodyNormalized.toLowerCase().includes(q) ||
          r.bodyOriginal.toLowerCase().includes(q) ||
          (r.titleOriginal && r.titleOriginal.toLowerCase().includes(q));
        if (!matchId && !matchBody) return false;
      }
      if (ratingFilter !== "all" && r.rating !== Number(ratingFilter)) return false;
      if (statusFilter === "unique" && r.dedupeStatus !== "unique") return false;
      if (statusFilter === "duplicate" && r.dedupeStatus !== "duplicate") return false;
      if (statusFilter === "conflict" && r.dedupeStatus !== "identity-conflict") return false;
      return true;
    });
  }, [reviews, query, ratingFilter, statusFilter]);

  // If query is an exact or single match, auto expand it
  const isSingleMatch = query.trim().length >= 6 && filtered.length === 1;
  const autoExpandedKey = isSingleMatch ? `${filtered[0].reviewId}:${filtered[0].rawRef}:0` : null;
  const activeExpanded = expanded ?? autoExpandedKey;

  const copyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", flex: "1 1 240px", maxWidth: "400px" }}>
          <input
            placeholder={t.reviewId}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="field"
            style={{ paddingRight: "30px" }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => handleQueryChange("")}
              title={t.clearSearch}
              style={{ position: "absolute", right: "8px", background: "none", border: "none", color: "var(--text-muted)", padding: "2px", fontSize: "12px", cursor: "pointer" }}
            >
              ✕
            </button>
          ) : null}
        </div>
        <select
          aria-label="rating"
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
          className="field"
          style={{ width: "auto", minWidth: "110px" }}
        >
          <option value="all">{t.rating} *</option>
          {[1, 2, 3, 4, 5].map((r) => (
            <option key={r} value={r}>
              {r}★
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="field"
          style={{ width: "auto", minWidth: "140px" }}
        >
          <option value="all">{t.status}</option>
          <option value="unique">{t.status} · unique</option>
          <option value="duplicate">{t.status} · duplicate</option>
          <option value="conflict">{t.status} · conflict</option>
        </select>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered.length} / {reviews.length} {t.supportCount}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                <th style={{ width: "14%" }}>{t.reviewId}</th>
                <th style={{ width: "8%" }}>{t.rating}</th>
                <th style={{ width: "10%" }}>{t.version}</th>
                <th style={{ width: "10%" }}>{t.language}</th>
                <th style={{ width: "12%" }}>{t.status}</th>
                <th style={{ width: "46%" }}>{t.body}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, index) => {
                const rowKey = `${r.reviewId}:${r.rawRef}:${index}`;
                const isExpanded = activeExpanded === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : rowKey)}
                      style={{ cursor: "pointer", background: isExpanded ? "var(--bg-hover)" : undefined }}
                    >
                      <td>
                        <code
                          title={t.copyFullId}
                          onClick={(e) => copyId(r.reviewId, e)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              copyId(r.reviewId, e as unknown as React.MouseEvent);
                            }
                          }}
                          className="code-badge"
                        >
                          {copiedId === r.reviewId ? "✓ Copied" : r.reviewId.slice(0, 8)}
                        </code>
                      </td>
                      <td style={{ fontWeight: 600, color: r.rating <= 2 ? "var(--danger)" : r.rating >= 4 ? "var(--ok)" : "var(--warn)" }}>
                        {r.rating}★
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>{r.version ?? "—"}</td>
                      <td style={{ color: "var(--text-muted)" }}>{r.language}</td>
                      <td>
                        <ProvenanceBadge kind="computed" label={r.dedupeStatus} />
                      </td>
                      <td style={{ color: "var(--text)", maxWidth: "420px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.bodyOriginal}
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${rowKey}-detail`}>
                        <td colSpan={6} style={{ padding: "16px 18px", background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ display: "grid", gap: "8px" }}>
                            <h4 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 600 }}>
                              {t.title}: {r.titleOriginal || "—"}
                            </h4>
                            <div className="quote-box" style={{ margin: 0 }}>
                              <p style={{ margin: 0 }}>{r.bodyOriginal}</p>
                            </div>
                            <div style={{ margin: 0, color: "var(--text-muted)", fontSize: "13px" }}>
                              <strong>{t.normalized}:</strong> {r.bodyNormalized}
                            </div>
                            <div style={{ margin: "4px 0 0", color: "var(--text-faint)", fontSize: "12px" }}>
                              <strong>{t.sourceId}:</strong> {r.sourceReviewId} · <strong>{t.source}:</strong> {r.rawRef} · <strong>{t.fullId}:</strong> <code>{r.reviewId}</code>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
