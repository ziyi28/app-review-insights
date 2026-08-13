# P0 验收闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭首轮验收中的三个 P0 缺口：恢复基于“先检查样本、再选择数据源”的 E2E 门禁；补齐 Test Case 到 Finding 与 Priority 的直接契约；用确定性规则识别并展示 Evidence Sufficiency，防止小样本问题被提升为高优先级或进入目标版本。

**Architecture:** 模型继续只负责语义生成，所有新增约束都由 TypeScript 确定性代码完成。Finding 在归一化阶段得到证据充分性评估；Planning 根据该评估降级优先级和版本归属；Test Case 在归一化阶段从 Requirement 派生 `findingIds` 与 `priority`，Traceability 再用同一组纯函数校验。UI 只展示持久化结果，并在展示边界为旧版缓存快照派生缺失字段。Playwright 使用独立的 runs/cache/previews 目录覆盖 live、stable、import、cached-replay 四条关键路径。

**Tech Stack:** Next.js 16.3 App Router、React 19 Client Components、TypeScript 6、Zod 4、Vitest 4、Testing Library、Playwright 1.62、Node.js 22

## Global Constraints

- P0 只处理三项：Evidence Sufficiency、Test Case 直接追溯契约、E2E 门禁；版本规划因素、更多中间面板、中文 App Store URL 等 P1 项不混入本轮。
- 默认采用保守的 Evidence Sufficiency v1：支持数 `< 3`、支持比例 `< 1%`、数据源非 `complete`、或冲突数不少于支持数，任一成立即为 `insufficient`。阈值用命名常量集中定义，后续产品校准不改调用方。
- `insufficient` 表示“不能据此声称广泛/关键问题”，不等同于伪造或无证据：仍有合法 Review 和精确 excerpt 的 Finding 保留，但仅由不足 Finding 支撑的 Requirement 强制为 `P2` 且不进入目标版本。
- Finding 全部被证据校验删除时，流水线在 findings 后以 `completed/insufficient-evidence` 明确结束，不再调用 planning/tests 模型，也不可缓存回放为完整分析。
- Test Case 的 `findingIds` 和 `priority` 由 Requirement 确定性派生，不修改 tests 模型输出格式，因此不升级 prompt version。
- 新生成 artifact 必须包含新增字段；bundled demo 等旧缓存不批量手改，在 UI 展示边界通过 Requirement 派生 Test Case 缺失字段，并对旧 Finding 不显示不存在的 sufficiency 数据。
- 不新增依赖，不改变 Server/Client Component 边界；新增到 panels 的 helper 必须是无 Node API 的纯函数。
- E2E 继续使用生产构建服务器，不访问真实 Apple RSS 或真实模型。
- 当前未跟踪的 `docs/goal.md` 是用户提供的验收基线：实施、提交和清理时都不得修改或纳入提交。
- 每个任务先写失败测试，再写最小实现；不做相邻重构。

## Success Criteria

- `2 / 3000` 的 Finding 得到 `status: "insufficient"`、低 confidence 和可审计原因；UI 明确显示 “Insufficient Evidence” 与 `2 / 3000`。
- 仅由不足 Finding 支撑的模型 `P0`/`P1` Requirement 最终为 `P2`、`versionId: null`，对应 Version 的 `requirementIds` 不再包含它。
- 没有合法 Finding 时只调用 scope、topics、findings 三个模型阶段，产生 `INSUFFICIENT_EVIDENCE` limitation 并正常结束。
- 每个新 Test Case 持久化 `requirementIds`、`findingIds`、`sourceReviewIds`、`precondition`、`steps`、`expectedResult` 和 `priority`；篡改直接 Finding 或 Priority 会被 traceability 拒绝。
- bundled cached replay 仍可打开，旧 Test Case 在 UI 中显示由 Requirement 派生的 Finding 与 Priority。
- Playwright 四条用例全部通过：live preview、stable sample、import、cached replay；cached replay 的 RSS/model 请求数均为 0。
- `npm run verify`、`npm run test:integration`、`npm run test:e2e` 和 `git diff --check` 全部退出 0。

---

### Task 1: 建立 Evidence Sufficiency 领域规则并写入 Finding

