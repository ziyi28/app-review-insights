import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { getDictionary } from "@/i18n";
import type { RunEvent } from "@/domain/contracts/events";
import type { VersionPlanArtifact, Prd, PlanningFactors } from "@/domain/contracts/analysis";
import type { TraceabilityReport } from "@/domain/traceability/validate";
import type { RunManifest } from "@/server/runs/run-store";
import type { EvidenceValidationReport } from "@/domain/analysis/evidence-validation";
import {
  ClassificationPanel,
  EvidenceValidationPanel,
  VersionPlanPanel,
  RunDiagnosticsPanel,
  ArtifactPhaseSelector,
  FinalDeliverablesPanel,
} from "./workflow-panels";

afterEach(() => {
  vi.unstubAllGlobals();
});

const t = getDictionary("en");

function event(type: RunEvent["type"], stage: string | undefined, data: unknown): RunEvent {
  return {
    protocolVersion: "1",
    sequence: 1,
    eventId: `evt-${Math.random()}`,
    runId: "run-1",
    timestamp: "2026-08-12T00:00:00Z",
    deliveryMode: "live",
    type,
    stage: stage as never,
    data,
  };
}

const FACTORS: PlanningFactors = {
  severity: "critical",
  evidenceStrength: "high",
  confidence: "high",
  userImpact: "high",
  frequency: { supportingReviewCount: 40, corpusReviewCount: 100, supportRatio: 0.4 },
  implementationScope: "medium",
  dependencyRequirementIds: ["req-2"],
  rationale: "Critical, high-impact, high-confidence evidence",
};

