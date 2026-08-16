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
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <input
            placeholder={t.reviewId}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            style={{ padding: "6px 28px 6px 10px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", minWidth: "240px" }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => handleQueryChange("")}
              title={t.clearSearch}
              style={{ position: "absolute", right: "6px", background: "none", border: "none", color: "var(--text-muted)", padding: "2px", fontSize: "12px", display: "flex", alignItems: "center" }}
            >
              ✕
            </button>
          ) : null}
        </div>
        <select aria-label="rating" value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)} style={{ padding: "6px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}>
          <option value="all">{t.rating} *</option>
          {[1, 2, 3, 4, 5].map((r) => (
            <option key={r} value={r}>
              {r}★
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "6px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}>
          <option value="all">{t.status}</option>
          <option value="unique">{t.status} · unique</option>
          <option value="duplicate">{t.status} · duplicate</option>
          <option value="conflict">{t.status} · conflict</option>
        </select>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t.reviewId}</th>
              <th>{t.rating}</th>
              <th>{t.version}</th>
              <th>{t.language}</th>
              <th>{t.status}</th>
              <th>{t.body}</th>
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
                    style={{ cursor: "pointer", background: isExpanded ? "var(--bg-elevated)" : undefined }}
                  >
                    <td>
                      <code
                        title={t.copyFullId}
                        onClick={(e) => copyId(r.reviewId, e)}
                        style={{ cursor: "copy" }}
                      >
                        {copiedId === r.reviewId ? "✓" : r.reviewId.slice(0, 8)}
                      </code>
                    </td>
                    <td>{r.rating}★</td>
                    <td>{r.version ?? "—"}</td>
                    <td>{r.language}</td>
                    <td>
                      <ProvenanceBadge kind="computed" label={r.dedupeStatus} />
                    </td>
                    <td>{r.bodyOriginal.slice(0, 120)}</td>
                  </tr>
                  {isExpanded ? (
                    <tr key={`${rowKey}-detail`}>
                      <td colSpan={6} style={{ padding: "12px 16px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "grid", gap: "6px" }}>
                          <h4 style={{ margin: "0 0 4px" }}>{t.title}: {r.titleOriginal || "—"}</h4>
                          <p style={{ margin: 0 }}>
                            <strong>{t.body}:</strong> {r.bodyOriginal}
                          </p>
                          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "13px" }}>
                            <strong>{t.normalized}:</strong> {r.bodyNormalized}
                          </p>
                          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "12px" }}>
                            <strong>{t.sourceId}:</strong> {r.sourceReviewId} · <strong>{t.source}:</strong> {r.rawRef} · <strong>{t.fullId}:</strong> <code>{r.reviewId}</code>
                          </p>
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
  );
}
