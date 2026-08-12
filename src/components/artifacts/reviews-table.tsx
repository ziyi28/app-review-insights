"use client";

import { useMemo, useState } from "react";
import type { NormalizedReview } from "@/domain/contracts/review";
import type { Dictionary } from "@/i18n";
import { ProvenanceBadge } from "@/components/workbench/provenance-badge";

export function ReviewsTable({ reviews, t }: { reviews: NormalizedReview[]; t: Dictionary }) {
  const [query, setQuery] = useState("");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      reviews.filter((r) => {
        if (query && !r.bodyNormalized.includes(query.toLowerCase()) && !r.bodyOriginal.toLowerCase().includes(query.toLowerCase())) return false;
        if (ratingFilter !== "all" && r.rating !== Number(ratingFilter)) return false;
        if (statusFilter === "unique" && r.dedupeStatus !== "unique") return false;
        if (statusFilter === "duplicate" && r.dedupeStatus !== "duplicate") return false;
        if (statusFilter === "conflict" && r.dedupeStatus !== "identity-conflict") return false;
        return true;
      }),
    [reviews, query, ratingFilter, statusFilter],
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <input placeholder={t.reviewId} value={query} onChange={(e) => setQuery(e.target.value)} style={{ padding: "6px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }} />
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
            {filtered.map((r) => (
              <tr key={r.reviewId} onClick={() => setExpanded(expanded === r.reviewId ? null : r.reviewId)} style={{ cursor: "pointer" }}>
                <td>
                  <code>{r.reviewId.slice(0, 8)}</code>
                </td>
                <td>{r.rating}★</td>
                <td>{r.version ?? "—"}</td>
                <td>{r.language}</td>
                <td>
                  <ProvenanceBadge kind="computed" label={r.dedupeStatus} />
                </td>
                <td>{r.bodyOriginal.slice(0, 120)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expanded ? (
        <div style={{ marginTop: "10px", padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-panel)" }}>
          {(() => {
            const r = reviews.find((x) => x.reviewId === expanded);
            return r ? (
              <>
                <h4>{t.title}: {r.titleOriginal || "—"}</h4>
                <p>
                  <strong>{t.body}:</strong> {r.bodyOriginal}
                </p>
                <p style={{ color: "var(--text-muted)" }}>
                  <strong>{t.normalized}:</strong> {r.bodyNormalized}
                </p>
                <p style={{ color: "var(--text-muted)" }}>
                  <strong>{t.sourceId}:</strong> {r.sourceReviewId} · <strong>{t.source}:</strong> {r.rawRef}
                </p>
              </>
            ) : null;
          })()}
        </div>
      ) : null}
    </div>
  );
}
