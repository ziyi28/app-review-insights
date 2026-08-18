import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { getDictionary } from "@/i18n";
import { TestsPanel, FindingsPanel, TraceabilityPanel } from "./panels";
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

  it("calls onJumpToReview when a review code is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onJumpToReview = vi.fn();
    render(<FindingsPanel findings={[sufficientFinding]} t={t} onJumpToReview={onJumpToReview} />);
    const code = screen.getAllByText("review-1")[0];
    fireEvent.click(code);
    expect(onJumpToReview).toHaveBeenCalledWith("review-1");
  });
});

describe("TraceabilityPanel", () => {
  const makeFinding = (id: string): Finding => ({
    id,
    topicIds: [],
    focusAreaIds: [],
    sourceFindingIds: [],
    title: `Finding ${id}`,
    summary: `${id} summary`,
    supportingReviewIds: [`${id}-review`],
    supportingSampleCount: 1,
    evidenceExcerpts: [{ reviewId: `${id}-review`, excerpt: "text" }],
    conflictingReviewIds: [],
    confidence: { level: "medium", method: "deterministic-v1", reasons: [] },
    evidenceSufficiency: {
      status: "sufficient",
      corpusReviewCount: 10,
      supportRatio: 0.1,
      reasons: [],
    },
    uncertainties: [],
    limitations: [],
  });
  const makeRequirement = (id: string, findingIds: string[]): Requirement => ({
    id,
    findingIds,
    title: `Requirement ${id}`,
    description: `${id} description`,
    sourceReviewIds: findingIds.flatMap((fid) => [`${fid}-review`]),
    priority: "P1",
    acceptanceCriteria: ["criterion"],
    versionId: null,
  });
  const makeTest = (id: string, requirementIds: string[], findingIds: string[]): TestCase => ({
    id,
    requirementIds,
    findingIds,
    sourceReviewIds: findingIds.flatMap((fid) => [`${fid}-review`]),
    testType: "manual",
    precondition: "",
    steps: ["step"],
    expectedResult: "ok",
    priority: "P1",
  });

  const finding1 = makeFinding("finding-1");
  const finding2 = makeFinding("finding-2");
  const finding3 = makeFinding("finding-3");
  const req1 = makeRequirement("req-1", ["finding-1"]);
  const req2 = makeRequirement("req-2", ["finding-2"]);

  const rows = () => screen.getAllByRole("row").slice(1); // skip thead

  it("maps each finding only to the requirements whose findingIds cite it", () => {
    render(
      <TraceabilityPanel
        report={{ valid: true, violations: [] }}
        findings={[finding1, finding2]}
        prd={{ requirements: [req1, req2] }}
        tests={[]}
        t={t}
      />,
    );
    const [row1, row2] = rows();
    expect(within(row1).getByText("req-1")).toBeInTheDocument();
    expect(within(row1).queryByText("req-2")).not.toBeInTheDocument();
    expect(within(row2).getByText("req-2")).toBeInTheDocument();
    expect(within(row2).queryByText("req-1")).not.toBeInTheDocument();
  });

  it("derives legacy test findingIds from requirements when matching test columns", () => {
    const legacy = { ...makeTest("test-legacy", ["req-1"], []) };
    delete (legacy as Partial<TestCase>).findingIds;
    render(
      <TraceabilityPanel
        report={{ valid: true, violations: [] }}
        findings={[finding1]}
        prd={{ requirements: [req1] }}
        tests={[legacy as TestCase]}
        t={t}
      />,
    );
    expect(within(rows()[0]).getByText("test-legacy")).toBeInTheDocument();
    expect(within(rows()[0]).getByText(t.traceStatusClosed)).toBeInTheDocument();
  });

  it("shows a violation status when a report violation targets the finding", () => {
    render(
      <TraceabilityPanel
        report={{ valid: false, violations: [{ code: "X", message: "boom", entity: "finding-1" }] }}
        findings={[finding1]}
        prd={{ requirements: [req1] }}
        tests={[makeTest("test-1", ["req-1"], ["finding-1"])]}
        t={t}
      />,
    );
    expect(within(rows()[0]).getByText(t.traceStatusViolation)).toBeInTheDocument();
    expect(within(rows()[0]).queryByText(t.traceStatusClosed)).not.toBeInTheDocument();
  });

  it("contextualizes an invalid draft as auto-revised when the final validation passed", () => {
    render(
      <TraceabilityPanel
        report={{ valid: false, violations: [{ code: "X", message: "boom", entity: "finding-1" }] }}
        findings={[finding1]}
        prd={{ requirements: [req1] }}
        tests={[]}
        t={t}
        revisedAndValid
      />,
    );
    expect(screen.getByText(/auto-revised & passed/)).toBeInTheDocument();
    expect(screen.queryByText(t.failed)).not.toBeInTheDocument();
    // The violations themselves remain visible (they are the draft's record).
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("keeps the plain failed label when an invalid draft was never revised", () => {
    render(
      <TraceabilityPanel
        report={{ valid: false, violations: [{ code: "X", message: "boom", entity: "finding-1" }] }}
        findings={[finding1]}
        prd={{ requirements: [req1] }}
        tests={[]}
        t={t}
      />,
    );
    expect(screen.getByText(t.failed)).toBeInTheDocument();
  });

  it("shows a missing-test status for a finding with requirements but no covering test", () => {
    render(
      <TraceabilityPanel
        report={{ valid: true, violations: [] }}
        findings={[finding1]}
        prd={{ requirements: [req1] }}
        tests={[]}
        t={t}
      />,
    );
    expect(within(rows()[0]).getByText(t.traceStatusMissingTest)).toBeInTheDocument();
  });

  it("shows an uncovered status and no requirement for a finding no requirement cites", () => {
    render(
      <TraceabilityPanel
        report={{ valid: true, violations: [] }}
        findings={[finding1, finding3]}
        prd={{ requirements: [req1] }}
        tests={[]}
        t={t}
      />,
    );
    const [, row3] = rows();
    expect(within(row3).getByText(t.traceStatusUncovered)).toBeInTheDocument();
    expect(within(row3).queryByText("req-1")).not.toBeInTheDocument();
    expect(within(rows()[0]).getByText(t.traceStatusMissingTest)).toBeInTheDocument();
  });
});