describe("ClassificationPanel", () => {
  it("shows candidate label, exact quote and review ids", () => {
    const onJumpToReview = vi.fn();
    render(
      <ClassificationPanel
        t={t}
        candidates={[
          { id: "topic-candidate-1", label: "Workout quality", description: "d", supportingReviewIds: ["r1", "r2"], quote: "workout variety" },
        ]}
        onJumpToReview={onJumpToReview}
      />,
    );
    expect(screen.getByText("Workout quality")).toBeInTheDocument();
    expect(screen.getByText(/workout variety/)).toBeInTheDocument();
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(screen.getByText("r2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("r1"));
    expect(onJumpToReview).toHaveBeenCalledWith("r1");
  });
});

describe("EvidenceValidationPanel", () => {
  it("shows sufficient/insufficient/rejected counts and reasons", () => {
    const report: EvidenceValidationReport = {
      validFindingCount: 2,
      rejectedFindingCount: 1,
      sufficientCount: 1,
      insufficientCount: 1,
      findings: [
        { findingId: "finding-1", supportCount: 8, corpusCount: 100, supportRatio: 0.08, conflictCount: 1, confidence: "high", sufficiency: "sufficient", reasons: [] },
        { findingId: "finding-2", supportCount: 2, corpusCount: 100, supportRatio: 0.02, conflictCount: 0, confidence: "low", sufficiency: "insufficient", reasons: ["SUPPORT_BELOW_MINIMUM"] },
      ],
      rejected: [{ code: "UNSUPPORTED_FINDING", message: "dropped finding-3" }],
    };
    render(<EvidenceValidationPanel report={report} t={t} />);
    expect(screen.getByText(/finding-2/)).toBeInTheDocument();
    expect(screen.getByText(/SUPPORT_BELOW_MINIMUM/)).toBeInTheDocument();
    expect(screen.getByText(/UNSUPPORTED_FINDING/)).toBeInTheDocument();
    // counts rendered as stat cards (sufficient/insufficient/rejected = 1/1/1)
    expect(screen.getAllByText("1")).toHaveLength(3);
  });

  it("shows legacy text when the report is missing", () => {
    render(<EvidenceValidationPanel report={null} t={t} />);
    expect(screen.getByText(t.legacyArtifactUnavailable)).toBeInTheDocument();
  });
});

describe("VersionPlanPanel", () => {
  it("shows version rationale and each requirement's seven factors", () => {
    const artifact: VersionPlanArtifact = {
      versions: [{ id: "ver-1", name: "1.0.0", summary: "First", requirementIds: ["req-1"], rationale: "Ships the highest-impact fixes first" }],
      decisions: [
        { requirementId: "req-1", priority: "P0", versionId: "ver-1", planningFactors: FACTORS },
      ],
    };
    render(<VersionPlanPanel versionPlan={artifact} t={t} />);
    expect(screen.getByText(/Ships the highest-impact fixes first/)).toBeInTheDocument();
    expect(screen.getByText(/critical/)).toBeInTheDocument();
    expect(screen.getByText(/req-2/)).toBeInTheDocument();
  });

  it("shows legacy text when the version plan artifact is absent", () => {
    render(<VersionPlanPanel versionPlan={null} t={t} />);
    expect(screen.getByText(t.legacyArtifactUnavailable)).toBeInTheDocument();
  });

  it("shows noSchedulableRequirements when version plan has no versions", () => {
    render(<VersionPlanPanel versionPlan={{ versions: [], decisions: [] }} t={t} />);
    expect(screen.getByText(t.noSchedulableRequirements)).toBeInTheDocument();
  });
});

describe("RunDiagnosticsPanel", () => {
  it("groups events into Error, Warning, Validation and Revision", () => {
    const events: RunEvent[] = [
      event("run.failed", undefined, { error: "boom" }),
      event("stage.progress", "findings", { code: "UNSUPPORTED_FINDING", message: "dropped x" }),
      event("limitation.reported", "source", { code: "RSS_PARTIAL", message: "partial" }),
      event("validation.failed", "traceability", { violations: [] }),
      event("revision.started", "revision", { violations: [] }),
      event("revision.completed", "revision", { note: "fixed" }),
    ];
    render(<RunDiagnosticsPanel events={events} t={t} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.getByText(/UNSUPPORTED_FINDING/)).toBeInTheDocument();
    expect(screen.getByText(/RSS_PARTIAL/)).toBeInTheDocument();
    expect(screen.getAllByText(/validation.failed/)).not.toHaveLength(0);
    expect(screen.getAllByText(/revision.started/)).not.toHaveLength(0);
  });

  it("does not group a user cancellation as an error", () => {
    const events: RunEvent[] = [event("run.failed", undefined, { error: "Analysis was cancelled by user", cancelled: true })];
    render(<RunDiagnosticsPanel events={events} t={t} />);
    expect(screen.queryByText(/Analysis was cancelled by user/)).not.toBeInTheDocument();
  });
});

describe("ArtifactPhaseSelector", () => {
  it("shows Draft and Final buttons when revised", () => {
    const onSelect = vi.fn();
    render(<ArtifactPhaseSelector revised phase="draft" onSelect={onSelect} t={t} />);
    expect(screen.getByRole("button", { name: t.draft })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.final })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.final }));
    expect(onSelect).toHaveBeenCalledWith("final");
  });

  it("shows no-revision text when not revised", () => {
    render(<ArtifactPhaseSelector revised={false} phase="draft" onSelect={() => {}} t={t} />);
    expect(screen.getByText(t.noRevisionRequired)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.draft })).toBeNull();
  });
});

