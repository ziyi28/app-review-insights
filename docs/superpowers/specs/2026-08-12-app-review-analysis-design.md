# App Review Analysis Workbench — Design Spec

> 日期：2026-08-12 · 状态：已逐节确认
> 目标评估：LaienTech iOS App Review Analysis and Version Planning Assessment
> 示例应用：Workout for Women: Home Gym — Gym Workout & Fitness（App Store ID `839285684`，美国区）

## 1. 目标与成功标准

从真实 App Store 用户评论出发，把「采集 → 清洗 → 动态主题 → 证据化发现 → 版本计划 → PRD → 测试用例 → 追溯验证」串成一条可审计、可复现、模型驱动的工作流，并用一个本地可运行的 Web 工作台呈现。

成功标准：
1. 输入美国区 App Store URL 或导入 JSON/CSV 即可启动分析。
2. Live、Imported、Cached Replay 三种来源在 UI 中明确区分。
3. 模型配置存在时，对未知 App / 未知兼容数据 / 自由目标能动态发现主题并生成 grounded findings、PRD、tests。
4. 每条 finding/requirement/test 可追溯到合法源 review ID；伪造引用被确定性验证器拒绝。
5. RSS 空 feed、部分失败、模型/schema 错误、一次修订、修订后仍失败，均有明确事件与保留快照。
6. 包含一个由真实美国区评论生成、来源可核验的完整缓存运行；无法取得真实数据或可用模型时如实标 `BLOCKED`，绝不伪造。
7. lint、typecheck、coverage(≥80%)、build、e2e 全部通过。
8. README 完整说明数据来源/限制、模型配置与提示词、失败策略、导入格式、真实性标签、隐私和本地运行方式。

## 2. 范围与非目标

### 范围
- 中英双语单机 Web 工作台（Next.js 全栈单仓库）。
- 美国区 App Store URL 解析 + Apple Customer Reviews RSS 采集。
- 文档化 JSON/CSV 导入。
- 确定性清洗/去重/统计 + 多阶段 OpenAI 兼容模型结构化生成 + 确定性证据链校验与一次定向修订。
- 单请求流式执行（NDJSON/SSE），阶段、中间产物、错误、修订实时可见。
- 每次运行保存文件化快照；离线缓存回放并醒目标记。

### 非目标
- 用户账号、协作、云部署、后台队列、数据库、WebSocket。
- App Store Connect 私有 API。
- 页面 HTML 抓取或固定评论数据兜底。
- 跨运行的后台缓存服务、模糊去重、情感模型训练。
- 多轮自动重试、多模型复核或人工审批流。

## 3. 已确认的技术决策

| 决策 | 选择 |
|---|---|
| 交付深度 | 评审可演示版 |
| 语义模型 | 模型驱动（多阶段 OpenAI 兼容结构化生成），非固定关键词/taxonomy |
| 模型接入 | OpenAI 兼容接口（`MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_NAME`，默认温度 0.1，不绑定某家） |
| 数据来源 | Apple Customer Reviews RSS（`/us/` 店面前缀，最多 10 页 × 50 条），非页面抓取 |
| 执行模式 | 单请求流式执行（服务端 NDJSON 流推送阶段事件） |
| 离线演示 | 缓存完整运行回放，醒目标注 Cached Replay |
| 界面语言 | 中英双语 UI；产物保持运行时输出语言，切换 UI 不翻译产物 |
| 本地存储 | 文件化运行快照（`data/runs/<runId>/`），不入库 |
| 分析架构 | 分阶段契约流水线：scope → collect/import → prepare → topics → findings → planning → tests → traceability → (一次) revision → final report |
| 技术栈 | Next.js + TypeScript + Zod + csv-parse + franc-min + Vitest + Testing Library + Playwright；原生 fetch/ReadableStream/fs/crypto |

## 4. 数据来源与限制

