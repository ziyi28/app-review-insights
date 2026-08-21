# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **核心用户**：产品经理（PM）、独立开发者（Indie Developers）、移动应用研究员与 UX 分析师。
- **使用场景**：在规划 App 版本迭代、分析用户集中负面反馈、评估竞品优缺点或撰写 PRD 需求文档时，需要从海量 App Store 真实评论中快速提炼高信度的问题与需求。
- **核心任务**：将零散、非结构化的 App Store 用户评论转化为具备明确证据支撑的问题清单（Findings）、版本规划（Version Planning）、需求文档（PRD）与验收测试用例（Test Cases）。

## Product Purpose

- **产品目的**：提供一个本地运行、模型驱动的 App Store 评论深度分析与产品规划工具。
- **存在价值**：解决传统评论分析中“仅停留于词云与情感分数”或大模型分析中“无依据幻觉、脱离具体评论上下文”的问题，建立从「原始评论 → 提炼发现 → 规划需求 → 验收测试」的端到端可验证闭环。
- **成功定义**：生成的每一个需求均能严格追溯到真实评论中的具体原话，版本规划具备合理的优先级与依赖关系，且产出的 PRD 和测试用例可直接用于指导研发。

## Positioning

- **差异化机制**：**确定性证据追溯与可验证链条（Deterministic Traceability & Verification）**。
- 不盲信大模型生成内容：引用摘录必须是真实评论的精确子串，样本统计与置信度由代码硬逻辑重算，全链路强制进行确定性追溯验证（Traceability Validation），失败时仅允许一次受约束的修订，保证交付物 100% 扎根于真实数据。
- **完全透明的流水线**：完整暴露 8 个阶段（范围、采集、清洗、主题、发现、规划、测试、追溯）的中间产物与执行事件流，支持离线回放。

## Operating Context

- **运行形态**：本地单进程 Web 应用（默认 `http://localhost:3000`），无远程数据库或外部状态协调依赖。
- **核心工作流**：
  1. 输入 App Store 链接（US/CN 页面解析并采集 US 评论）或导入 JSON/CSV 评论数据集。
  2. 设定自由文本分析目标（Scope）。
  3. 启动后台流水线分析，通过 NDJSON 事件流增量拉取进度与产物。
  4. 查看清洗统计、分类主题、发现证据、PRD 需求矩阵与测试用例。
  5. 导出分析报告或保存/回放历史运行。
- **运行环境**：Node.js 22+，Next.js 16 (App Router) + React 19，外网采集需系统级透明代理或配置环境变量代理。

## Capabilities and Constraints

- **流水线架构**：标准阶段顺序 `source → prepare → scope → topics → findings → planning → tests → traceability → (optional revision) → final-report`。
- **数据采集与降级**：优先使用 SerpApi（需配置 Key），失败或未配置时显式降级至 Apple RSS Feed 采集（顺序请求，间隔 ≥500ms，最多 10 页）；支持自定义 JSON/CSV 格式导入。
- **单实例与持久化约束**：纯文件快照存储在 `data/runs/<runId>/`，单实例运行，无跨进程锁；进程重启后运行中任务标记为 `interrupted`，不支持断点续跑。
- **模型中立与安全**：支持 OpenAI 兼容 API；API Key 仅存放于本地 `.env.local`，绝不写入日志或报告；无模型配置时仍可完成确定性清洗与离线缓存回放。
- **追溯硬约束**：需求与测试用例必须有前置证据，违背约束时执行一次受约束修订（attempt-02），若再次校验失败则明确终止（`run.failed`），绝不伪造成功。

## Brand Commitments

- **产品名称**：App Review Insights (app-review-planner)
- **界面语调**：专业、严谨、以数据和证据为中心、透明且工程化（Technical, Evidence-focused, Pragmatic）。
- **语言支持**：原生支持中文与英文双语界面（i18n）。

## Evidence on Hand

- 包含真实的 Workout for Women 评论分析抓取样本与回放快照（`fixtures/demo-runs/`）。
- 包含多语言完整文档（`README.md`, `README.en.md`, `CLAUDE.md`, `docs/model-analysis.md`, `docs/import-format.md`）。
- 界面功能具备高覆盖率的单元测试、集成测试与 Playwright E2E 验证脚本。

## Product Principles

- **证据高于直觉（Evidence Over Assertion）**：所有的发现、需求和优先级必须扎根于具体评论原文，杜绝无事实支撑的模型臆想。
- **确定性校验边界（Rules Over Model）**：大模型负责理解与发散，纯代码规则负责约束、去重、统计重算与拓扑验证。
- **透明可复核（Process as Deliverable）**：流水线的每个中间阶段和决策理由均对用户可见，可随时复核原始网络响应与事件流。
- **本地优先与隐私（Local-First & Safe）**：数据持久化于本地，敏感凭证绝不上云或落入日志，无网络或无模型时基础能力依然可用。

## Accessibility & Inclusion

- 界面遵循无障碍标准，提供清晰的语义化 HTML、键盘导航支持以及高对比度的可视化图表与数据看板。