**Files:**
- Create: `src/domain/analysis/sufficiency.ts`
- Create: `src/domain/analysis/sufficiency.test.ts`
- Modify: `src/domain/contracts/analysis.ts`
- Modify: `src/domain/contracts/analysis.test.ts`
- Modify: `src/server/pipeline/stages/findings.ts`
- Modify: `src/server/pipeline/stages/findings.test.ts`

**Interfaces:**
- Produces: `assessEvidenceSufficiency(input): EvidenceSufficiency`
- Extends: `Finding.evidenceSufficiency`
- Keeps: `Finding.confidence` as the existing strength/confidence signal; sufficiency answers the separate yes/no question “是否足以做广泛或关键判断”。

- [ ] **Step 1: 在领域测试中锁定阈值和边界**

在 `src/domain/analysis/sufficiency.test.ts` 写表驱动测试：

```ts
import { describe, expect, it } from "vitest";
import { assessEvidenceSufficiency } from "./sufficiency";

describe("assessEvidenceSufficiency", () => {
  it.each([
    [{ supportCount: 2, corpusCount: 3000, conflictCount: 0, sourceStatus: "complete" as const }, "SUPPORT_BELOW_MINIMUM"],
    [{ supportCount: 3, corpusCount: 1000, conflictCount: 0, sourceStatus: "complete" as const }, "SUPPORT_RATIO_BELOW_MINIMUM"],
    [{ supportCount: 8, corpusCount: 100, conflictCount: 0, sourceStatus: "partial" as const }, "SOURCE_NOT_COMPLETE"],
    [{ supportCount: 8, corpusCount: 100, conflictCount: 8, sourceStatus: "complete" as const }, "CONFLICT_NOT_MINOR"],
  ])("marks %o insufficient", (input, reason) => {
    const result = assessEvidenceSufficiency(input);
    expect(result.status).toBe("insufficient");
    expect(result.reasons).toContain(reason);
  });

  it("marks a well-supported complete-source finding sufficient", () => {
    expect(assessEvidenceSufficiency({
      supportCount: 8,
      corpusCount: 100,
      conflictCount: 1,
      sourceStatus: "complete",
    })).toEqual({
      status: "sufficient",
      corpusReviewCount: 100,
      supportRatio: 0.08,
      reasons: [],
    });
  });
});
```

- [ ] **Step 2: 运行新测试并确认 RED**

Run: `npx vitest run --project unit src/domain/analysis/sufficiency.test.ts`

Expected: 因 `./sufficiency` 尚不存在而失败。

- [ ] **Step 3: 定义 artifact 契约**

在 `src/domain/contracts/analysis.ts` 增加：

```ts
export const EvidenceSufficiencySchema = z.object({
  status: z.enum(["sufficient", "insufficient"]),
  corpusReviewCount: z.number().int().min(0),
  supportRatio: z.number().min(0).max(1),
  reasons: z.array(z.enum([
    "SUPPORT_BELOW_MINIMUM",
    "SUPPORT_RATIO_BELOW_MINIMUM",
    "SOURCE_NOT_COMPLETE",
    "CONFLICT_NOT_MINOR",
  ])).default([]),
});
export type EvidenceSufficiency = z.infer<typeof EvidenceSufficiencySchema>;
```

并在 `FindingSchema` 中把 `evidenceSufficiency: EvidenceSufficiencySchema` 设为新生成 Finding 的必填字段。更新 `analysis.test.ts` 的 `validFinding`，另加 schema 拒绝非法 ratio/status 的测试。

- [ ] **Step 4: 写最小纯函数实现**

在 `src/domain/analysis/sufficiency.ts` 集中定义阈值和判断：

```ts
import type { EvidenceSufficiency } from "@/domain/contracts/analysis";
import type { SourceStatus } from "./confidence";

export const MIN_SUPPORT_COUNT = 3;
export const MIN_SUPPORT_RATIO = 0.01;

export function assessEvidenceSufficiency(input: {
  supportCount: number;
  corpusCount: number;
  conflictCount: number;
  sourceStatus: SourceStatus;
}): EvidenceSufficiency {
  const supportRatio = input.corpusCount === 0 ? 0 : input.supportCount / input.corpusCount;
  const reasons: EvidenceSufficiency["reasons"] = [];
  if (input.supportCount < MIN_SUPPORT_COUNT) reasons.push("SUPPORT_BELOW_MINIMUM");
  if (supportRatio < MIN_SUPPORT_RATIO) reasons.push("SUPPORT_RATIO_BELOW_MINIMUM");
  if (input.sourceStatus !== "complete") reasons.push("SOURCE_NOT_COMPLETE");
  if (input.conflictCount >= input.supportCount) reasons.push("CONFLICT_NOT_MINOR");
  return {
    status: reasons.length === 0 ? "sufficient" : "insufficient",
    corpusReviewCount: input.corpusCount,
    supportRatio,
    reasons,
  };
}
```

