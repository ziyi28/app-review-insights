import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { getDictionary } from "@/i18n";
import { RatingDistribution, VersionDistribution, LanguageDistribution } from "./stats-panels";

const t = getDictionary("en");

describe("RatingDistribution", () => {
  it("renders one row per star with the star label and count", () => {
    const distribution: Record<number, number> = { 1: 3, 2: 0, 3: 5, 4: 2, 5: 10 };
    render(<RatingDistribution distribution={distribution} t={t} />);
    // Five rows (one per star); counts appear as text.
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1 Rating")).toBeInTheDocument();
    expect(screen.getByText("5 Rating")).toBeInTheDocument();
  });

  it("renders zero-count bars for every star even when all counts are zero", () => {
    render(<RatingDistribution distribution={{ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }} t={t} />);
    // All five star rows still render, each with a zero count.
    expect(screen.getAllByText("0")).toHaveLength(5);
    expect(screen.getByText("3 Rating")).toBeInTheDocument();
  });
});

describe("VersionDistribution", () => {
  it("sorts versions by count descending and renders counts", () => {
    const distribution = { "8.1": 2, "8.2": 9, "8.0": 4 };
    render(<VersionDistribution distribution={distribution} t={t} />);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("8.2")).toBeInTheDocument();
  });

  it("truncates to the top N versions", () => {
    const distribution = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`v${i}`, 1]));
    render(<VersionDistribution distribution={distribution} t={t} />);
    // Top 8 only; v11 (index 11) is cut.
    expect(screen.queryByText("v11")).not.toBeInTheDocument();
    expect(screen.getByText("v0")).toBeInTheDocument();
  });
});

describe("LanguageDistribution", () => {
  it("sorts languages by count descending", () => {
    const distribution = { en: 20, zh: 3, es: 7 };
    render(<LanguageDistribution distribution={distribution} t={t} />);
    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("renders no data when the distribution is empty", () => {
    render(<LanguageDistribution distribution={{}} t={t} />);
    expect(screen.getByText(t.noData)).toBeInTheDocument();
  });
});
