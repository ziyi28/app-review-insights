import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { getDictionary } from "@/i18n";
import { TestsPanel, FindingsPanel } from "./panels";
import type { Finding, Requirement, TestCase } from "@/domain/contracts/analysis";

const t = getDictionary("en");

const requirement: Requirement = {
  id: "req-1",
  findingIds: ["finding-1"],
  title: "Preserve timer state",
  description: "Keep timer after backgrounding",
  sourceReviewIds: ["review-1"],
  priority: "P1",
  acceptanceCriteria: ["timer persists"],
  versionId: null,
};

const testCase: TestCase = {
  id: "test-1",
  requirementIds: ["req-1"],
  findingIds: ["finding-1"],
  sourceReviewIds: ["review-1"],
  testType: "manual",
  precondition: "signed in",
  steps: ["start workout", "background the app"],
  expectedResult: "timer keeps running",
  priority: "P1",
};

describe("TestsPanel", () => {
  it("renders requirement ids, finding ids, priority, precondition and steps for a new artifact", () => {
    render(<TestsPanel tests={[testCase]} requirements={[requirement]} t={t} />);
    expect(screen.getByText(/req-1/)).toBeInTheDocument();
    expect(screen.getByText(/finding-1/)).toBeInTheDocument();
    expect(screen.getByText(/review-1/)).toBeInTheDocument();
    expect(screen.getByText(/P1/)).toBeInTheDocument();
    expect(screen.getByText(/signed in/)).toBeInTheDocument();
    expect(screen.getByText(/timer keeps running/)).toBeInTheDocument();
  });

  it("derives missing finding ids and priority for a legacy cached test case", () => {
    // Old cached artifacts were produced before the direct Finding/Priority
    // contract; the UI derives them from the requirements without mutating the
    // bundled fixture.
    const legacy = {
      id: "test-legacy",
      requirementIds: ["req-1"],
      sourceReviewIds: ["review-1"],
      testType: "manual" as const,
      precondition: "",
      steps: ["open app"],
      expectedResult: "ok",
    };
    render(<TestsPanel tests={[legacy as TestCase]} requirements={[requirement]} t={t} />);
    expect(screen.getByText(/finding-1/)).toBeInTheDocument();
    expect(screen.getByText(/P1/)).toBeInTheDocument();
    expect(screen.getByText(/req-1/)).toBeInTheDocument();
  });
});

describe("FindingsPanel", () => {
  const sufficientFinding: Finding = {
    id: "finding-1",
    topicIds: ["topic-1"],
    focusAreaIds: [],
    sourceFindingIds: [],
    title: "Pricing complaints",
    summary: "Users dislike the subscription cost",
    supportingReviewIds: ["review-1", "review-2"],
    supportingSampleCount: 2,
    evidenceExcerpts: [{ reviewId: "review-1", excerpt: "too expensive" }],
    conflictingReviewIds: [],
    confidence: { level: "low", method: "deterministic-v1", reasons: ["small sample"] },
    evidenceSufficiency: {
      status: "insufficient",
      corpusReviewCount: 3000,
      supportRatio: 2 / 3000,
      reasons: ["SUPPORT_BELOW_MINIMUM", "SUPPORT_RATIO_BELOW_MINIMUM"],
    },
    uncertainties: [],
    limitations: [],
  };

  it("shows the sufficiency badge and support ratio for a new finding", () => {
    const { container } = render(<FindingsPanel findings={[sufficientFinding]} t={t} />);
    expect(screen.getByText(/Insufficient Evidence/i)).toBeInTheDocument();
    // <strong>2</strong> / 3000 splits the ratio text across elements, so
    // assert on the panel's normalized text content.
    expect(container.textContent).toContain("2 / 3000");
    expect(container.textContent).toContain("0.0007");
    expect(container.textContent).toContain("SUPPORT_BELOW_MINIMUM");
  });

  it("keeps showing confidence only when evidenceSufficiency is absent (legacy cache)", () => {
    const legacy = { ...sufficientFinding } as Partial<Finding> & Record<string, unknown>;
    delete legacy.evidenceSufficiency;
    render(<FindingsPanel findings={[legacy as unknown as Finding]} t={t} />);
    expect(screen.queryByText(/Insufficient Evidence/i)).not.toBeInTheDocument();
    // Legacy artifacts still show the confidence badge.
    expect(screen.getByText(/low/i)).toBeInTheDocument();
  });
});