- [ ] **Step 5: 让 Finding 归一化写入确定性评估**

在 `normalizeFindings` 构造 `Finding` 时调用：

```ts
evidenceSufficiency: assessEvidenceSufficiency({
  supportCount: supportingReviewIds.length,
  corpusCount: ctx.reviews.length,
  conflictCount: new Set(conflictingReviewIds).size,
  sourceStatus: ctx.sourceStatus,
}),
```

同时把 `FindingsStageResult.insufficientEvidence` 定义为“没有 Finding，或所有 Finding 均不足”：

```ts
const insufficientEvidence =
  findings.length === 0 || findings.every((f) => f.evidenceSufficiency.status === "insufficient");
```

单 chunk 和多 chunk 返回都使用同一计算结果，不复制阈值逻辑。

- [ ] **Step 6: 添加验收样例测试**

在 `findings.test.ts` 直接调用 `normalizeFindings`，构造 3000 条 corpus、仅引用 2 条合法 excerpt，断言：

```ts
expect(result.findings[0].supportingSampleCount).toBe(2);
expect(result.findings[0].confidence.level).toBe("low");
expect(result.findings[0].evidenceSufficiency.status).toBe("insufficient");
expect(result.findings[0].evidenceSufficiency.corpusReviewCount).toBe(3000);
expect(result.findings[0].evidenceSufficiency.supportRatio).toBeCloseTo(2 / 3000);
```

并给现有 Finding fixture 补齐该字段，避免用 optional/default 掩盖新 artifact 缺字段。

- [ ] **Step 7: 运行领域与 findings 测试并确认 GREEN**

Run:

```bash
npx vitest run --project unit src/domain/analysis/sufficiency.test.ts src/domain/contracts/analysis.test.ts src/server/pipeline/stages/findings.test.ts
```

Expected: 三个测试文件全部通过。

- [ ] **Step 8: 原子提交**

Run:

```bash
git add src/domain/analysis/sufficiency.ts src/domain/analysis/sufficiency.test.ts src/domain/contracts/analysis.ts src/domain/contracts/analysis.test.ts src/server/pipeline/stages/findings.ts src/server/pipeline/stages/findings.test.ts
git commit -m "feat: assess finding evidence sufficiency"
```

---

### Task 2: 在 Planning 和流水线中执行不足证据护栏

**Files:**
- Modify: `src/server/pipeline/stages/planning.ts`
- Modify: `src/server/pipeline/stages/planning.test.ts`
- Modify: `src/server/pipeline/orchestrator.ts`
- Modify: `tests/integration/pipeline-live.test.ts`
- Modify: `tests/integration/pipeline-import.test.ts`
- Modify: `tests/integration/pipeline-revision.test.ts`

**Interfaces:**
- `normalizePlanningOutput(...)` 保持现有签名，直接读取 Finding 中的确定性评估。
- Produces warning: `INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED`
- Produces limitation: `INSUFFICIENT_EVIDENCE`
- Produces terminal outcome: `insufficient-evidence`（仅没有合法 Finding 时）。

- [ ] **Step 1: 写 Planning RED 测试**

在 `planning.test.ts` 加三种场景：

```ts
it("downgrades a requirement backed only by insufficient findings", async () => {
  const result = await runPlanningStage(context()); // fixture finding=insufficient, model returns P1/ver-1
  expect(result.prd.requirements[0]).toMatchObject({ priority: "P2", versionId: null });
  expect(result.prd.versions[0].requirementIds).not.toContain("req-1");
  expect(result.warnings.some((w) => w.code === "INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED")).toBe(true);
});

it("keeps model priority when at least one linked finding is sufficient", async () => {
  // requirement 同时引用一个 sufficient 和一个 insufficient finding
  expect(result.prd.requirements[0]).toMatchObject({ priority: "P1", versionId: "ver-1" });
});
```

