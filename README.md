# App Review Insights

> **[English](README.en.md)** | 中文

本地、模型驱动的 App Store 用户评论分析工具：把评论转化为有证据支撑的产品计划。输入美国区或中国区 App Store 链接（评论统一使用美国区），或导入评论数据集，选定分析目标后，应用会采集、清洗、分析、规划并验证 —— 全程展示整个工作流和每一个中间产物。

**一条命令即可运行：** `npm run dev`，然后打开 http://localhost:3000。

## 它做什么

1. **范围（Scope）** —— 把自由文本目标解释为通用筛选条件和明确的限制（模型 + 规则）。
2. **采集 / 导入（Collect / Import）** —— 接受美国区或**中国区 App Store** 页面
   （`https://apps.apple.com/us/...` 或 `https://apps.apple.com/cn/...`）；两者都解析为
   同一个 App ID，并通过固定的 `/us/rss/customerreviews/...` 地址采集，因此评论始终来自
   美国区商店。同样接受 JSON/CSV 数据集。
3. **清洗（Clean）** —— NFC 规范化、精确去重、确定性统计。
4. **主题（Topics）** —— 动态主题发现（模型），无固定分类体系，候选引用句会在
   **分类（Classification）** 标签页中展示。
5. **发现（Findings）** —— 扎根于具体评论的用户问题，带精确摘录（模型 + 代码校验的证据），
   在 **证据验证（Evidence Validation）** 阶段审计。
6. **版本规划 + PRD** —— 可追溯到发现的需求，每个需求携带七个规划因素。严重程度、用户影响、
   实施范围、依赖关系和理由由模型生成；证据强度、置信度和出现频率由代码重新计算。优先级有上限，
   依赖关系做确定性校验。
7. **测试（Tests）** —— 与需求和来源评论关联的测试用例（模型）。
8. **追溯（Traceability）** —— 对整条链做确定性验证，失败时执行一次受约束的修订。修订过的
   运行会把 PRD、测试、追溯和版本计划的 **草稿 / 终稿**（attempt 1 与 attempt 2）并列展示；
   未修订的运行显示「终稿 · 无需修订」。

每次运行都会把完整文件快照持久化到 `data/runs/<runId>/` 目录下，并把阶段事件逐步
追加到 `events.ndjson`，可离线回放为 **缓存回放（Cached Replay）**。早于这些 P1 产物的
缓存运行会显示明确的后备提示，而不是捏造的数据。

## 界面截图

以下截图来自一次真实的 Workout for Women（美国区 App Store）分析运行（中文界面，2× 分辨率，点击可查看原图）：

**工作台概览 —— 评分 / 版本 / 语言分布与清洗明细**

![工作台概览](docs/screenshots/01-workbench-overview.png)

**发现与证据 —— 精确摘录 + 评论 ID 徽章 + 置信度**

![发现与证据](docs/screenshots/02-findings-evidence.png)

**追溯拓扑矩阵 —— 评论 → 发现 → 需求 → 测试全链路闭环**

![追溯拓扑矩阵](docs/screenshots/03-traceability-matrix.png)

**最终交付物 —— 目标覆盖 + 版本计划 + 导出入口**

![最终交付物](docs/screenshots/04-final-deliverables.png)

## 快速开始

要求：Node.js 22+。

```bash
npm ci
npm run dev
# 打开 http://localhost:3000
```

要使用实时模型驱动路径，必须配置模型（见下文）。没有模型时仍可以：

- 在界面的 **缓存回放** 模式下运行自带的真实 **缓存回放**（离线演示），该模式会列出可回放的
  运行，无需模型、无需网络；
- 导入并清洗数据集：采集/导入、去重和统计照常运行，随后运行以 `MODEL_NOT_CONFIGURED`
  限制完成（不会发起模型调用）。

## 网络环境

应用本身在本地运行（`http://localhost:3000`），但实时采集与模型分析需要访问外网：

