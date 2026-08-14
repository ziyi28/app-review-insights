"use client";

import type { Dictionary } from "@/i18n";

type Bar = { label: string; count: number; color: string };

/**
 * A dependency-free horizontal bar list. Bars are scaled relative to the
 * largest count so a distribution renders correctly without a chart library.
 * Uses the same dark desktop-workbench tokens as the rest of the UI.
 */
function BarList({ bars, t }: { bars: Bar[]; t: Dictionary }) {
  if (bars.length === 0) return <p style={{ color: "var(--text-muted)" }}>{t.noData}</p>;
  const max = Math.max(...bars.map((b) => b.count), 0);
  return (
    <div className="bar-list">
      {bars.map((b) => (
        <div key={b.label} className="bar-row">
          <span className="bar-label">{b.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: max > 0 ? `${(b.count / max) * 100}%` : "0%", background: b.color }}
            />
          </span>
          <span className="bar-count">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Semantic color per star: 5 green → 1 red. */
const RATING_COLORS: Record<number, string> = {
  5: "var(--ok)",
  4: "var(--accent)",
  3: "var(--info)",
  2: "var(--warn)",
  1: "var(--danger)",
};

/** Top-N most frequent versions, most frequent first. */
const VERSION_TOP_N = 8;

export function RatingDistribution({ distribution, t }: { distribution: Record<number, number>; t: Dictionary }) {
  const bars: Bar[] = [1, 2, 3, 4, 5].map((star) => ({
    label: `${star} ${t.rating}`,
    count: distribution[star] ?? 0,
    color: RATING_COLORS[star],
  }));
  return <BarList bars={bars} t={t} />;
}

export function VersionDistribution({ distribution, t }: { distribution: Record<string, number>; t: Dictionary }) {
  const bars: Bar[] = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, VERSION_TOP_N)
    .map(([version, count]) => ({ label: version, count, color: "var(--accent)" }));
  return <BarList bars={bars} t={t} />;
}

export function LanguageDistribution({ distribution, t }: { distribution: Record<string, number>; t: Dictionary }) {
  const bars: Bar[] = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => ({ label: language, count, color: "var(--info)" }));
  return <BarList bars={bars} t={t} />;
}
