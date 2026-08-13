# P1 验收闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 P1 验收闭环：让版本规划显式依据七类决策因素、让全部关键中间产物和修订前后结果可查看、让现有 LLM 重试在 UI 与运行清单中可审计，并兼容中国区 App 页面输入但始终采集美国 storefront 评论。

**Architecture:** 模型继续负责 Severity、User Impact、Implementation Scope、Dependency 和决策理由等语义判断；应用代码从 Finding 重新计算 Evidence Strength、Confidence、Frequency，并对 Priority、Version 和依赖关系施加确定性护栏。流水线补充 stats、topic-candidates、evidence-validation、version-plan artifact；客户端在终态读取 artifact attempt 1 与 latest，展示 Draft/Final，而不复制或改写旧缓存。现有三次模型尝试机制保持不变，只扩展进度协议和 manifest 元数据。

**Tech Stack:** Next.js 16.3 App Router、React 19 Client Components、TypeScript 6、Zod 4、Vitest 4、Testing Library、Playwright 1.62、Node.js 22

## Global Constraints

- P1 原文中的 Evidence Confidence、Conflicting Feedback、Structured Output、Collection Failure Handling、Cached Demo 已具备，不重写这些实现；本轮只补动态 Version Planning、Workflow/Intermediate UI、LLM Retry 可见性和 `/cn/` 输入兼容。
- Review 数据始终来自美国 storefront：任何被接受的 App 页面 URL 最终只使用 App ID 构造 `/us/rss/customerreviews/...` 请求；不得请求用户输入的网页 URL。
- 只接受 `https://apps.apple.com/us/...` 与 `https://apps.apple.com/cn/...`；其他 host、协议和 storefront 继续返回 422。
- 七类版本规划因素固定为 Severity、Evidence Strength、Confidence、User Impact、Frequency、Implementation Scope、Dependency；不增加与验收无关的评分维度。
- Evidence Strength、Confidence、Frequency 必须由 Finding 和 Review 链路确定性计算，不能信任模型回传值。
- P0 证据护栏保持：仅由 insufficient Finding 支撑的 Requirement 必须为 `P2`、`versionId: null`；P1 不得放宽该规则。
- P0 以外的 P0 Priority 只有在 `severity=critical`、`userImpact=high`、`evidenceStrength=high`、`confidence=high` 同时成立时可保留，否则最多为 P1。
- 模型版本计划可返回 0、1 或多个版本；不得在代码中固定 V1/V2/V3，空版本在归一化时删除。
- 依赖关系只允许引用现存 Requirement，不允许自引用、环和“依赖项排在被依赖项之后”。
- 模型重试保持最多 3 次尝试：初次调用 + 2 次重试，退避 1s/2s；仅 5xx、网络错误、单次超时、非 JSON/截断响应可重试，4xx、schema violation、客户端断开不可重试。
- 不新增依赖；交互和 artifact 拉取继续留在 Client Component，文件读取和 RunStore 访问继续留在 Node Route Handler。
- bundled demo 和历史 run 不批量迁移；缺少 P1 artifact、planning factors 或 attempt 2 时，UI 显示“旧版产物不可用/无需修订”，不能崩溃或伪造数据。
- 当前未跟踪的 `docs/goal.md` 是用户验收基线，不修改、不暂存、不提交。
- 实施前 `git diff --name-only --diff-filter=U` 必须无输出；若再次出现并行合并冲突，立即停止，不替用户解决。
- 每项遵循 TDD：先写失败测试、确认 RED、写最小实现、确认 GREEN、独立提交；不做相邻重构。

## Success Criteria

- `/cn/app/.../id<number>` 可完成样本预览，公开 `canonicalUrl` 为 `/us/app/...`，实际 collector 请求包含 `/us/rss/customerreviews/`。
- 每个新 Requirement 持久化七类 `planningFactors`；其中 evidence/confidence/frequency 与 Finding 链路重算结果完全一致。
- P0 因因素不满足被 cap 为 P1；insufficient-only 仍为 P2/null；异常依赖被 traceability 明确拒绝。
- 单版本和多版本模型输出都能通过；代码删除空版本，不生成固定版本数量。
- Stage Rail 显示 Topic Discovery/Classification、Findings、Evidence Validation、Version Planning/PRD、Tests、Traceability 和可选 Revision。
- UI 可查看 Raw、Cleaned、Classification Candidates、Topics、Findings、Evidence Validation、Version Plan、PRD Draft/Final、Test Draft/Final、Traceability Draft/Final、Final Deliverables。
- 有修订的运行可读取 attempt 1 与 latest；无修订运行只显示 `Final · no revision required`；旧 cached replay 正常展示。
- 模型重试时出现 `retry 2/3 in 1s (...)` 进度；manifest 的 `modelUsage` 记录 `attempts`、`retries`、`retryReasons`，且不含响应正文或密钥。
- README 与 `docs/model-analysis.md` 不再声称“模型不自动重试”，并准确描述上述边界。
- `npm run verify`、`npm run test:integration`、`npm run test:e2e`、`git diff --check` 全部退出 0；Playwright 至少 5 条用例通过。

---

### Task 1: 兼容中国区 App 页面输入并统一到美国 storefront

**Files:**
- Modify: `src/server/sources/app-store-url.ts`
- Modify: `src/server/sources/app-store-url.test.ts`
- Modify: `src/app/api/source-previews/route.ts`
- Modify: `src/app/api/source-previews/route.test.ts`
- Modify: `src/app/api/runs/route.ts`
- Modify: `src/app/api/runs/route.test.ts`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`
- Create: `tests/e2e/storefront-input.spec.ts`

**Interfaces:**
- Replaces: `parseUsAppStoreUrl(input: string)`
- Produces: `parseAppStoreUrl(input: string): ParsedAppStoreUrl`
- Produces type: `{ appId: string; inputStorefront: "us" | "cn"; canonicalUrl: string }`
- Guarantees: `canonicalUrl` 永远为 `https://apps.apple.com/us/.../id<number>`；collector 仍只接收 `appId` 和固定 US RSS base URL。

- [ ] **Step 1: 写 URL parser RED 测试**

在 `app-store-url.test.ts` 把 import/describe 改为 `parseAppStoreUrl`，并锁定四个行为：