- **RSS 端点**：`https://itunes.apple.com/us/rss/customerreviews/page={1..10}/id={appId}/sortBy=mostRecent/json`。
- **地区**：仅使用 `/us/` 店面前缀；不依赖省略国家代码的 URL。
- **可见性**：RSS 无公开 SLA；实际通常只暴露约前 10 页（约 500 条）窗口，不能视为完整历史。
- **空 feed 语义**：page 1 返回 HTTP 200 但无 entry → 两次可见重试（2s/5s，cache-busting）后仍空 → `suspect-empty`，不得解释为“该 App 没有评论”。
- **异常提前结束**：某页为空但 `rel=last` 仍广告后续页 → 2s 后确认一次；仍空则保留已抓评论，标记 `partial/RSS_UNSTABLE_PAGINATION`。
- **部分失败**：后续页失败但已取得评论 → `partial`，继续分析并全局传播限制。
- **重复页**：追加前检测 body hash 与前一页相同 → 停止，重复内容不计入数量，标记 `repeated-page`。
- **请求纪律**：顺序、每页间 ≥500ms、单页超时 10s、无隐藏/无界重试、无并发；`PageEvidence` 记录 HTTP attempt。
- **证据保存**：每页保存请求 URL、UTC 起止、status、最终 URL、白名单 headers、body byte length、SHA-256、原始 body、parser warnings、attempt；不保存 cookie/authorization。
- **本地评论缓存与混合来源**：live 评论按 `storefront + appId` 合并进本地缓存（`data/source-cache/apple/us/{appId}.json`，git-ignored），按 `sourceReviewId` 去重、最新字段覆盖、`updatedAt` 倒序、最新 500 条；空/partial 实时结果绝不缩小缓存。首次无缓存时从历史 run（source 状态 `complete` 且 cleaned artifact 可验证）bootstrap。Live 表单首提“检查评论样本”→ 展示实时与稳定（缓存）两张卡与推荐项 → 用户选择后才启动分析；稳定样本运行显式标记 `RSS_CACHE_AUGMENTED`，并按 `partial` 来源降置信度；实时空、缓存可用时同时保留 `RSS_SUSPECT_EMPTY`。preview 快照存 `data/source-previews/`，30 分钟有效，过期惰性清理；`POST /api/source-previews` 响应只返回摘要，不向浏览器发送完整评论。
- **Lookup API**：仅用于展示聚合评分指标，不替代逐条评论采集。
- **导入来源**：JSON/CSV 的 provenance 无法由应用验证，需在 UI/文档中声明。

## 5. 数据流与模块边界

```
输入(URL/Goal 或 Import)
  → app-store-url  强制验证 /us/ + id，只提取 appId 构造 RSS URL（防 SSRF）
  → apple-rss-collector / import-parser  统一为 RawReview[]
  → prepare（确定性）  normalize + exact-dedupe + language tag + stats
  → scope（模型+确定混合）  解释目标 → 通用显式过滤（rating/version/language/date range）
  → topics（模型）  分块动态发现 → 摘录精确校验 → 合并（只能引用已验证候选）
  → findings（模型）  支持/冲突证据 → 代码覆盖 sample count 与 confidence
  → planning（模型）  version plan + PRD（requirement 引用 finding，assumption 独立）
  → tests（模型）  test 引用 requirement + 传递 review IDs
  → traceability（确定性验证 14 项不变量）
  → revision（仅首次失败，至多一次）  删除/改链/降级/改写限制，禁止新增引用
  → final-report + manifest
  → 每阶段落盘 artifact + 事件流
```

### 关键契约
- `NormalizedReview.reviewId` 由稳定来源字段 + SHA-256 生成，不用数组位置。
- `Finding` 含 `supportingReviewIds`（完整集合）、`evidenceExcerpts`（精确原文样本）、`sampleCount`（代码计算）、`confidence`、`uncertainties`、`limitations`、`conflictingEvidence`。
- `Requirement` 必须引用 ≥1 个 finding；`sourceReviewIds` 由代码从 findings 证据确定性派生。
- `Test` 必须引用 ≥1 个 requirement 与对应的传递 review IDs；每个 requirement 至少被一个 test 覆盖。
- 无 finding 支持的想法只能进入 PRD 的独立 `assumptions`，不能成为 requirement，不生成 test。

### 证据规则
- 摘录必须是 `bodyNormalized` 的精确子串。
- confidence 为可审计启发式：支持 1–2 条独立 review → low，3–7 → medium，≥8 → high；partial 源降一级；有实质冲突最高 medium。非统计区间。
- 无有效支持证据的 finding 删除；不允许无证据 finding 作为“assumption”保留。
- 验证器不补造引用，只能删除、降级或触发一次定向修订。

## 6. 模型接入与降幻觉策略