保留现有 unsupported finding 测试，证明“无合法 Finding”仍然删除 Requirement，而不是仅降级。

- [ ] **Step 2: 运行 Planning 测试并确认 RED**

Run: `npx vitest run --project unit src/server/pipeline/stages/planning.test.ts`

Expected: 当前代码仍信任模型 `P1`/`ver-1`，新增降级断言失败。

- [ ] **Step 3: 写 Planning 最小护栏**

在循环中对 `validFindingIds` 取实际 Finding：

```ts
const linkedFindings = validFindingIds.map((id) => findingIndex.get(id)!);
const onlyInsufficient = linkedFindings.every(
  (finding) => finding.evidenceSufficiency.status === "insufficient",
);
const priority = onlyInsufficient ? "P2" : req.priority;
const versionId = onlyInsufficient
  ? null
  : req.versionId && versionIndex.has(req.versionId) ? req.versionId : null;
```

仅当模型原结果发生变化时写一条 `INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED` warning。构造 Version 时只保留真实指向该版本的 Requirement：

```ts
requirementIds: v.requirementIds.filter((id) =>
  requirements.some((r) => r.id === id && r.versionId === v.id),
),
```

- [ ] **Step 4: 写 Pipeline RED 测试**

在 `pipeline-live.test.ts` 加/调整两个用例：

1. Finding 支持数不足但合法：run 完成，final PRD 中 Requirement 为 `P2/null`，manifest 含 `INSUFFICIENT_EVIDENCE`。
2. Findings 输出为空：只运行 scope/topics/findings，`model.callIndex === 3`；没有 planning/tests artifact；final report 的 `prd`/`report` 为 `null`；manifest `completed`、`canReplay === false`、limitation 明确。

把当前 partial-source 空 findings 用例的期望从 5 次模型调用改为 3 次，并继续断言 `RSS_PARTIAL` 被保留。

- [ ] **Step 5: 运行 integration 用例并确认 RED**

Run: `npx vitest run --project integration tests/integration/pipeline-live.test.ts`

Expected: 当前 orchestrator 不发布逐 Finding 的不足 limitation，且空 findings 仍进入 planning/tests，新增断言失败。

- [ ] **Step 6: 在 orchestrator 发布明确 limitation 并短路零 Finding**

Findings artifact 发布后：

```ts
const insufficientFindings = findingsResult.findings.filter(
  (finding) => finding.evidenceSufficiency.status === "insufficient",
);
if (findingsResult.findings.length === 0 || insufficientFindings.length > 0) {
  const limitation = {
    code: "INSUFFICIENT_EVIDENCE",
    message: findingsResult.findings.length === 0
      ? "No evidence-backed findings survived validation"
      : `${insufficientFindings.length} of ${findingsResult.findings.length} findings have insufficient evidence for broad or critical claims`,
    stage: "findings",
  } as const;
  limitations.push(limitation);
  await publisher.publish({ type: "limitation.reported", runId, stage: "findings", data: limitation });
}
```

当 `findings.length === 0` 时发布：

```ts
await publishArtifact("final-report", 1, { prd: null, report: null, limitations });
await publisher.publish({ type: "run.completed", runId, data: { outcome: "insufficient-evidence", limitations } });
await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
return;
```

不要对“有 Finding 但不足”的 run 短路；它继续生成被 P2/null 护栏约束的 PRD/Test Case。

- [ ] **Step 7: 修订路径保持同一规则**

`normalizeFindings` 和 `normalizePlanningOutput` 已在 revision 分支复用；新增一个 `pipeline-revision.test.ts` 断言，修订输出若只剩不足 Finding，重算后的 Requirement 仍为 `P2/null`。禁止在 revision 分支复制 sufficiency 或 priority 规则。

- [ ] **Step 8: 更新受必填 Finding 字段影响的 integration fixture**

只修改 TypeScript 直接构造 `Finding`/`Prd` 的 fixture；模型 JSON 不添加 `evidenceSufficiency`，因为该字段必须由代码计算。受影响文件以 typecheck 结果为准，预期仅为本 Task Files 中的 pipeline tests。