```ts
it("canonicalizes a China page URL to the US storefront", () => {
  expect(parseAppStoreUrl("https://apps.apple.com/cn/app/example/id839285684")).toEqual({
    appId: "839285684",
    inputStorefront: "cn",
    canonicalUrl: "https://apps.apple.com/us/app/example/id839285684",
  });
});

it("keeps a US page URL canonical", () => {
  expect(parseAppStoreUrl("https://apps.apple.com/us/app/example/id839285684").inputStorefront).toBe("us");
});

it("rejects an unsupported storefront", () => {
  expect(() => parseAppStoreUrl("https://apps.apple.com/jp/app/example/id839285684"))
    .toThrow(/US or China/i);
});
```

保留 non-HTTPS、non-Apple host、missing numeric ID 的现有拒绝测试。

- [ ] **Step 2: 运行 parser 测试并确认 RED**

Run: `npx vitest run --project unit src/server/sources/app-store-url.test.ts`

Expected: `parseAppStoreUrl` 尚不存在，CN canonicalization 测试失败。

- [ ] **Step 3: 写最小 parser 实现**

```ts
export type ParsedAppStoreUrl = {
  appId: string;
  inputStorefront: "us" | "cn";
  canonicalUrl: string;
};

export function parseAppStoreUrl(input: string): ParsedAppStoreUrl {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("URL must use https");
  if (url.hostname !== "apps.apple.com") throw new Error(`Unexpected host: ${url.hostname}`);
  const segments = url.pathname.split("/").filter(Boolean);
  const storefront = segments[0];
  if (storefront !== "us" && storefront !== "cn") {
    throw new Error("Only US or China App Store pages are supported");
  }
  const idSegment = segments.find((segment) => /^id\d+$/.test(segment));
  if (!idSegment) throw new Error("URL must contain a numeric id<number> segment");
  const appId = idSegment.slice(2);
  const pagePath = segments.slice(1).filter((segment) => segment !== idSegment).join("/");
  return {
    appId,
    inputStorefront: storefront,
    canonicalUrl: `https://apps.apple.com/us/${pagePath}/id${appId}`,
  };
}
```

保留现有 try/catch 的 `Invalid URL` 错误语义。

- [ ] **Step 4: 更新两个 Route Handler 调用点**

`source-previews/route.ts` 和 `runs/route.ts` 改用 `parseAppStoreUrl`。同时删除 `loadValidPreview` 未使用的 `requestedUrl` 参数：

```ts
const preview = await loadValidPreview(
  cfg.sourcePreviewsDir,
  request.source.previewId!,
  parsed.appId,
  request.source.reviewSelection!,
);
```

不新增对用户页面 URL 的 fetch。

- [ ] **Step 5: 写 Route RED 测试证明“输入 CN、采集 US”**

在 `source-previews/route.test.ts` 用 CN URL POST，记录 fetch URL：

```ts
expect(res.status).toBe(200);
expect((await res.json()).canonicalUrl)
  .toBe("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684");
expect(fetchMock.mock.calls.every(([url]) =>
  String(url).includes("/us/rss/customerreviews/"),
)).toBe(true);
```

在 `runs/route.test.ts` 加 CN URL 的 analyze 请求校验，确认不会因 storefront 返回 422；继续保留 appId mismatch 和 preview expiry 测试。

- [ ] **Step 6: 更新 UI 文案和字典测试**

把英文 `appStoreUrl` 改为 `App Store URL (reviews use the US storefront)`，中文改为 `App Store 链接（评论统一使用美国区）`。`index.test.ts` 断言两种文案都包含 storefront/美国区提示。

- [ ] **Step 7: 运行 unit/API 测试并确认 GREEN**

Run:

```bash
npx vitest run --project unit src/server/sources/app-store-url.test.ts src/app/api/source-previews/route.test.ts src/app/api/runs/route.test.ts src/i18n/index.test.ts
```

Expected: 全部通过；没有真实网络请求。

- [ ] **Step 8: 添加轻量 E2E**

`storefront-input.spec.ts` 只验证预览，不启动模型流水线：填入 CN URL、合法 goal、点击 Check review sample，断言响应 200、Live reviews 为 2、页面没有 invalid storefront 错误。

Run: `npx playwright test tests/e2e/storefront-input.spec.ts`

Expected: `1 passed`。

- [ ] **Step 9: 原子提交**

Run:

```bash
git add src/server/sources/app-store-url.ts src/server/sources/app-store-url.test.ts src/app/api/source-previews/route.ts src/app/api/source-previews/route.test.ts src/app/api/runs/route.ts src/app/api/runs/route.test.ts src/i18n/index.ts src/i18n/index.test.ts tests/e2e/storefront-input.spec.ts
git commit -m "feat: normalize China App Store pages to US reviews"
```

---

### Task 2: 建立七因素动态 Version Planning 契约与护栏

**Files:**
- Modify: `src/domain/contracts/analysis.ts`
- Modify: `src/domain/contracts/analysis.test.ts`
- Create: `src/domain/planning/factors.ts`
- Create: `src/domain/planning/factors.test.ts`
- Create: `src/server/model/prompts/planning.v2.ts`
- Modify: `src/server/model/prompts/prompts.ts`
- Modify: `src/server/model/prompts/prompts.test.ts`
- Modify: `src/server/pipeline/stages/planning.ts`
- Modify: `src/server/pipeline/stages/planning.test.ts`
- Modify: `src/domain/traceability/validate.ts`
- Modify: `src/domain/traceability/validate.test.ts`
- Modify: `src/server/pipeline/orchestrator.ts`
- Modify: `tests/integration/pipeline-live.test.ts`
- Modify: `tests/integration/pipeline-import.test.ts`
- Modify: `tests/integration/pipeline-revision.test.ts`
- Modify: `tests/e2e/upstream-server.ts`

**Interfaces:**
- Produces: `PlanningFactors`, `SemanticPlanningFactors`, `VersionPlanArtifact`
- Produces: `derivePlanningFactors(findingIds, findings, semantic): PlanningFactors`
- Produces: `priorityWithinFactorCap(requested, factors): Priority`
- Changes prompt: `planning@1` → `planning@2`
- Extends: `PlanningStageResult` with `versionPlan: VersionPlanArtifact`
- Adds traceability violations: `REQUIREMENT_DEPENDENCY_CYCLE`, `REQUIREMENT_DEPENDENCY_LATE`, `REQUIREMENT_DEPENDENCY_UNSCHEDULED`

- [ ] **Step 1: 写领域契约 RED 测试**

在 `analysis.ts` 的 confidence 定义之后新增 `PlanningFactorsSchema`；在现有 `VersionPlanSchema` 定义之后新增 `VersionPlanArtifactSchema`：

```ts
export const PlanningFactorsSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  evidenceStrength: z.enum(["insufficient", "low", "medium", "high"]),
  confidence: ConfidenceLevelSchema,
  userImpact: z.enum(["high", "medium", "low"]),
  frequency: z.object({
    supportingReviewCount: z.number().int().min(0),
    corpusReviewCount: z.number().int().min(0),
    supportRatio: z.number().min(0).max(1),
  }),
  implementationScope: z.enum(["small", "medium", "large"]),
  dependencyRequirementIds: z.array(z.string()).default([]),
  rationale: z.string().min(1).max(2_000),
});

