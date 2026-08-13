# Apple RSS 缺失 entry 分类修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将含合法 `feed` 但缺少 `entry` 属性的 Apple RSS HTTP 200 响应分类为 `RSS_SUSPECT_EMPTY`，同时保持非 JSON、缺少 `feed`、以及非数组 `entry` 为结构失败。

**Architecture:** 在 parser 边界区分“属性缺失”和“属性存在但类型错误”。collector 继续依据 parser warning 判断结构失败；缺失 `entry` 时沿现有 `suspect-empty` 路径进入 prepare、跳过所有模型阶段，并以 `completed/insufficient-data` 结束，无需修改下游编排。

**Tech Stack:** TypeScript 6、Vitest 4、Node.js 22

## Global Constraints

- 不把空 feed 解释为“没有评论”。
- 没有评论时不得进入模型分析阶段。
- 实施阶段只修改下方列出的 parser、相关测试和 fixture；不做相邻重构。
- 不触碰当前未提交的 `src/server/model/openai-compatible-client.ts` 及其测试。
- 不提交、推送、合并或部署。

## Success Criteria

- 合法 `feed` 缺少 `entry`：parser 返回零评论且无结构 warning。
- 同一响应经 collector 后为 `status: "suspect-empty"`，包含 `RSS_SUSPECT_EMPTY`，不包含 `RSS_NON_JSON`。
- 同一响应经完整 pipeline 后不调用模型，manifest 为 `completed`；run outcome 沿现有路径为 `insufficient-data`。
- `entry` 存在但不是数组时仍为 `failed/RSS_NON_JSON`。
- 非 JSON 与缺少 `feed` 的现有分类不变。

---

### Task 1: 区分缺失 entry 与损坏 entry

**Files:**
- Modify: `src/server/sources/apple-rss-parser.test.ts`
- Modify: `src/server/sources/apple-rss-collector.test.ts`
- Modify: `src/server/sources/apple-rss-parser.ts`
- Modify: `tests/integration/pipeline-live.test.ts`
- Create: `tests/fixtures/apple/empty-feed-no-entry.json`

**Interfaces:**
- Consumes: `parseAppleRssJson(body: string): AppleRssParseResult`
- Produces: 缺失 `feed.entry` 时返回空 `reviews` 且不产生结构 warning；`collectAppleReviews(deps)` 因而返回 `status: "suspect-empty"` 和 `RSS_SUSPECT_EMPTY`；`executeRun(...)` 不进入模型阶段并以 `completed/insufficient-data` 结束。

- [ ] **Step 1: 保存真实空响应 fixture**

创建 `tests/fixtures/apple/empty-feed-no-entry.json`，内容使用 2026-08-12 实际收到的 Apple 响应结构：

```json
{
  "feed": {
    "author": {
      "name": { "label": "iTunes Store" },
      "uri": { "label": "http://www.apple.com/itunes/" }
    },
    "updated": { "label": "2026-08-12T21:19:36-07:00" },
    "rights": { "label": "Copyright 2008 Apple Inc." },
    "title": { "label": "iTunes Store: Customer Reviews" },
    "icon": { "label": "http://itunes.apple.com/favicon.ico" },
    "link": [
      {
        "attributes": {
          "rel": "alternate",
          "type": "text/html",
          "href": "https://music.apple.com/WebObjects/MZStore.woa/wa/viewGrouping?cc=us&id=1"
        }
      },
      {
        "attributes": {
          "rel": "self",
          "href": "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json"
        }
      },
      { "attributes": { "rel": "first", "href": "" } },
      { "attributes": { "rel": "last", "href": "" } },
      { "attributes": { "rel": "previous", "href": "" } },
      { "attributes": { "rel": "next", "href": "" } }
    ],
    "id": {
      "label": "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json"
    }
  }
}
```

- [ ] **Step 2: 写 parser 失败测试**

```ts
it("treats a feed with no entry property as an empty feed", () => {
  const result = parseAppleRssJson(fixture("empty-feed-no-entry.json"));
  expect(result.reviews).toHaveLength(0);
  expect(result.warnings).toHaveLength(0);
});
```

- [ ] **Step 3: 写 collector 失败测试**