- [ ] **Step 9: 运行 stage 与 integration 全集**

Run:

```bash
npx vitest run --project unit src/server/pipeline/stages/planning.test.ts
npm run test:integration
```

Expected: planning unit 与全部 integration 测试通过。

- [ ] **Step 10: 原子提交**

Run:

```bash
git add src/server/pipeline/stages/planning.ts src/server/pipeline/stages/planning.test.ts src/server/pipeline/orchestrator.ts tests/integration/pipeline-live.test.ts tests/integration/pipeline-import.test.ts tests/integration/pipeline-revision.test.ts
git commit -m "feat: enforce insufficient evidence guardrails"
```

---

### Task 3: 补全 Test Case 直接追溯契约、校验与 UI

**Files:**
- Modify: `src/domain/contracts/analysis.ts`
- Modify: `src/domain/contracts/analysis.test.ts`
- Modify: `src/domain/traceability/evidence-sources.ts`
- Modify: `src/domain/traceability/validate.ts`
- Modify: `src/domain/traceability/validate.test.ts`
- Modify: `src/server/pipeline/stages/tests.ts`
- Modify: `src/server/pipeline/stages/tests.test.ts`
- Create: `src/components/artifacts/panels.test.tsx`
- Modify: `src/components/artifacts/panels.tsx`
- Modify: `src/components/workbench/workbench.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`

**Interfaces:**
- Extends: `TestCase.findingIds: string[]`
- Extends: `TestCase.priority: "P0" | "P1" | "P2"`
- Produces: `findingIdsForRequirements(...)` and `priorityForRequirements(...)`
- Adds violations: `TEST_FINDING_MISMATCH`, `TEST_PRIORITY_MISMATCH`
- Changes `TestsPanel` props to include `requirements` for legacy cached replay fallback.

- [ ] **Step 1: 写契约 RED 测试**

把 `PrioritySchema` 提取为 Requirement/Test Case 共用 schema，并先在 `analysis.test.ts` 加：

```ts
it("requires direct finding links and priority on a test case", () => {
  const parsed = TestCaseSchema.safeParse({
    id: "test-1",
    requirementIds: ["req-1"],
    sourceReviewIds: ["review-1"],
    testType: "manual",
    precondition: "signed in",
    steps: ["step"],
    expectedResult: "ok",
  });
  expect(parsed.success).toBe(false);
});
```

然后给 valid Test Case 增加 `findingIds: ["finding-1"]`、`priority: "P1"` 并断言 round-trip 保留。

- [ ] **Step 2: 写派生 helper RED 测试**

在 `validate.test.ts` 或新建同目录 helper test，锁定：

```ts
expect(findingIdsForRequirements(["req-1", "req-2"], requirements))
  .toEqual(["finding-1", "finding-2"]);
expect(priorityForRequirements(["req-1", "req-2"], requirements)).toBe("P0");
```

顺序按 Requirement 输入顺序和各自 Finding 顺序稳定去重；Priority 紧急度为 `P0 > P1 > P2`。

- [ ] **Step 3: 运行契约/helper 测试并确认 RED**

Run:

```bash
npx vitest run --project unit src/domain/contracts/analysis.test.ts src/domain/traceability/validate.test.ts
```

Expected: 新字段/helper 尚不存在导致失败。

- [ ] **Step 4: 实现共用契约与派生函数**

在 `analysis.ts`：

```ts
export const PrioritySchema = z.enum(["P0", "P1", "P2"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const TestCaseSchema = z.object({
  id: z.string().regex(/^test-/).min(1),
  requirementIds: z.array(z.string()).min(1),
  findingIds: z.array(z.string()).min(1),
  sourceReviewIds: z.array(z.string()).min(1),
  testType: z.enum(["manual", "automated"]).default("manual"),
  precondition: z.string().max(2_000).default(""),
  steps: z.array(z.string()).min(1),
  expectedResult: z.string().min(1).max(2_000),
  priority: PrioritySchema,
});
```

在 `evidence-sources.ts` 增加纯函数；不要在 tests stage 和 validator 各写一份派生算法。

- [ ] **Step 5: 让 tests stage 写入直接链路**

`normalizeTestsOutput` 对每个有效 Test Case 增加：