- `itunes.apple.com` —— Apple 客户评论 RSS（降级采集路径）；
- `serpapi.com` —— SerpApi Apple Reviews 主采集源（配置 `SERPAPI_API_KEY` 后）；
- 你配置的 `MODEL_BASE_URL` —— 模型分析端点。

中国大陆网络直连上述服务通常超时或不可达，因此需要可访问美国服务的网络环境（如全局代理、美国节点）。

两个要点：

- **评论地区与代理无关**：采集地址在代码层固定为美国区（Apple RSS 用 `/us/rss/...`，SerpApi 用 `country=us`），无论你从哪个节点访问，评论数据始终来自美国区。
- **Node 不走环境变量代理**：服务端使用 Node 原生 `fetch`，默认不读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。请使用 **TUN / 系统级透明代理**（推荐）；若你的代理仅以环境变量方式生效，需在启动前设置 `NODE_USE_ENV_PROXY=1`，否则采集可能直连超时。

缓存回放与导入分析不依赖外网，无需代理。

### 已知现象：高热度 App 的双源空返回

对高下载量 App（Duolingo、Chase 量级），实时采集可能遇到**两个来源同时空返回**：SerpApi 报
配额或频率耗尽（`SERPAPI_RATE_OR_QUOTA_EXHAUSTED`，可在控制台核对配额后重试），而降级的
Apple RSS 也返回 HTTP 200 空体（标记为 `suspect-empty`，绝不解读为「该应用没有评论」）。此时
系统会如实记录相应的 limitation 并结束采集，**绝不伪造数据**。现场演示建议选用中小热度 App，
或直接使用缓存回放模式（离线、稳定）。

## 后台任务与刷新恢复

分析任务与浏览器连接解耦，作为后台任务运行：

- `POST /api/runs` 立即返回 `202`，响应体为 `{ runId, status: "running", eventsUrl }`；
  流水线随后通过 Next.js `after()` 在后台执行，**刷新页面、切换历史、新建其他任务都不会
  终止正在运行的分析**。请求体错误仍以 `application/problem+json` 的 4xx 返回。
- 多个任务可并行运行；「历史」面板是统一的任务列表，每 2 秒刷新一次，展示所有并行任务。
  每个任务有独立的 `runId`、事件发布器与快照目录，事件与产物互不串线。
- 客户端通过增量轮询 `GET /api/runs/{runId}/events?afterSequence=N` 获取事件，响应为
  `{ runId, status, events, lastSequence }`；单次轮询失败显示「正在重新连接」并继续重试，
  只有权威状态或终止事件才决定任务结果。缓存回放严格按事件顺序开放产物，最终报告只在它的
  `artifact.available` 事件到达后才可读取，阶段与报告不会错位。
- 页面刷新后优先恢复最新的 `running` 任务，否则回到最后查看的运行（记录失效则回到空闲页）。
  应用进程重启后，遗留的 `running` 运行显示为 `interrupted`，可重试或删除；真实运行中的任务
  不可删除（返回 `409`）。**不**支持进程重启后的断点续跑。

### 单实例约束（重要）

本应用是**单进程、单实例的本地应用**。运行中的任务状态由「磁盘 manifest + 进程内活动注册表」
共同判定（`running`/`interrupted`），**没有**跨进程的任务协调、分布式锁或数据库：

- 不要对同一份 `data/runs/`（或 `RUNS_DIR`）做多实例水平扩展 —— 第二个实例看不到第一个
  实例正在运行的任务，会把它们误判为 `interrupted`，两个实例写同一 run 目录可能互相踩踏。
- 进程重启不会断点续跑；`interrupted` 只能通过「重试」（重新创建 `runId` 全量重跑）恢复，
  不会从上次的阶段继续。
- 若要部署到多实例/多副本环境，需要先补充 Redis/DB 层任务状态（超出当前定位，尚未实现）。

## 数据来源与限制

