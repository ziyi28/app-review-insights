# App Review Analysis Workbench Implementation Plan

完整可执行计划保存在本次 Claude Code 会话计划文件：

`C:\Users\20937\.claude\plans\cozy-tickling-mccarthy.md`

## 目标

从零构建一个中英双语 Next.js 工作台，将美国区 App Store 评论转换为有证据链的动态主题、产品发现、版本计划、PRD 与测试用例，并支持真实缓存运行的离线回放。

## 实施批次

1. 建立规格文档、Git 边界与功能分支。
2. 搭建 Next.js、测试与验证骨架。
3. 定义 Zod 领域协议与 US App Store URL 限制。
4. 实现 Apple RSS collector 与 JSON/CSV importer。
5. 实现清洗、精确去重、语言标签与统计。
6. 实现文件快照、事件发布与 NDJSON 解析。
7. 实现 OpenAI 兼容模型网关与版本化 prompts。
8. 实现 Scope、动态 Topics、Findings、PRD 与 Tests 阶段。
9. 实现确定性追溯验证与一次定向修订。
10. 组装 Orchestrator、API 与 Cached Replay。
11. 构建中英双语工作台 UI。
12. 添加 E2E 外部服务桩与三条主路径。
13. 捕获并校验真实美国区缓存运行。
14. 完成 README、覆盖率、QA、审查与发布前检查。

## 全局约束

- 在 `feat/app-review-analysis` 分支开发，不在 `main` 上实现。
- 核心语义任务运行时由模型驱动，禁止固定问题 taxonomy。
- Live 评论只使用美国区 Apple Customer Reviews RSS；空 feed 标 `suspect-empty`，不得解释为无评论。
- OpenAI 兼容模型通过环境配置接入，温度固定 0.1，密钥不入代码/日志/快照/Git。
- 所有模型结果、持久化产物和流事件经过 Zod 校验。
- Finding、Requirement、Test 必须保持 review → finding → requirement → test 证据链。
- 第一次追溯失败最多一次定向修订，且不能增加 citation pair。
- 无网络或模型时仅支持醒目标记的 Cached Replay。
- 不做账号、协作、云部署、后台队列、数据库、WebSocket 或 App Store Connect 私有 API。
- 每个功能单元按 TDD 执行并验证；commit、push、merge、deploy 均等待用户明确授权。

## 质量门

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e
npm run verify
```

核心覆盖率 lines/statements/functions/branches 均不低于 80%。

> 详细的文件级接口、失败测试、实现步骤、验证命令、快照布局和 E2E 矩阵见会话计划文件。项目实现完成后，将根据最终代码同步扩充本文件为独立可执行版本，避免计划与实际结构漂移。