```ts
findingIds: findingIdsForRequirements(validReqs, requirements),
priority: priorityForRequirements(validReqs, requirements) ?? "P2",
```

tests prompt、`TestsOutputSchema` 和 upstream stub 的模型 JSON 保持不变；新增字段属于应用代码产物，不信任模型。

- [ ] **Step 6: 添加 tests stage 单元断言**

在 `tests.test.ts` 增加跨两个 Requirement 的用例，断言 direct Finding 去重、Priority 取 `P0`，并保留现有“review 必须在 Requirement evidence 内”的拒绝测试。

Run: `npx vitest run --project unit src/server/pipeline/stages/tests.test.ts`

Expected: 全部通过。

- [ ] **Step 7: 扩展 Traceability 校验**

对每个 Test Case 计算 expected direct fields：

```ts
const expectedFindingIds = new Set(findingIdsForRequirements(t.requirementIds, prd.requirements));
const expectedPriority = priorityForRequirements(t.requirementIds, prd.requirements);
```

实际集合不完全相等时报 `TEST_FINDING_MISMATCH`；priority 不等时报 `TEST_PRIORITY_MISMATCH`。在 `validate.test.ts` 分别篡改两个字段，确认报告失败；更新 `makePrd()` 的 Test Case fixture。

- [ ] **Step 8: 写 TestsPanel RED 测试**

创建 `panels.test.tsx`，先覆盖新 artifact：

```ts
render(<TestsPanel tests={[testCase]} requirements={[requirement]} t={getDictionary("en")} />);
expect(screen.getByText(/req-1/)).toBeInTheDocument();
expect(screen.getByText(/finding-1/)).toBeInTheDocument();
expect(screen.getByText(/P1/)).toBeInTheDocument();
expect(screen.getByText(/signed in/)).toBeInTheDocument();
```

再构造运行时缺少 `findingIds`/`priority` 的 legacy Test Case，断言 UI 从 Requirement 派生并显示，不修改 bundled fixture。

- [ ] **Step 9: 实现 UI 与中英文标签**

在 Dictionary 增加并补齐两种语言：`evidenceStrength`、`evidenceSufficient`、`evidenceInsufficient`、`supportRatio`、`requirementId`、`findingId`、`priority`、`precondition`。

`FindingsPanel` 对新 Finding 显示 sufficiency badge、`supportingSampleCount / corpusReviewCount` 和不足原因；对旧缓存中缺失的 `evidenceSufficiency` 只保留原 confidence 展示。

`TestsPanel` 展示 Requirement IDs、Finding IDs、Source Review IDs、Priority、Precondition、Steps、Expected Result；用 `test.findingIds ?? findingIdsForRequirements(...)` 与 `test.priority ?? priorityForRequirements(...) ?? "P2"` 兼容旧缓存。

`Workbench` 改为：

```tsx
<TestsPanel
  tests={testCases}
  requirements={planPrd?.requirements ?? []}
  t={t}
/>
```

- [ ] **Step 10: 运行 DOM、i18n、traceability 测试**

Run:

```bash
npx vitest run --project unit src/domain/contracts/analysis.test.ts src/domain/traceability/validate.test.ts src/server/pipeline/stages/tests.test.ts src/i18n/index.test.ts
npx vitest run --project unit:dom src/components/artifacts/panels.test.tsx src/components/workbench/workbench.test.tsx
```

Expected: 新字段、legacy fallback、双语字典和两个新 violation 全部通过。

- [ ] **Step 11: 运行 typecheck，修正所有直接构造的 typed fixture**

Run: `npm run typecheck`

Expected: 退出 0。只给编译器指出的直接 `Finding`/`TestCase` fixture 补必填字段；模型原始 response fixture 不补，因为它们仍使用 prompt output 契约。

- [ ] **Step 12: 原子提交**

Run:

```bash
git add src/domain/contracts/analysis.ts src/domain/contracts/analysis.test.ts src/domain/traceability/evidence-sources.ts src/domain/traceability/validate.ts src/domain/traceability/validate.test.ts src/server/pipeline/stages/tests.ts src/server/pipeline/stages/tests.test.ts src/components/artifacts/panels.tsx src/components/artifacts/panels.test.tsx src/components/workbench/workbench.tsx src/i18n/index.ts src/i18n/index.test.ts
git commit -m "feat: complete test case traceability contract"
```