export const VersionPlanArtifactSchema = z.object({
  versions: z.array(VersionPlanSchema),
  decisions: z.array(z.object({
    requirementId: z.string().regex(/^req-/),
    priority: PrioritySchema,
    versionId: z.string().nullable(),
    planningFactors: PlanningFactorsSchema,
  })),
});
export type VersionPlanArtifact = z.infer<typeof VersionPlanArtifactSchema>;
```

`RequirementSchema` 增加 `planningFactors: PlanningFactorsSchema.optional()`，`VersionPlanSchema` 增加 `rationale: z.string().min(1).max(2_000).optional()`；optional 仅用于旧缓存，新的 planning normalizer 必须写入。

`analysis.test.ts` 先断言完整 PlanningFactors 可 round-trip，非法 ratio、空 rationale、未知 enum 被拒绝。

- [ ] **Step 2: 写 factors RED 测试**

`factors.test.ts` 至少覆盖：

```ts
it("derives evidence, confidence and frequency from linked findings", () => {
  const factors = derivePlanningFactors(["finding-1", "finding-2"], findings, semantic);
  expect(factors.frequency).toEqual({
    supportingReviewCount: 8,
    corpusReviewCount: 100,
    supportRatio: 0.08,
  });
  expect(factors.confidence).toBe("medium");
  expect(factors.evidenceStrength).toBe("medium");
});

it("caps an unjustified P0 at P1", () => {
  expect(priorityWithinFactorCap("P0", {
    ...strongFactors,
    severity: "high",
  })).toBe("P1");
});

it("keeps P0 only for critical high-impact high-confidence evidence", () => {
  expect(priorityWithinFactorCap("P0", strongFactors)).toBe("P0");
});

it("keeps insufficient evidence at P2", () => {
  expect(priorityWithinFactorCap("P0", insufficientFactors)).toBe("P2");
});
```

Finding 的 review ID 按 union 去重；corpus count 取 linked findings 的最大值；confidence 取最保守级别；有 sufficient Finding 时 evidenceStrength 取 sufficient findings 的最保守 confidence，否则为 insufficient。

- [ ] **Step 3: 运行领域测试并确认 RED**

Run:

```bash
npx vitest run --project unit src/domain/contracts/analysis.test.ts src/domain/planning/factors.test.ts
```

Expected: schema/helper 尚不存在导致失败。

- [ ] **Step 4: 实现纯函数**

`factors.ts` 导出：

```ts
export type SemanticPlanningFactors = Pick<
  PlanningFactors,
  "severity" | "userImpact" | "implementationScope" |
  "dependencyRequirementIds" | "rationale"
>;

export function derivePlanningFactors(
  findingIds: string[],
  findings: Finding[],
  semantic: SemanticPlanningFactors,
): PlanningFactors;

export function priorityWithinFactorCap(
  requested: Priority,
  factors: PlanningFactors,
): Priority;
```

Priority rank 使用 `{ P0: 0, P1: 1, P2: 2 }`；返回 requested 与 cap 中更不紧急者。不要在 planning stage 复制该算法。

- [ ] **Step 5: 创建 planning@2 prompt**

保留 `planning.v1.ts` 不改，创建 `planning.v2.ts`。`PlanningOutputSchema` 的每个 version 必须有 `rationale`；每个 requirement 必须有仅含语义输入的：

```ts
planningFactors: z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  userImpact: z.enum(["high", "medium", "low"]),
  implementationScope: z.enum(["small", "medium", "large"]),
  dependencyRequirementIds: z.array(z.string()).default([]),
  rationale: z.string().min(1),
}),
```

SYSTEM 规则明确：逐条考虑七因素；Evidence/Confidence/Frequency 会由代码重算；根据当前数据返回 0/1/多个版本；不固定 V1/V2/V3；依赖项不能排在依赖它的 Requirement 之后。

`prompts.ts` 只把 registry 的 `planning` 指向 v2；`prompts.test.ts` 断言 `planning@2`，其余版本不变。

- [ ] **Step 6: 运行 prompt 测试并确认 GREEN**

Run: `npx vitest run --project unit src/server/model/prompts/prompts.test.ts`

Expected: registry 使用 `planning@2`，仍无固定业务 taxonomy，所有 prompt 继续标注 UNTRUSTED review text。

- [ ] **Step 7: 把 Planning normalizer 改为两阶段**

第一阶段收集有合法 Finding 的 Requirement IDs；第二阶段：

```ts
const dependencyRequirementIds = [...new Set(
  req.planningFactors.dependencyRequirementIds.filter(
    (id) => supportedRequirementIds.has(id) && id !== req.id,
  ),
)];
const planningFactors = derivePlanningFactors(validFindingIds, findings, {
  ...req.planningFactors,
  dependencyRequirementIds,
});
const priority = priorityWithinFactorCap(req.priority, planningFactors);
const versionId = planningFactors.evidenceStrength === "insufficient"
  ? null
  : req.versionId && versionIndex.has(req.versionId)
    ? req.versionId
    : null;