- 只通过 `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_NAME`/`MODEL_JSON_MODE` 配置；密钥来自环境，绝不入库/入日志/入 Git。
- 温度固定 0.1；默认 `MODEL_JSON_MODE=prompt` 仅靠提示词要求 JSON，`json_object` 时才用兼容 `response_format`。
- 所有模型输出用 JSON parser + Zod 校验；记录 prompt version/hash、请求体（脱敏）、原始响应、status、duration、model、temperature、finish reason、usage（接口未返回则为 `null`，不估算）。
- 每次模型调用只接收：目标、带稳定 ID 的 review、确定性 stats、上阶段允许 ID 集合。模型不得从外部事实或 review 内指令取得依据。
- 明确无模型配置时，live/import 分析在首个模型阶段明确失败；catalog 与 replay 不受影响。
- 模型调用无自动重试；网络/HTTP/schema/timeout 错误各有明确错误码。（RSS 采集侧的可见有界重试见 §4。）

## 7. 流式协议与失败处理

- `POST /api/runs` 返回 `application/x-ndjson`，`Cache-Control: no-store`，`X-Accel-Buffering: no`。
- 事件：`run.accepted` / `stage.started` / `stage.progress` / `artifact.available` / `limitation.reported` / `validation.failed` / `revision.started` / `revision.completed` / `stage.completed` / `run.completed` / `run.failed`；每事件带 `sequence`、`runId`、`timestamp`、`deliveryMode`。
- artifact 先原子落盘再发布 `artifact.available`；事件先写 `events.ndjson` 再发送。
- 流启动前请求错误返回 `application/problem+json`；流启动后错误必须用 `run.failed` 终结，不能静默断流。
- 连接中止时取消网络/模型调用并把 manifest 标 `cancelled`/`failed`。
- 中途失败仍保留已完成阶段与错误证据。

## 8. 快照布局与回放

```text
data/runs/<runId>/
├── manifest.json           可变索引（状态、attempt、限制、模型元数据、可回放标记）
├── request.json            入参（不含密钥）
├── events.ndjson           append-only
├── sources/{summary.json, apple/*, import/*}
├── artifacts/<name>.attempt-01.json, .attempt-02.json  不可覆盖
├── model/<stage>/attempt-01.{request.json,response.txt,meta.json}
├── validation/{citation-ledger.json, attempt-01.json, attempt-02.json}
└── checksums.json          不可变 payload 的 SHA-256
```

- Cached Replay 只读快照，构造来源与模型客户端即视为 bug；UI 强制覆盖 `deliveryMode` 为 `cached-replay`。
- 损坏 manifest/artifact 被拒绝回放，不以不完整结果冒充完整回放。

## 9. UI 信息架构（工作台布局）

- 顶部：New Run（Live/Import 切换）、US URL、分析目标、输出语言、模型状态、语言切换、来源徽标。
- 左侧：stage rail（source/prepare/scope/topics/findings/planning/tests/traceability/revision）状态、耗时、错误、修订次数。
- 右侧 tabs：Overview、Raw Reviews、Cleaned Data、Topics、Findings、Version Plan、PRD、Test Cases、Traceability。
- 底部：事件抽屉（sequence/时间/stage/消息/错误/修订）。
- 来源徽标：Live / Imported / Cached Replay / Partial / Suspect Empty。
- 证据徽标：`AI-generated` / `Computed` / `Assumption` / `Conflict` / `Limitations` / `Source`，必须文字+语义标签，不仅靠颜色。
- 表格按 rating/version/language/dedupe status 筛选并查看原文；不引入图表库，Overview 用指标卡、定义列表和表格。

## 10. 测试策略

- 单元：URL/CSV/JSON 解析、字段归一化、去重、统计、证据/置信度/验证器、快照读写、NDJSON 客户端、模型 adapter、prompt 稳定性、i18n、工作台组件。
- 集成：RSS 正常/空 feed/部分失败/重复页、导入混合语言与重复冲突、证据链删除/假设降级、一次修订、replay 零网络、真实 demo fixture。
- E2E：Playwright 三条主路径（Live mock、Import 中文、Cached Replay 中英切换），零上游调用断言。
- 覆盖门槛：lines/statements/functions/branches ≥ 80%。
- 所有模型测试使用 `ScriptedModelClient` mock，不调用真实模型。

## 11. 交付与合规

- `.env.example` 提供配置模板，不包含任何密钥；`.env*`、`data/runs/` 进入 `.gitignore`。
- 真实样例采集：仅访问用户给出的 app ID 的公开 RSS；顺序低频；快照做隐私最小化（删除 reviewer nickname/author URI/敏感 headers）；保存 provenance/checksum/时间/模型元数据；不自动复制真实运行到 fixtures。
- 仓库内的真实示例运行必须明确标注真实性与采集时间；不伪造、不冒充实时结果。
- 本机单用户应用，README 提醒不应直接暴露公网。