```ts
it("treats an HTTP 200 feed with no entry property as suspect-empty", async () => {
  const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
  const deps = depsFor({ [url1]: fixture("empty-feed-no-entry.json") });
  const result = await collectAppleReviews(deps);
  expect(result.status).toBe("suspect-empty");
  expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
  expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(false);
});
```

- [ ] **Step 4: 添加损坏 entry 的 collector 守护测试**

```ts
it("keeps a non-array entry property classified as RSS_NON_JSON", async () => {
  const url1 = "https://itunes.apple.com/us/rss/customerreviews/page=1/id=839285684/sortby=mostRecent/json";
  const deps = depsFor({ [url1]: fixture("malformed-feed.json") });
  const result = await collectAppleReviews(deps);
  expect(result.status).toBe("failed");
  expect(result.limitations.some((l) => l.code === "RSS_NON_JSON")).toBe(true);
  expect(result.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(false);
});
```

- [ ] **Step 5: 把现有 pipeline 空 feed 测试改为真实缺失 entry 响应**

将 `tests/integration/pipeline-live.test.ts` 的空 feed 用例改为：

```ts
it("marks a feed with no entry property suspect-empty and does not enter model stages", async () => {
  const model = new ScriptedModelClient([], new Error("MODEL should not be called"));
  const deps = makeDeps(model);
  const emptyFeedWithoutEntry = readFileSync(
    path.join(process.cwd(), "tests", "fixtures", "apple", "empty-feed-no-entry.json"),
    "utf8",
  );
  deps.fetchFn = (async () => new Response(emptyFeedWithoutEntry, { status: 200 })) as unknown as typeof fetch;
  const runId = store.createRunId();
  const publisher = new EventPublisher(store, () => "2026-08-12T00:00:00.000Z", "live");

  await executeRun(runId, "Understand pricing", "en", deps, publisher, store);

  const manifest = await store.readManifest(runId);
  expect(manifest.status).toBe("completed");
  expect(manifest.limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")).toBe(true);
  expect(model.callIndex).toBe(0);
});
```

- [ ] **Step 6: 运行新增测试并确认 RED**

Run:

```bash
npx vitest run --project unit src/server/sources/apple-rss-parser.test.ts src/server/sources/apple-rss-collector.test.ts
npx vitest run --project integration tests/integration/pipeline-live.test.ts
```

Expected: “缺失 `entry`”的 parser、collector 和 pipeline 测试因当前 `MISSING_ENTRIES` / `RSS_NON_JSON` / `failed` 行为失败；“非数组 `entry`”守护测试通过。

- [ ] **Step 7: 写最小实现**

在读取 `entry` 后，仅当该属性存在但不是数组时返回 `MISSING_ENTRIES`：

```ts
const feedObject = feed as { entry?: unknown };
if (!("entry" in feedObject)) {
  return { reviews, warnings, rawRefs };
}
const entries = feedObject.entry;
if (!Array.isArray(entries)) {
  return { reviews, warnings: [{ code: "MISSING_ENTRIES", message: "feed.entry is not an array" }], rawRefs };
}
```

- [ ] **Step 8: 运行相关测试并确认 GREEN**

Run:

```bash
npx vitest run --project unit src/server/sources/apple-rss-parser.test.ts src/server/sources/apple-rss-collector.test.ts
npx vitest run --project integration tests/integration/pipeline-live.test.ts
```

Expected: 两个 unit 测试文件和 pipeline integration 测试文件全部通过。

- [ ] **Step 9: 运行完整验证**

Run: `npm run verify`

Expected: lint、类型检查、文档检查、覆盖率测试和生产构建均退出 0。

- [ ] **Step 10: 检查差异范围**

Run: `git diff -- src/server/sources/apple-rss-parser.ts src/server/sources/apple-rss-parser.test.ts src/server/sources/apple-rss-collector.test.ts tests/integration/pipeline-live.test.ts tests/fixtures/apple/empty-feed-no-entry.json docs/superpowers/plans/2026-08-12-apple-rss-suspect-empty.md`

Expected: 只包含上述测试、最小 parser 分支和计划文档，不包含相邻重构。