```

未知/自依赖产生 `PLANNING_DEPENDENCY_DROPPED`；Priority 被 cap 产生 `PLANNING_PRIORITY_CAPPED`。现有 `INSUFFICIENT_EVIDENCE_PRIORITY_DOWNGRADED` 可保留为更具体的 P0 limitation，但最终值必须来自同一个 helper。

构造 versions 时只保留真实 `versionId` 指向该版本的 Requirement，并删除 `requirementIds.length === 0` 的版本。输出：

```ts
const versionPlan: VersionPlanArtifact = {
  versions: prd.versions,
  decisions: prd.requirements.map((requirement) => ({
    requirementId: requirement.id,
    priority: requirement.priority,
    versionId: requirement.versionId,
    planningFactors: requirement.planningFactors!,
  })),
};
```

- [ ] **Step 8: 写 planning stage RED→GREEN 测试**

更新 `planning.test.ts` fixture 加 `planningFactors` 和 version `rationale`，新增：

- 模型 P0 因 severity=high 被 cap 到 P1；
- 满足四个强条件的 P0 保留；
- insufficient-only 仍 P2/null；
- unknown/self dependency 被删除并 warning；
- 一版本输入输出一版本、二版本输入输出二版本；
- 空版本被删除；
- `versionPlan.decisions` 与最终 Requirement 一致。

Run: `npx vitest run --project unit src/server/pipeline/stages/planning.test.ts`

Expected: 全部通过。

- [ ] **Step 9: 扩展依赖 Traceability**

Validator 建立 requirement dependency graph 和 version order map。先在 `validate.ts` 增加完整 DFS helper：

```ts
function requirementsInDependencyCycles(requirements: Requirement[]): Set<string> {
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string) => {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      for (const cycleId of stack.slice(cycleStart)) cyclic.add(cycleId);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependencyId of byId.get(id)?.planningFactors?.dependencyRequirementIds ?? []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of byId.keys()) visit(id);
  return cyclic;
}

const cyclicRequirementIds = requirementsInDependencyCycles(prd.requirements);
for (const requirement of prd.requirements) {
  if (cyclicRequirementIds.has(requirement.id)) {
    violations.push({
      code: "REQUIREMENT_DEPENDENCY_CYCLE",
      message: `${requirement.id} is part of a dependency cycle`,
      entity: requirement.id,
    });
  }
  for (const dependencyId of requirement.planningFactors?.dependencyRequirementIds ?? []) {
    const dependency = prd.requirements.find((candidate) => candidate.id === dependencyId);
    if (!dependency) continue; // unknown/self links were removed by normalizer
    if (requirement.versionId && !dependency.versionId) {
      violations.push({
        code: "REQUIREMENT_DEPENDENCY_UNSCHEDULED",
        message: `${requirement.id} depends on unscheduled ${dependencyId}`,
        entity: requirement.id,
      });
    } else if (requirement.versionId && dependency.versionId &&
      versionOrder.get(dependency.versionId)! > versionOrder.get(requirement.versionId)!) {
      violations.push({
        code: "REQUIREMENT_DEPENDENCY_LATE",
        message: `${requirement.id} depends on later ${dependencyId}`,
        entity: requirement.id,
      });
    }
  }
}
```

`validate.test.ts` 分别构造 cycle、unscheduled、late dependency，并保留一个依赖同版本/更早版本的合法测试。

- [ ] **Step 10: 发布 version-plan attempt**

初次 planning 后：

```ts
await publishArtifact("version-plan", 1, planning.versionPlan);
await publishArtifact("prd", 1, planning.prd);
```

revision 重新 normalize 后发布 `version-plan` attempt 2，与 prd/tests/traceability attempt 2 同步。最终 manifest 指向 latest。

- [ ] **Step 11: 更新 scripted model fixture**

给 `pipeline-live.test.ts`、`pipeline-import.test.ts`、`pipeline-revision.test.ts` 和 `tests/e2e/upstream-server.ts` 的 planning response 增加：

```ts
planningFactors: {
  severity: "high",
  userImpact: "high",
  implementationScope: "medium",
  dependencyRequirementIds: [],
  rationale: "Supported user impact and bounded implementation scope",
}
```

给每个 version 增加非空 `rationale`。不要给模型 fixture 添加 evidence/confidence/frequency；这些字段由 normalizer 生成。

- [ ] **Step 12: 运行领域、stage、integration 测试**

Run:

```bash
npx vitest run --project unit src/domain/contracts/analysis.test.ts src/domain/planning/factors.test.ts src/server/model/prompts/prompts.test.ts src/server/pipeline/stages/planning.test.ts src/domain/traceability/validate.test.ts
npm run test:integration
```

Expected: unit 与全部 integration 测试通过；revision attempt 2 同时含新版 version-plan 和 PRD。

- [ ] **Step 13: 原子提交**

Run:

```bash
git add src/domain/contracts/analysis.ts src/domain/contracts/analysis.test.ts src/domain/planning/factors.ts src/domain/planning/factors.test.ts src/server/model/prompts/planning.v2.ts src/server/model/prompts/prompts.ts src/server/model/prompts/prompts.test.ts src/server/pipeline/stages/planning.ts src/server/pipeline/stages/planning.test.ts src/domain/traceability/validate.ts src/domain/traceability/validate.test.ts src/server/pipeline/orchestrator.ts tests/integration/pipeline-live.test.ts tests/integration/pipeline-import.test.ts tests/integration/pipeline-revision.test.ts tests/e2e/upstream-server.ts
git commit -m "feat: make version planning factor-driven"
```

---

### Task 3: 产出 Classification、Evidence Validation 和独立中间 artifacts

**Files:**
- Create: `src/domain/analysis/evidence-validation.ts`
- Create: `src/domain/analysis/evidence-validation.test.ts`
- Modify: `src/domain/contracts/events.ts`
- Modify: `src/domain/contracts/events.test.ts`
- Modify: `src/server/runs/run-store.ts`
- Modify: `src/server/runs/run-store.test.ts`
- Modify: `src/server/pipeline/orchestrator.ts`
- Modify: `tests/integration/pipeline-live.test.ts`
- Modify: `tests/integration/pipeline-revision.test.ts`
- Modify: `src/components/workbench/stage-rail.tsx`
- Create: `src/components/workbench/stage-rail.test.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`

**Interfaces:**
- Adds stage: `evidence-validation`
- Adds artifact: `evidence-validation`
- Produces: `buildEvidenceValidationReport(result: FindingsStageResult): EvidenceValidationReport`
- Publishes existing declared artifacts: `stats`, `topic-candidates`, `version-plan`

- [ ] **Step 1: 写 EvidenceValidationReport RED 测试**

定义报告：

```ts
export type EvidenceValidationReport = {
  validFindingCount: number;
  rejectedFindingCount: number;
  sufficientCount: number;
  insufficientCount: number;
  findings: {
    findingId: string;
    supportCount: number;
    corpusCount: number;
    supportRatio: number;
    conflictCount: number;
    confidence: "low" | "medium" | "high";
    sufficiency: "sufficient" | "insufficient";
    reasons: string[];
  }[];
  rejected: { code: string; message: string }[];
};
```

`evidence-validation.test.ts` 用一个 sufficient、一个 insufficient 和一个 `UNSUPPORTED_FINDING` warning，断言四个 count、每个 finding 的确定性字段及 rejected 列表。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run --project unit src/domain/analysis/evidence-validation.test.ts`