describe("FinalDeliverablesPanel", () => {
  const prd: Prd = {
    outputLocale: "en",
    title: "Plan",
    overview: "x",
    findings: [],
    requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "x", description: "d", sourceReviewIds: ["r1"], priority: "P1", acceptanceCriteria: ["c"], versionId: "ver-1" }],
    versions: [{ id: "ver-1", name: "1.0.0", summary: "s", requirementIds: ["req-1"], rationale: "r" }],
    tests: [{ id: "test-1", requirementIds: ["req-1"], findingIds: ["finding-1"], sourceReviewIds: ["r1"], testType: "manual", precondition: "", steps: ["s"], expectedResult: "ok", priority: "P1" }],
    assumptions: [],
  };
  const report: TraceabilityReport = { valid: true, closureStatus: "closed", violations: [] };
  const manifest: RunManifest = {
    runId: "run-1",
    status: "completed",
    executionMode: "live",
    createdAt: "2026-08-12T00:00:00Z",
    updatedAt: "2026-08-12T00:00:00Z",
    stages: {},
    artifacts: {},
    limitations: [{ code: "UNKNOWN_LIMITATION", message: "partial feed" }],
    canReplay: true,
    modelUsage: { calls: 6, attempts: 6, retries: 0, retryReasons: [], promptVersions: ["planning@2"] },
  };

  it("shows final counts, traceability status, limitations and model metadata", () => {
    render(<FinalDeliverablesPanel finalPrd={prd} report={report} manifest={manifest} t={t} />);
    // versions/requirements/tests counts each render a "1"
    expect(screen.getAllByText("1")).toHaveLength(3);
    expect(screen.getByText(new RegExp(t.completed))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t.traceClosureClosed))).toBeInTheDocument();
    expect(screen.getByText(/UNKNOWN_LIMITATION/)).toBeInTheDocument();
    expect(screen.getByText(/partial feed/)).toBeInTheDocument();
    expect(screen.getByText(/planning@2/)).toBeInTheDocument();
  });

  it("renders duplicate manifest limitations once (legacy snapshots)", () => {
    const duplicated: RunManifest = {
      ...manifest,
      limitations: [
        { code: "UNKNOWN_LIMITATION", message: "partial feed" },
        { code: "UNKNOWN_LIMITATION", message: "partial feed" },
        { code: "UNKNOWN_LIMITATION", message: "other" },
      ],
    };
    render(<FinalDeliverablesPanel finalPrd={prd} report={report} manifest={duplicated} t={t} />);
    expect(screen.getAllByText("partial feed")).toHaveLength(1);
    expect(screen.getAllByText("other")).toHaveLength(1);
  });

  it("shows a computed-fallback for legacy manifests missing usage fields", () => {
    const legacy: RunManifest = { ...manifest, modelUsage: { calls: 6 } };
    render(<FinalDeliverablesPanel finalPrd={prd} report={report} manifest={legacy} t={t} />);
    expect(screen.getAllByText("6")).not.toHaveLength(0);
  });

  it("renders goal coverage items with covered/unsupported statuses", () => {
    const coverage = {
      valid: false,
      retried: true,
      items: [
        { focusAreaId: "focus-1", label: "Pricing", status: "covered" as const, findingIds: ["finding-1"], requirementIds: ["req-1"] },
        { focusAreaId: "focus-2", label: "Trial", status: "unsupported" as const, findingIds: [], requirementIds: [] },
        { focusAreaId: "focus-3", label: "Usability", status: "uncovered" as const, findingIds: ["finding-3"], requirementIds: [] },
      ],
    };
    render(<FinalDeliverablesPanel finalPrd={prd} report={report} manifest={manifest} goalCoverage={coverage} t={t} />);
    expect(screen.getByText(t.goalCoverage)).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("Trial")).toBeInTheDocument();
    expect(screen.getByText("Usability")).toBeInTheDocument();
    // covered / unsupported / uncovered labels each render.
    expect(screen.getAllByText(t.goalCoverageCovered).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.goalCoverageUnsupported).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.goalCoverageUncovered).length).toBeGreaterThan(0);
    // invalid report shows the coverage-gap badge.
    expect(screen.getByText(t.goalCoverageGap)).toBeInTheDocument();
  });

  it("renders goal coverage labels in Chinese", () => {
    const tZh = getDictionary("zh-CN");
    const coverage = {
      valid: true,
      retried: false,
      items: [{ focusAreaId: "focus-1", label: "价格", status: "covered" as const, findingIds: ["finding-1"], requirementIds: ["req-1"] }],
    };
    render(<FinalDeliverablesPanel finalPrd={prd} report={report} manifest={manifest} goalCoverage={coverage} t={tZh} />);
    expect(screen.getByText(tZh.goalCoverage)).toBeInTheDocument();
    expect(screen.getByText("价格")).toBeInTheDocument();
    expect(screen.getAllByText(tZh.goalCoverageCovered).length).toBeGreaterThan(0);
  });

  it("does not render the goal-coverage section for legacy runs without it", () => {
    render(<FinalDeliverablesPanel finalPrd={prd} report={report} manifest={manifest} t={t} />);
    expect(screen.queryByText(t.goalCoverage)).not.toBeInTheDocument();
  });
});