- **主采集源（配置后）：** [SerpApi](https://serpapi.com) Apple Reviews 引擎
  `GET /search.json`，固定参数 `engine=apple_reviews`、`product_id={appId}`、`country=us`、
  `sort=mostrecent`、`no_cache=true`（强制实时，绕过 SerpApi 缓存）。认证使用服务端持有的
  `api_key`（来自 `SERPAPI_API_KEY`）。不信任响应里的 `serpapi_pagination.next` URL —— 它只
  作为「存在下一页」的信号，下一页 URL 由应用用受信任的 base URL 自行重建。应用层样本上限
  可在 `100 / 300 / 500` 之间选择（本次分析默认 100，硬上限 500），最多请求 20 页；每页通常
  约 25 条，达到所选数量后立即停止翻页并精确截断。SerpApi 不自动重试：网络结果不确定时重复
  `no_cache=true` 可能产生额外成功 search，用户可通过「重新检查」显式重试。配置方式见
  「模型提供方与配置」。
- **显式降级：** 未配置 SerpApi、认证/配额/参数错误、明确空结果、网络失败或超时时，
  自动降级到 Apple 客户评论 RSS（见下）。降级原因始终作为 limitation 展示（服务端已清洗，
  不包含原始上游错误文本），并在 UI 标记为 **Apple RSS 降级采集**；本地历史缓存是独立的，
  绝不会被伪装成实时数据。
- **部分失败：** SerpApi 首屏没有有效评论时才降级 RSS；SerpApi 已返回有效评论后发生分页失败
  时标记 `partial` 并保留已采集评论，绝不追加 RSS 数据。
- **实时（降级路径）：** Apple 客户评论 RSS
  （`/us/rss/customerreviews/page={1..10}/id={id}/sortBy=mostRecent/json`），
  顺序抓取，间隔至少 500ms，最多 10 页，不并发；与 SerpApi 一样使用所选的
  `100 / 300 / 500` 上限，达到数量后停止继续请求页面。每次 HTTP 尝试的原始响应
  body 都会原样归档到运行目录 `sources/apple/page-XX.attempt-YY.json`（本地
  git-ignored），并随 `source-evidence` 保存每一页的页码、attempt、文件引用、URL、
  HTTP 状态、安全请求头、起止时间、UTF-8 字节数、SHA-256、解析警告和评论数——
  原始响应可随时从运行目录逐字节复核，但不通过浏览器 API 暴露。这是实时网络来源，
  本地历史缓存不会被伪装成它。
- **有界、可见的重试。** HTTP 200 且第 1 页为空时，先重试两次（2 秒 / 5 秒，绕过缓存），
  之后才接受为 `suspect-empty`。当 `rel=last` 仍宣称有更多页而某页为空时，等待 2 秒后
  确认一次，然后报告为 `partial`（`RSS_UNSTABLE_PAGINATION`）；重复页会在追加前被检测到
  （`RSS_REPEATED_PAGE`）。不存在隐藏或无界的重试。
- **这是尽力而为的窗口，不是完整的评论历史。** Apple 对这一 feed 不提供公开 SLA；它通常
  只暴露最近若干页（约 ≤ 10 × 50 条）。
- **空页是模糊的。** 返回 HTTP 200 但没有条目的页会被标记为 `suspect-empty`，绝不报告为
  「该应用没有评论」。
- **部分失败**（某页失败但之前的页已成功）会继续用已采集的评论进行分析，并把限制信息
  传播到所有地方。
- **本地评论缓存与混合来源。** 实时评论（无论来自 SerpApi 还是 RSS 降级）都会合并进
  `data/source-cache/`（git-ignore）下的本地按应用缓存，按评论 ID 去重，硬上限为最近 500 条。
  实时运行会先预览样本 —— 表单的主要操作是 **检查评论样本**，它会展示实时样本和稳定（缓存）
  样本供你选择；实时抓取和稳定样本都受本次分析所选数量（默认 100 条）约束，而缓存文件自身
  仍保留最多 500 条，供以后选择更大样本。选择稳定样本会按 App ID 隔离、去重、最新优先，取
  时间倒序的前 N 条本地历史 —— 稳定样本绝不会被伪装成完整的实时采集，选择它也不算实时获取。
- **导入：** 本应用无法验证导入数据的来源；真实性与合法使用由你负责。
- **聚合评分**（通过 iTunes Lookup）仅作为上下文展示；它不是评论正文，也绝不替代评论采集。

## 模型提供方与配置

| 环境变量 | 含义 |
|---|---|
| `MODEL_BASE_URL` | OpenAI 兼容 API 根地址（客户端会追加 `/chat/completions`） |
| `MODEL_API_KEY` | bearer token；本地运行时可以为空 |
| `MODEL_NAME` | 模型标识 |
| `MODEL_JSON_MODE` | `prompt`（默认）或 `json_object` |
| `MODEL_REASONING_EFFORT` | `low`、`medium`（默认）、`high` 或 `max` |

把 `.env.example` 复制为 `.env`（git-ignore）并填写你的值。密钥永远不会被记录日志、
持久化或提交。Temperature 固定为 0.1。

**你也可以在界面中配置模型：** 打开顶栏的 **设置**，填写 API Base URL、API Key、模型名称、
JSON 模式和推理强度。保存后立即生效（无需重启），并持久化到本地 git-ignore 的
`data/config.local.json`，重启后仍保留；`.env.local` / `.env` 仍作为启动配置生效，老用户无需
迁移。API Key 永远不会返回给客户端 —— 面板只显示是否已配置，并提供清除选项。

**数据采集平台（SerpApi）：** 在 **设置 → 数据采集平台** 的密码输入框中保存
SerpApi API Key，或直接在本机 `.env.local` 中设置 `SERPAPI_API_KEY=`（作为启动配置）。
保存/清除立即生效，无需重启。该 Key 仅由服务端持有并用于强制实时采集 App Store 评论，绝不会进入
浏览器 bundle、HTTP 响应、日志、预览 JSON、运行快照或 git 跟踪文件 —— 面板只显示
「已配置 / 未配置」，不提供查看、复制或掩码尾号。请勿把真实 Key 粘贴进 README、
`.env.example`、截图或 issue 文本；在本对话中披露过的 Key 应先在 SerpApi 控制台轮换再使用。
测试仅允许回环地址覆盖 `SERPAPI_BASE_URL`（生产必须使用 `https://serpapi.com`）。
SocialCrawl 活动集成已删除；旧回放可能仍显示旧来源 provenance。

自带的演示 fixture 分析时使用了一个 DeepSeek 兼容端点（`deepseek-v4-flash`）；该配置记录在
每个 fixture 的 `provenance.json` 里，回放**并不需要**它。

> [!IMPORTANT]
> **模型选型与兼容性说明：**
> - **推荐模型**：开发与测试全链路深度基准模型为 **`deepseek-v4-flash`**。该模型对复杂结构化 JSON 规范、严格字段契约（Schema Constraints）以及精确证据引文的遵从度最高，运行最为稳定可靠。
> - **更换其他模型（如 Qwen 系列等）的注意事项**：当前流水线的各阶段对模型输出实施了严格的 Zod Schema 确定性校验（如要求非空支撑列表、规范 ID 前缀等）。若切换为其他大模型（如通义千问 `qwen`、Llama 等开源或商用模型），可能会因模型在长上下文分块分析中偶发输出空支撑列表（`supportingReviewIds: []`）、缺失字段或格式偏差，触发 `MODEL_SCHEMA_VIOLATION` 导致分析中断。如果遇到运行不稳定，建议优先切回推荐的 `deepseek-v4-flash` 模型。

各阶段的规则 vs 模型权衡、提示词版本和失败处理的说明，见 `docs/model-analysis.md`。

## 提示词与幻觉控制

- 提示词位于 `src/server/model/prompts/*.ts`（一个版本一个文件），带版本号（`scope@2`，……）。
- 评论正文始终被视为**不可信数据**；提示词禁止遵从评论者的指令。
- 每个模型结果都按 Zod schema 校验。
- 模型只会收到目标、带稳定 ID 的评论、确定性统计和此前已允许的 ID。
- 证据摘录必须是所引用评论正文的精确子串——摘录与正文同样施加 NFC 规范化 + 空白折叠后比对
  （允许与原文存在大小写与空白差异）；样本数量和置信度由代码计算，绝不取自模型。
- 没有有效支撑的发现会被删除；没有支撑的想法会变成独立的 `assumptions`，绝不会成为需求。
- 追溯是确定性校验的；一次受约束的修订可以删除/修复/降级，但不能新增引用或新摘录。再次失败
  是明确的：运行以 `run.failed` 结束，失败的 manifest 携带
  `TRACEABILITY_INVALID_AFTER_REVISION` —— 绝不捏造成功。修订后的产物以 attempt-02 发布，
  因此界面永远不会展示修订前的陈旧输出。

## 导入格式

`docs/import-format.md` 记录了 JSON v1 和 CSV v1 的 schema、必填字段、限制和校验行为。
同源去重只做精确去重。

## 追溯规则

`review → finding → requirement → test`：

- 一个 `finding` 引用 ≥1 条评论，**每条**都有精确摘录支撑；其样本数量和置信度由代码推导。
  没有精确摘录的支撑评论会被丢弃，而不是用来虚增样本。
- **证据充分性（确定性 v1）** —— 每个 finding 都会得到代码关于其证据能否支撑 *广泛或关键*
  主张的裁定。当 finding 的支撑评论少于 3 条、支撑占比低于被评语料库的 1%、数据来源不是
  `complete`、或冲突数达到支撑评论数（满足任一条件即判为 `insufficient`）时，该 finding 判为
  证据不足。`insufficient` 的 finding 作为受限制、可审计的事实保留 —— 它不会被删除，也绝不
  冒充「没有证据」—— 但它不能产生 P0/P1 需求或目标版本：只由证据不足的 finding 支撑的
  需求会被固定为 `P2` 且 `versionId: null`，并从每个版本的范围中剔除。当没有任何 finding
  通过校验时，流水线会在 scope/topics/findings 之后停止，带 `INSUFFICIENT_EVIDENCE`
  限制和 `completed/insufficient-evidence` 结果；绝不回放成一次完整分析。
- 用户的分析目标会被解释为真正生效的通用范围筛选（评分/版本/语言/日期）：后续阶段只分析
  匹配范围条件的评论。
- 一个 `requirement` 引用 ≥1 个 finding；其来源评论是这些 finding 证据的并集。
- 一个 `test` 引用 ≥1 个 requirement，且只引用所引用需求证据并集内部的评论；每个需求都必须
  被覆盖。测试的**发现 ID 与优先级由代码**根据需求图推导（所关联需求的 finding 并集；
  取最紧急的优先级），并以同样方式校验 —— 模型从不提供它们，篡改会被拒绝为
  `TEST_FINDING_MISMATCH` / `TEST_PRIORITY_MISMATCH`。
- 假设永远不会成为需求，也永远不会生成测试。
- **旧缓存回放兼容。** 在充分性 / 直接发现契约之前生成的缓存产物仍可回放：没有
  `evidenceSufficiency` 字段的 finding 只展示置信度；缺少 `findingIds` / `priority` 的测试用例
  会在展示层从其需求推导。自带的 fixtures 不会被改写。
- 完整的不变量列表见 `src/domain/traceability/validate.ts`。

## 缓存回放与数据真实性

- 每次运行都可以从快照离线回放，无需网络、无需模型；界面的 **缓存回放** 模式会列出可回放的
  运行，并在新的运行 ID 下重新物化所有产物，标记为 **缓存回放**，且从不调用 Apple 或模型。
- `fixtures/demo-runs/` 下自带**两个真实**演示 fixture，均为美国区 App Store 的真实抓取、
  由真实模型分析、已做隐私最小化处理、带完整溯源：
  - `run-x-twitter-us/` —— App ID 333903271（「X」）；
  - `run-workout-for-women-us/` —— App ID 839285684（「Workout for Women」，即本评估的主示例）。
  - 刻意附带两个不同品类 App，用于证明流水线未针对任何单一 App 写死。
  - 每个 fixture 保留评论 ID / 评分 / 标题 / 正文 / 版本 / 时间戳，移除评论者昵称、作者
    URI 和敏感请求头；其 `provenance.json` 记录抓取时间、来源 URL 模式、商店地区、模型、
    temperature 和提示词版本。
- 真实快照会被如实标记。应用绝不把 mock、规则后备或静态文本伪装成实时模型结果。

## 失败处理

- 针对网络 / HTTP / 超时 / 非 JSON / schema 违规分别有错误码，以 `run.failed` 事件暴露，
  并保留阶段与错误信息。
- 模型调用会做有界次数的重试：最多 **3 次尝试**（1 次初始尝试加最多 2 次重试），退避为
  1 秒 / 2 秒。只有瞬时失败才重试 —— 5xx、网络错误、单次调用超时、非 JSON / 截断响应。
  4xx、schema 违规和客户端断连立即失败。每次重试都会以 `stage.progress` 消息暴露（例如
  `model retry 2/3 in 1s (MODEL_HTTP_ERROR)`），运行 manifest 的 `modelUsage` 会记录
  `attempts`、`retries` 和 `retryReasons`（绝不记录响应正文或密钥）。RSS 也会对第 1 页做
  有界次数的重试（见「数据来源与限制」）。
- 没有模型时，导入/实时分析仍会运行确定性阶段（采集/导入、清洗、去重、统计），并以
  `MODEL_NOT_CONFIGURED` 限制完成；目录和缓存回放始终可用。

## 测试

```bash
npm run lint
npm run typecheck
npm run test:unit          # domain、server、model、components
npm run test:integration   # pipeline、import、revision、replay、真实 fixture
npm run build
npm run test:e2e           # 实时（stubbed upstream）、导入、缓存回放
npm run verify             # lint + typecheck + coverage + build
```

覆盖率阈值（行/语句/函数/分支 ≥ 80%）适用于 `src/domain/**` 和 `src/server/**`。

## 项目结构

```text
src/domain/contracts/    Zod schemas（reviews、analysis、events、runs）
src/domain/reviews/      normalize、dedupe、language、stats
src/domain/analysis/     evidence、confidence
src/domain/traceability/ 确定性校验器
src/server/sources/      App Store URL、Apple RSS 采集器/解析器、导入
src/server/model/        OpenAI 兼容客户端、脚本化客户端、提示词
src/server/runs/         run store、catalog、replay
src/server/pipeline/     各阶段 + orchestrator
src/app/api/             config / runs / manifest / artifact 路由
src/components/          双语工作台 UI
src/i18n/                en / zh-CN 词典
scripts/                 capture + demo build + docs check
fixtures/demo-runs/      真实、可回放快照
```

## 隐私与安全

- `.env*`、`data/runs/`、覆盖率与测试产物均为 git-ignore。
- 评论正文会发送到你配置的模型端点；请使用你信任的端点。
- 运行快照绝不包含 API Key；模型使用元数据只记录 provider / model / temperature /
  version / duration / tokens。
- 评论者身份字段不会被存储；自带 fixture 已做隐私最小化处理。
- 这是本地单用户应用。不要直接暴露到公网。

## 非目标

不提供账号、协作、云部署、后台队列、数据库或 App Store Connect 私有 API。模糊/嵌入去重和
无界或语义式的模型自我纠错重试是有意排除在外的（传输层重试是有界且可见的，见「失败处理」）。

---

[English version](README.en.md) · [中文](README.md)