Expected: helper 尚不存在。

- [ ] **Step 3: 写最小报告构造器**

报告只读取已经归一化的 Finding 与 warnings，不重新调用模型、不重算 P0 sufficiency 阈值。`rejected` 只包含 `UNSUPPORTED_FINDING`，其他 stage warning 仍留在 events。

- [ ] **Step 4: 扩展 event/artifact 枚举**

在 `StageNameSchema` 增加 `evidence-validation`；在 `ARTIFACT_NAMES` 增加 `evidence-validation`。现有 `stats`、`topic-candidates`、`version-plan` 已声明，不重复添加。

`events.test.ts` 断言新 stage event 可 parse；`run-store.test.ts` 断言新 artifact attempt 1/2 不互相覆盖。

- [ ] **Step 5: 在 orchestrator 发布完整中间产物**

Prepare 后额外发布：

```ts
await publishArtifact("cleaned-reviews", 1, prepared);
await publishArtifact("stats", 1, prepared.stats);
```

Topics 后：

```ts
await publishArtifact("topic-candidates", 1, {
  candidates: topics.candidates,
  warnings: topics.warnings,
});
await publishArtifact("topics", 1, { topics: topics.topics, warnings: topics.warnings });
```

Findings 完成后启动真实审计 stage：

```ts
await startStage("evidence-validation");
const evidenceReport = buildEvidenceValidationReport(findingsResult);
await publishArtifact("evidence-validation", 1, evidenceReport);
await endStage("evidence-validation");
```

该 stage 必须发生在任何 insufficient-evidence 提前返回之前。revision 后用 revised findings 发布 attempt 2，但不重复伪造一组 stage started/completed。

- [ ] **Step 6: 写 integration RED→GREEN 断言**

`pipeline-live.test.ts` 断言事件顺序：`findings completed` < `evidence-validation started/completed` < `planning started`；并读取 stats、topic-candidates、evidence-validation、version-plan artifact。

`pipeline-revision.test.ts` 断言 evidence-validation 和 version-plan 均存在 attempt 1/2，manifest 指向 2。

Run: `npm run test:integration`

Expected: 全部通过。

- [ ] **Step 7: 更新 Stage Rail**

`STAGE_ORDER` 在 findings 与 planning 之间插入 `evidence-validation`，新增 dictionary key `stageEvidenceValidation`。中文为 `证据验证`，英文为 `Evidence Validation`。

新建 `stage-rail.test.tsx`：

```tsx
render(<StageRail events={eventsThroughEvidence} t={getDictionary("en")} />);
const item = screen.getByText("Evidence Validation").closest("li");
expect(item).not.toBeNull();
expect(item).toHaveTextContent("✓");
```

同时断言未执行 revision 时 Revision 保持 pending，而不是显示完成。

- [ ] **Step 8: 运行相关 unit/DOM 测试**

Run:

```bash
npx vitest run --project unit src/domain/analysis/evidence-validation.test.ts src/domain/contracts/events.test.ts src/server/runs/run-store.test.ts src/i18n/index.test.ts
npx vitest run --project unit:dom src/components/workbench/stage-rail.test.tsx
```

Expected: 全部通过。

- [ ] **Step 9: 原子提交**

Run:

```bash
git add src/domain/analysis/evidence-validation.ts src/domain/analysis/evidence-validation.test.ts src/domain/contracts/events.ts src/domain/contracts/events.test.ts src/server/runs/run-store.ts src/server/runs/run-store.test.ts src/server/pipeline/orchestrator.ts tests/integration/pipeline-live.test.ts tests/integration/pipeline-revision.test.ts src/components/workbench/stage-rail.tsx src/components/workbench/stage-rail.test.tsx src/i18n/index.ts src/i18n/index.test.ts
git commit -m "feat: persist evidence and classification intermediates"
```

---

### Task 4: 展示完整 Intermediate Results、Draft/Final 和 Final Deliverables

**Files:**
- Modify: `src/app/api/runs/[runId]/artifacts/[artifactName]/route.ts`
- Create: `src/app/api/runs/[runId]/artifacts/[artifactName]/route.test.ts`
- Create: `src/hooks/use-artifact-versions.ts`
- Create: `src/hooks/use-artifact-versions.test.tsx`
- Create: `src/components/artifacts/workflow-panels.tsx`
- Create: `src/components/artifacts/workflow-panels.test.tsx`
- Modify: `src/components/artifacts/panels.tsx`
- Modify: `src/components/artifacts/panels.test.tsx`
- Modify: `src/components/workbench/workbench.tsx`
- Modify: `src/components/workbench/workbench.test.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`
- Modify: `tests/e2e/live-analysis.spec.ts`
- Modify: `tests/e2e/cached-replay-i18n.spec.ts`

**Interfaces:**
- Extends artifact GET: `?attempt=<positive integer>`
- Produces hook: `useArtifactVersions(runId: string | null, terminal: boolean): ArtifactVersionState`
- Produces components: `ClassificationPanel`, `EvidenceValidationPanel`, `VersionPlanPanel`, `RunDiagnosticsPanel`, `FinalDeliverablesPanel`, `ArtifactPhaseSelector`
- Preserves: existing polling for live intermediate artifacts.

- [ ] **Step 1: 写 artifact attempt Route RED 测试**

创建 route test，临时 RunStore 写 prd attempt 1/2、manifest 指向 2，使用真实 Request 和 route context 断言：

