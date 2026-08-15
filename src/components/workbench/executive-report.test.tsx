import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ExecutiveReport } from "./executive-report";
import { getDictionary } from "@/i18n";
import type { Finding, Prd, VersionPlanArtifact } from "@/domain/contracts/analysis";
import type { RunManifest } from "@/server/runs/run-store";

const t = getDictionary("zh-CN");

const mockManifest: RunManifest = {
  runId: "run-1",
  status: "completed",
  executionMode: "live",
  goal: "优化学伴产品用户体验",
  appUrl: "https://apps.apple.com/app/id123456",
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:05.000Z",
  stages: {},
  artifacts: {},
  canReplay: true,
  limitations: [],
};

const mockFindings: Finding[] = [
  {
    id: "f-1",
    topicIds: ["t-1"],
    focusAreaIds: [],
    sourceFindingIds: [],
    title: "拍照答题识别率低且卡顿",
    summary: "大量用户反馈暗光下公式识别不准确。",
    confidence: { level: "high", method: "deterministic-v1", reasons: ["样本充分"] },
    supportingSampleCount: 15,
    supportingReviewIds: ["r-1", "r-2"],
    conflictingReviewIds: [],
    uncertainties: [],
    limitations: [],
    evidenceExcerpts: [{ reviewId: "r-1", excerpt: "拍数学公式老是报错" }],
    evidenceSufficiency: {
      status: "sufficient",
      corpusReviewCount: 100,
      supportRatio: 0.15,
      reasons: [],
    },
  },
];

const mockVersionPlan: VersionPlanArtifact = {
  versions: [
    {
      id: "v-1",
      name: "v1.0 MVP",
      summary: "修复识别核心问题",
      rationale: "优先解决最高频阻塞痛点",
      requirementIds: ["req-1"],
    },
  ],
  decisions: [],
};

const mockPrd: Prd = {
  outputLocale: "zh-CN",
  title: "学伴体验优化 PRD",
  overview: "学伴体验优化 PRD 概览",
  findings: mockFindings,
  versions: [
    {
      id: "v-1",
      name: "v1.0 MVP",
      summary: "修复识别核心问题",
      requirementIds: ["req-1"],
    },
  ],
  assumptions: [],
  requirements: [
    {
      id: "req-1",
      findingIds: ["f-1"],
      versionId: "v-1",
      title: "OCR 算法与暗光增强",
      description: "集成暗光曝光优化算法",
      priority: "P0",
      sourceReviewIds: ["r-1"],
      acceptanceCriteria: ["暗光场景识别准确率提升至 95%"],
    },
  ],
  tests: [
    {
      id: "tc-1",
      requirementIds: ["req-1"],
      findingIds: ["f-1"],
      sourceReviewIds: ["r-1"],
      testType: "automated",
      priority: "P0",
      precondition: "手机置于暗光环境",
      steps: ["启动拍照答题", "拍摄包含微积分公式的试卷"],
      expectedResult: "1秒内完成公式解析与文字渲染",
    },
  ],
};

describe("ExecutiveReport", () => {
  it("renders report title, findings, roadmap and PRD sections", () => {
    render(
      <ExecutiveReport
        manifest={mockManifest}
        findings={mockFindings}
        versionPlan={mockVersionPlan}
        prd={mockPrd}
        t={t}
      />,
    );

    expect(screen.getByText("优化学伴产品用户体验")).toBeDefined();
    expect(screen.getByText("拍照答题识别率低且卡顿")).toBeDefined();
    expect(screen.getByText(/拍数学公式老是报错/)).toBeDefined();
    expect(screen.getByText(/OCR 算法与暗光增强/)).toBeDefined();
    expect(screen.getByText("暗光场景识别准确率提升至 95%")).toBeDefined();
    expect(screen.getByText("tc-1")).toBeDefined();
  });

  it("handles copy markdown button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    render(
      <ExecutiveReport
        manifest={mockManifest}
        findings={mockFindings}
        versionPlan={mockVersionPlan}
        prd={mockPrd}
        t={t}
      />,
    );

    const copyBtn = screen.getByRole("button", { name: /复制 Markdown 报告/ });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/已复制到剪贴板/)).toBeDefined();
    });
  });
});