---

### Task 4: 修复 preview-first E2E 并覆盖 stable/cached 路径

**Files:**
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `tests/e2e/live-analysis.spec.ts`
- Create: `tests/e2e/stable-sample.spec.ts`
- Modify: `tests/e2e/cached-replay-i18n.spec.ts`
- Verify only: `tests/e2e/import-conflict.spec.ts`
- Verify only: `tests/e2e/upstream-server.ts`

**Interfaces:**
- UI flow: `Check review sample` → `Analyze live sample` / `Analyze stable sample`
- Replay fixture: `run-workout-for-women-us`
- Test-only env: `RUNS_DIR`, `SOURCE_CACHE_DIR`, `SOURCE_PREVIEWS_DIR`, `REPLAY_EVENT_DELAY_MS`

- [ ] **Step 1: 先运行当前 E2E，保存 RED 基线**

Run: `npm run test:e2e`

Expected: `live-analysis.spec.ts` 和 `cached-replay-i18n.spec.ts` 因仍查找旧 `/Start/i` 流程失败；import 用例通过。记录结果为 `1/3 passed`，不要改产品 UI 来迁就旧 selector。

- [ ] **Step 2: 隔离 Playwright 持久化目录**

在 `playwright.config.ts` 的 `webServer.env` 增加：

```ts
SOURCE_CACHE_DIR: "./data/source-cache-e2e",
SOURCE_PREVIEWS_DIR: "./data/source-previews-e2e",
REPLAY_EVENT_DELAY_MS: "0",
```

保留 `RUNS_DIR: "./data/runs-e2e"`。

在 `global-setup.ts` 用 `path.resolve(process.cwd(), "data", name)` 明确解析三个 test-only 目录，先断言每个目录都位于 `<workspace>/data/` 内，再在 suite 前删除，在 teardown 中再次删除。不得使用环境变量、glob、workspace root 或用户目录作为递归删除目标。

- [ ] **Step 3: 把 live 用例改为真实 preview-first 流程**

在 `live-analysis.spec.ts`：

```ts
await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
const previewPromise = page.waitForResponse("**/api/source-previews");
await page.getByRole("button", { name: /Check review sample/i }).click();
expect((await previewPromise).status()).toBe(200);
await expect(page.getByText(/Live reviews:\s*2/i)).toBeVisible();

const postPromise = page.waitForResponse("**/api/runs");
await page.getByRole("button", { name: /Analyze live sample/i }).click();
expect((await postPromise).status()).toBe(200);
```

完成后除原 Findings/Traceability 断言外，打开 Test Cases tab，断言 `req-1`、`finding-1`、`P2`、Review ID 均可见。`P2` 是小样本 sufficiency 护栏的端到端证据。

- [ ] **Step 4: 新增 stable sample E2E**

`stable-sample.spec.ts` 独立执行同一 preview。preview 会先把 live 结果合并进隔离 cache，因此 stable card 在同一响应中可用；点击 `Analyze stable sample` 后断言：

- `run.completed` 可见；
- header badge 显示 `Live + Cache`；
- Overview limitation 显示 `RSS_CACHE_AUGMENTED`；
- Traceability 显示 Completed。

该用例不得依赖另一个 E2E 文件先运行。

- [ ] **Step 5: cached replay 改用 bundled fixture，不再先造 live run**

在 `cached-replay-i18n.spec.ts`：

```ts
await page.goto("/");
await page.getByRole("button", { name: /Cached Replay/i }).click();
await page.getByRole("combobox", { name: /Cached Replay/i })
  .selectOption("run-workout-for-women-us");
resetCounters();
await page.getByRole("button", { name: /^Start$/i }).click();
await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });
await expect(page.getByText(/Cached Replay/i).first()).toBeVisible();
expect(getUpstreamState()).toEqual({ rssRequests: 0, modelRequests: 0 });
```

删除 `latestRunId` helper；此测试的目的只剩“离线回放不触达上游”，不再与 live setup 耦合。

- [ ] **Step 6: 运行单文件 E2E，逐条转 GREEN**

Run:

```bash
npx playwright test tests/e2e/live-analysis.spec.ts
npx playwright test tests/e2e/stable-sample.spec.ts
npx playwright test tests/e2e/cached-replay-i18n.spec.ts
npx playwright test tests/e2e/import-conflict.spec.ts
```

Expected: 每条命令退出 0。若 selector 失败，优先使用 role/label 和已有 i18n 文案，不加入 `waitForTimeout`。

- [ ] **Step 7: 运行完整 E2E 并检查隔离目录清理**

Run:

```bash
npm run test:e2e
```

Expected: `4 passed`；结束后 `data/runs-e2e`、`data/source-cache-e2e`、`data/source-previews-e2e` 不存在，不残留跨次运行状态。

- [ ] **Step 8: 原子提交**

Run:

```bash
git add playwright.config.ts tests/e2e/global-setup.ts tests/e2e/live-analysis.spec.ts tests/e2e/stable-sample.spec.ts tests/e2e/cached-replay-i18n.spec.ts
git commit -m "test: restore preview and replay e2e gates"
```

---

### Task 5: 更新运行文档并执行 P0 最终验收

**Files:**
- Modify: `README.md`
- Modify: `docs/model-analysis.md`
- Verify only: `docs/goal.md`
- Verify only: all files changed by Tasks 1–4

**Interfaces:**
- Documents: sufficiency v1 policy、deterministic Test Case fields、16 条 traceability invariant（或改为不易漂移的无数字表述）、legacy replay compatibility。

- [ ] **Step 1: 更新 README 行为说明**

在 Traceability Rules 附近明确记录：

- Evidence Sufficiency 使用 support count、corpus ratio、source status、conflict ratio 的确定性 v1 规则；
- `insufficient` Finding 可以保留为有限事实，但不能产生 P0/P1 或目标版本 Requirement；
- Test Case 的 Finding IDs 与 Priority 从 Requirement 派生并验证；
- cached replay 不重新调用 Apple/model，旧 artifact 在展示层兼容。

- [ ] **Step 2: 更新 model-analysis 的职责边界**

把 findings/planning/tests/traceability 表格更新为：模型生成语义内容，代码计算 sufficiency、降级 priority/version、派生 test direct links。删除或更新容易漂移的 “14 invariants” 数字，使新增两个校验不会与文档冲突。

- [ ] **Step 3: 运行文档检查**

Run: `npm run check:docs`

Expected: 退出 0；`docs/goal.md` 内容和 git 状态保持原样。

- [ ] **Step 4: 运行静态与单元验证**

Run:

```bash
npm run lint
npm run typecheck
npm run test:coverage
```

Expected: 全部退出 0；覆盖率不低于项目现有阈值，新增分支有 RED→GREEN 测试覆盖。

- [ ] **Step 5: 运行 integration、生产构建与 E2E**

Run:

```bash
npm run test:integration
npm run build
npm run test:e2e
```

Expected: integration 全绿、production build 成功、Playwright `4 passed`。

- [ ] **Step 6: 运行项目总门禁**

Run: `npm run verify`

Expected: lint、typecheck、docs、coverage、build 全部退出 0。注意 `verify` 当前不包含 integration/E2E，所以 Step 5 不能省略。

- [ ] **Step 7: 检查差异质量与范围**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected:

- 无 whitespace error；
- 除用户原有 `?? docs/goal.md` 外，只出现本计划列出的 P0 文件；
- 没有 `.env.local`、真实凭据、`data/`、Playwright report、临时文件或大体积 fixture 变更；
- tests prompt version、bundled demo artifact 未被修改。

- [ ] **Step 8: 原子提交文档**

Run:

```bash
git add README.md docs/model-analysis.md docs/superpowers/plans/2026-08-12-p0-acceptance-closure.md
git commit -m "docs: record P0 evidence and traceability policy"
```

不要执行 `git add docs/goal.md`。

## Completion Report

实施完成后报告必须包含：

- P0 三项逐条的 before/after 证据；
- Evidence Sufficiency 阈值与 `2/3000` 实测 artifact 片段；
- 一条 Test Case 的 Review → Finding → Requirement → Test Case 完整示例；
- unit/integration/E2E/verify 的实际通过数量与命令退出状态；
- bundled cached replay 的零上游调用证据；
- 尚未纳入本轮的 P1 列表，不得把它们误报为完成。