```ts
const context = {
  params: Promise.resolve({ runId, artifactName: "prd" }),
};
const get = (attempt: string) => GET(
  new Request(`http://localhost/api/runs/${runId}/artifacts/prd?attempt=${attempt}`),
  context,
);
const draft = await get("1");
const final = await get("2");
expect(await draft.json()).toEqual({ phase: "draft" });
expect(await final.json()).toEqual({ phase: "final" });
expect((await get("0")).status).toBe(422);
expect((await get("3")).status).toBe(404);
```

保留 unknown artifact 404 和默认读取 manifest latest 的行为。

- [ ] **Step 2: 实现受限 attempt 查询**

使用原生 Request API：

```ts
const rawAttempt = new URL(req.url).searchParams.get("attempt");
const requestedAttempt = rawAttempt === null ? null : Number(rawAttempt);
if (requestedAttempt !== null && (!Number.isInteger(requestedAttempt) || requestedAttempt < 1)) {
  return NextResponse.json({ error: "invalid attempt" }, { status: 422 });
}
```

读取 manifest latest；显式 attempt 大于 latest 返回 404；最后仍通过 `RunStore.readArtifact` 安全解析，绝不拼接用户提供的文件路径。

- [ ] **Step 3: 运行 Route 测试并确认 GREEN**

Run: `npx vitest run --project unit src/app/api/runs/[runId]/artifacts/[artifactName]/route.test.ts`

Expected: 全部通过，响应继续带 `cache-control: no-store`。

- [ ] **Step 4: 写 useArtifactVersions RED 测试**

接口：

```ts
export type ArtifactPair<T> = { draft: T | null; final: T | null; revised: boolean };
export type ArtifactVersionState = {
  manifest: RunManifest | null;
  prd: ArtifactPair<Prd>;
  tests: ArtifactPair<{ tests: Prd["tests"]; prd?: Prd }>;
  traceability: ArtifactPair<TraceabilityReport>;
  versionPlan: ArtifactPair<VersionPlanArtifact>;
  loading: boolean;
  error: string | null;
};
```

测试：terminal=false 不 fetch；terminal=true 先取 manifest，再取 attempt 1/latest；latest=1 时只请求一次并令 `revised=false`；切换 runId 时旧响应不得覆盖新 run。

- [ ] **Step 5: 实现 hook 并确认 GREEN**

hook 使用 `useEffect` + `AbortController`，只在终态运行。artifact 缺失时对应 pair 为 null，不令整个 hook 失败；manifest 请求失败才写 error。

Run: `npx vitest run --project unit:dom src/hooks/use-artifact-versions.test.tsx`

Expected: 全部通过。

- [ ] **Step 6: 写 workflow panels RED 测试**

`workflow-panels.test.tsx` 分别断言：

- Classification 显示 candidate label、精确 quote、Review IDs；
- Evidence Validation 显示 sufficient/insufficient/rejected 数量和 reasons；
- Version Plan 显示 version rationale，以及 Requirement 的七类 factor；
- Run Diagnostics 把 events 分为 Error、Warning、Validation、Revision 四组，保留完整 code/message；
- `ArtifactPhaseSelector` revised=true 时出现 Draft/Final 两个按钮，false 时只显示 `Final · no revision required`；
- Final Deliverables 显示最终 version/requirement/test 数、traceability 状态、limitations、model/prompt metadata；
- legacy artifact 缺 planningFactors/evidence artifact 时显示 `Not available in this cached run`，不抛异常。

- [ ] **Step 7: 实现专用 panels**

`workflow-panels.tsx` 只渲染 serializable props，不 import server files。统一用现有 `ProvenanceBadge` 表明 AI-generated、computed、limitation。

`RunDiagnosticsPanel` 接收 `RunEvent[]`，按以下确定性规则分类：`run.failed` 或 hook error → Error；带 `{code,message}` 的 `stage.progress` 和 `limitation.reported` → Warning；`validation.failed` → Validation；`revision.started`/`revision.completed` → Revision。空组不显示，message 不截断。

`VersionPlanPanel` 对 `planningFactors === undefined` 显示 legacy 文案；不得自行补造七因素。`FinalDeliverablesPanel` 只读取 final PRD/report/manifest，不能回退到 draft 后再标成 final。

- [ ] **Step 8: 扩展 Workbench artifact cache 与 tabs**

新增 cache keys：`stats`、`topicCandidates`、`evidenceValidation`、`versionPlan`。映射 artifacts：

```ts
"stats": "stats",
"topic-candidates": "topicCandidates",
"evidence-validation": "evidenceValidation",
"version-plan": "versionPlan",
```

Tabs 固定顺序：

```ts
"overview" | "raw" | "cleaned" | "classification" | "topics" |
"findings" | "evidence" | "versions" | "prd" | "tests" |
"traceability" | "deliverables"
```

删除旧 `plan` 合并 tab；PRD 与 Version Plan 分开。auto-advance 依次跟随 topics、findings、evidenceValidation、versionPlan、prd、tests、traceability、finalReport。

Overview 在统计卡和 limitations 之后渲染 `<RunDiagnosticsPanel events={events} clientError={error} t={t} />`，因此 Error/Warning/Validation/Revision 不再只能依赖 footer 中截断的原始 JSON。

- [ ] **Step 9: 正确选择 Draft/Final**

运行中使用当前 cache 并标 Draft；终态使用 hook：

```ts
const prdDraft = versions.prd.draft ?? cache.prd ?? null;
const prdFinal = versions.prd.final ?? cache.finalReport?.prd ?? null;
const testsDraft = versions.tests.draft?.tests ?? cache.tests?.tests ?? [];
const testsFinal = versions.tests.final?.tests ?? cache.finalReport?.prd?.tests ?? [];
```

修复当前 `cache.tests?.tests ?? cache.finalReport?.prd?.tests` 导致修订后仍优先显示 draft tests 的顺序问题。PRD/Test/Traceability/Version Plan 都通过同一个 phase selector 展示。

- [ ] **Step 10: 补齐双语字典**

新增 keys：`classification`、`evidenceValidation`、`finalDeliverables`、`draft`、`final`、`noRevisionRequired`、`legacyArtifactUnavailable`、七因素标签、`versionRationale`、`modelAttempts`、`modelRetries`。`index.test.ts` 继续用类型保证两种语言全量覆盖，并断言关键中文非空。

- [ ] **Step 11: 运行 DOM 测试并确认 GREEN**

Run:

```bash
npx vitest run --project unit:dom src/hooks/use-artifact-versions.test.tsx src/components/artifacts/workflow-panels.test.tsx src/components/artifacts/panels.test.tsx src/components/workbench/workbench.test.tsx src/components/workbench/workbench-long-run.test.tsx
npx vitest run --project unit src/i18n/index.test.ts
```

Expected: 完整 tabs、phase 切换、legacy fallback 和长运行 polling 全部通过。

- [ ] **Step 12: 扩展 live 与 cached replay E2E**

`live-analysis.spec.ts` 在完成后依次检查 Classification、Evidence Validation、Version Plan、PRD、Test Cases、Traceability、Final Deliverables tab 可进入且各自有内容；小样本 version plan 可以显示“no target release”，但不得伪造版本。

`cached-replay-i18n.spec.ts` 打开 bundled fixture，断言 Final Deliverables 有 counts，缺少 P1 factors 时显示 legacy 文案，同时上游请求仍为 0。

- [ ] **Step 13: 运行两条 E2E**

Run:

```bash
npx playwright test tests/e2e/live-analysis.spec.ts
npx playwright test tests/e2e/cached-replay-i18n.spec.ts
```

Expected: 两条通过，无固定 sleep。

- [ ] **Step 14: 原子提交**

Run:

```bash
git add -- ':(literal)src/app/api/runs/[runId]/artifacts/[artifactName]/route.ts' ':(literal)src/app/api/runs/[runId]/artifacts/[artifactName]/route.test.ts' src/hooks/use-artifact-versions.ts src/hooks/use-artifact-versions.test.tsx src/components/artifacts/workflow-panels.tsx src/components/artifacts/workflow-panels.test.tsx src/components/artifacts/panels.tsx src/components/artifacts/panels.test.tsx src/components/workbench/workbench.tsx src/components/workbench/workbench.test.tsx src/i18n/index.ts src/i18n/index.test.ts tests/e2e/live-analysis.spec.ts tests/e2e/cached-replay-i18n.spec.ts
git commit -m "feat: expose intermediate and final run artifacts"
```

---

### Task 5: 让现有 LLM Retry 可见、可审计并修正文档

**Files:**
- Modify: `src/server/model/types.ts`
- Modify: `src/server/model/openai-compatible-client.ts`
- Modify: `src/server/model/openai-compatible-client.test.ts`
- Modify: `src/server/model/scripted-client.ts`
- Modify: `src/server/pipeline/dependencies.ts`
- Create: `src/server/pipeline/dependencies.test.ts`
- Modify: `src/components/workbench/live-progress.tsx`
- Modify: `src/components/workbench/live-progress.test.tsx`
- Modify: `src/components/artifacts/workflow-panels.tsx`
- Modify: `src/components/artifacts/workflow-panels.test.tsx`
- Modify: `README.md`
- Modify: `docs/model-analysis.md`

**Interfaces:**
- Changes `ModelProgress` to discriminated union: heartbeat or retry.
- Extends `ModelUsageLog`: `attempts: number`, `retries: number`, `retryReasons: string[]`.
- Keeps max attempts/backoff/transient classification unchanged.

- [ ] **Step 1: 写 progress/usage RED 测试**

`openai-compatible-client.test.ts` 在现有 5xx→success 测试追加：

```ts
expect(onProgress).toHaveBeenCalledWith({
  kind: "retry",
  attempt: 2,
  maxAttempts: 3,
  delayMs: 1000,
  reason: "MODEL_HTTP_ERROR",
});
expect(client.getUsageLog()).toMatchObject({
  calls: 1,
  attempts: 2,
  retries: 1,
  retryReasons: ["MODEL_HTTP_ERROR"],
});
```

heartbeat 测试改为断言：

```ts
expect(onProgress).toHaveBeenCalledWith({
  kind: "heartbeat",
  elapsedMs: expect.any(Number),
});
```

4xx/schema/abort 测试断言 retries=0。

- [ ] **Step 2: 运行 client 测试并确认 RED**

Run: `npx vitest run --project unit src/server/model/openai-compatible-client.test.ts`

Expected: 当前 progress 无 kind/retry event，usage 无 attempts/retries。

- [ ] **Step 3: 扩展类型与 Scripted client**

```ts
export type ModelProgress =
  | { kind: "heartbeat"; elapsedMs: number }
  | {
      kind: "retry";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      reason: string;
    };
```

`ModelRequest.onProgress` 使用该类型。`ModelUsageLog` 增加三个字段；Scripted client 每次成功 generate 同时 `attempts += 1`、`calls += 1`，retries 保持 0，并在 getter 复制 `retryReasons`。

- [ ] **Step 4: 在 OpenAI client 发出 retry progress**

每次进入 `generateOnce` 前 `attempts += 1`；确定可重试后：

```ts
const reason = modelErrorCode(lastError);
this.usageLog.retries += 1;
this.usageLog.retryReasons.push(reason);
request.onProgress?.({
  kind: "retry",
  attempt: attempt + 2,
  maxAttempts: MAX_RETRIES + 1,
  delayMs: delay,
  reason,
});
```

`modelErrorCode` 只返回 `MODEL_*` 前缀，不记录 provider response snippet。heartbeat 改为 `{ kind: "heartbeat", elapsedMs }`。保留 console warning 作为服务端诊断，但 UI 不依赖 console。

- [ ] **Step 5: 更新 progress relay**

`dependencies.ts`：

```ts
if (info.kind === "retry") {
  return onProgress(
    `model retry ${info.attempt}/${info.maxAttempts} in ${info.delayMs / 1000}s (${info.reason})`,
  );
}
onProgress(`model generation in progress (${Math.round(info.elapsedMs / 1000)}s)`);
```

新建 `dependencies.test.ts`，分别断言 heartbeat 和 retry 文案。

- [ ] **Step 6: 保证 UI 优先显示 retry warning**

`LiveProgress` 把 `model retry` 视为 specific message；后续 heartbeat 不能覆盖最近 retry 文案，直到新的 batch/specific message 或 stage 完成。新增 DOM 测试：retry event 后 heartbeat 仍显示 `retry 2/3`。

- [ ] **Step 7: 在 Final Deliverables 展示审计数据**

`FinalDeliverablesPanel` 从 manifest `modelUsage` 显示 logical calls、HTTP attempts、retries、retry reasons、prompt versions。旧 manifest 缺字段时显示 attempts=calls、retries=0，但标注 computed fallback，不写回 artifact。

- [ ] **Step 8: 运行 unit/DOM 测试并确认 GREEN**

Run:

```bash
npx vitest run --project unit src/server/model/openai-compatible-client.test.ts src/server/pipeline/dependencies.test.ts
npx vitest run --project unit:dom src/components/workbench/live-progress.test.tsx src/components/artifacts/workflow-panels.test.tsx
```

Expected: 重试分类、次数、文案、legacy manifest fallback 全部通过。

- [ ] **Step 9: 修正文档矛盾**

README Failure Handling 和 `docs/model-analysis.md` 删除“No automatic retries/model calls are not auto-retried”，改为精确说明：3 attempts、1s/2s、transient allowlist、non-retry denylist、UI stage.progress、manifest audit fields。Non-goals 中把“multi-round model retries”改为“unbounded or semantic self-correction retries”，避免与有界传输重试冲突。

- [ ] **Step 10: 运行 docs check**

Run: `npm run check:docs`

Expected: 退出 0；搜索不再出现矛盾文本：

```bash
rg -n "model calls are not auto-retried|No automatic retries" README.md docs/model-analysis.md
```

Expected: 无输出。

- [ ] **Step 11: 原子提交**

Run:

```bash
git add src/server/model/types.ts src/server/model/openai-compatible-client.ts src/server/model/openai-compatible-client.test.ts src/server/model/scripted-client.ts src/server/pipeline/dependencies.ts src/server/pipeline/dependencies.test.ts src/components/workbench/live-progress.tsx src/components/workbench/live-progress.test.tsx src/components/artifacts/workflow-panels.tsx src/components/artifacts/workflow-panels.test.tsx README.md docs/model-analysis.md
git commit -m "feat: surface and audit model retries"
```

---

### Task 6: P1 文档、E2E 和最终验收

**Files:**
- Modify: `README.md`
- Modify: `docs/model-analysis.md`
- Modify: `scripts/check-docs.mjs`
- Modify: `tests/e2e/live-analysis.spec.ts`
- Modify: `tests/e2e/storefront-input.spec.ts`
- Modify: `tests/e2e/cached-replay-i18n.spec.ts`
- Verify only: `docs/goal.md`
- Verify only: all files changed by Tasks 1–5

**Interfaces:**
- Documents: storefront normalization、七因素 planning、intermediate artifact map、draft/final attempts、bounded visible retries。
- Adds docs assertions preventing retry and artifact documentation from drifting again.

- [ ] **Step 1: 完成 README 能力说明**

更新 What it does、Data Sources、Traceability/Planning、Failure Handling、Project Structure：

- CN 页面只用于解析 App ID，评论始终来自 US RSS；
- 七因素中三项由代码计算、四项由模型判断；
- Priority cap、dependency ordering、动态 0/1/N versions；
- 中间 artifacts 和 attempt 1/latest Draft/Final；
- 旧 cached run 的明确 fallback；
- 模型 retry 的实际边界。

- [ ] **Step 2: 完成 model-analysis 职责表**

Planning 行改为“model semantic factors + deterministic evidence/frequency/priority caps/dependency validation”；Runtime metadata 增加 attempts/retries/reasons；UI/Artifacts 小节列出：

```text
stats → topic-candidates → topics → findings → evidence-validation
→ version-plan → prd → tests → traceability → final-report
```

说明 revision 后 evidence-validation/version-plan/prd/tests/traceability 使用 attempt 2。

- [ ] **Step 3: 增加文档漂移检查**

`scripts/check-docs.mjs` 新增必须出现的 token：

```js
const REQUIRED_CAPABILITIES = [
  "Evidence Validation",
  "Version Planning",
  "Draft/Final",
  "3 attempts",
  "China App Store",
];
```

同时禁止 README/model-analysis 再出现两个旧的 no-retry 句子。测试通过只表示文档包含关键事实，不替代行为测试。

- [ ] **Step 4: 完成 P1 E2E 验收矩阵**

最终 Playwright 覆盖：

1. `live-analysis`: preview-first、完整 stage/tabs、Evidence Validation、Version Plan、Final Deliverables、traceability；
2. `stable-sample`: Live + Cache 标记与 limitation；
3. `import-conflict`: 多语言 import、dedupe/identity conflict；
4. `cached-replay-i18n`: 旧缓存、final deliverables、legacy fallback、零上游；
5. `storefront-input`: CN 页面输入成功预览、US review 文案明确。

不把模型 retry E2E 加入共享 upstream，以免把传输故障注入普通路径；其行为由 Task 5 的 fake-timer unit 测试覆盖。

- [ ] **Step 5: 运行静态、unit 和 coverage 门禁**

Run:

```bash
npm run lint
npm run typecheck
npm run check:docs
npm run test:coverage
```

Expected: 全部退出 0，覆盖率继续满足 lines/statements/functions/branches ≥ 80%。

- [ ] **Step 6: 运行 integration、build 和完整 E2E**

Run:

```bash
npm run test:integration
npm run build
npm run test:e2e
```

Expected: integration 全绿、production build 成功、Playwright 至少 `5 passed`。

- [ ] **Step 7: 运行项目总门禁**

Run: `npm run verify`

Expected: lint、typecheck、docs、coverage、build 全部退出 0。`verify` 当前不包含 integration/E2E，所以 Step 6 不能省略。

- [ ] **Step 8: 审查差异和工作树**

Run:

```bash
git diff --check
git diff --name-only --diff-filter=U
git status --short
git diff --stat
```

Expected:

- 无 whitespace error、无 unmerged path；
- `docs/goal.md` 仍是用户原有未跟踪文件且内容未变；
- 无 `.env.local`、API key、`data/`、playwright-report、test-results、临时 fixture；
- `planning.v1.ts` 保留，registry 使用 `planning.v2.ts`；
- bundled demo artifact 未被改写。

- [ ] **Step 9: 原子提交文档和计划**

Run:

```bash
git add README.md docs/model-analysis.md scripts/check-docs.mjs docs/superpowers/plans/2026-08-13-p1-acceptance-closure.md
git commit -m "docs: record P1 workflow and planning guarantees"
```

不要执行 `git add docs/goal.md`。

## Completion Report

实施完成后报告必须包含：

- P1 九项原文逐项状态；已具备的五项给回归证据，新完成的四条工作线给 before/after；
- 一条 CN 页面输入 → US canonical URL → US RSS request 的证据；
- 一个 Requirement 的七因素、模型请求 priority、最终 capped priority、version 和 dependency 决策；
- 一次有修订 run 的 PRD/Test/Traceability attempt 1 与 attempt 2 展示证据；
- 一次 transient model failure 的 retry 2/3 UI message 和 manifest `attempts/retries/retryReasons`；
- unit/integration/E2E/verify 的实际通过数量与退出状态；
- 未纳入本轮的 P2 可视化/动画/高级 Dashboard，不得误报为完成。
