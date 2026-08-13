# Dual App Store Review Sources Implementation Plan

> **Status:** Superseded before implementation. P0/P1 are already complete; for the current acquisition change, execute `docs/superpowers/plans/2026-08-13-socialcrawl-live-review-collection.md` instead. Do not execute this App Store Connect proposal.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同时提供“任意公开 App 的最新 RSS + 历史缓存融合分析”和“有权限自家 App 的 App Store Connect 官方分页分析”，并让 UI、运行证据和限制说明准确区分两种来源。

**Architecture:** 保留公共 Apple RSS collector 与现有按 `US storefront + appId` 隔离的 500 条缓存，把公共模式明确建模为“最新样本”和“最新 + 历史融合样本”。新增完全独立的 App Store Connect JWT 签名器与分页 collector，通过服务端环境变量配置凭据，按 `links.next` 获取美国区最多 500 条；预览快照以 `requestedAccessMode` / `effectiveAccessMode` 记录选择和显式回退，分析运行只消费已冻结的预览，不二次请求上游。

**Tech Stack:** Next.js 16.3 App Router Route Handlers、TypeScript、Node.js `crypto`（ES256 JWT）、Zod、Vitest、Testing Library、Playwright。

## Global Constraints

- 所有评论统一限定美国区：公共 RSS 使用 `/us/`，App Store Connect 使用 `filter[territory]=USA`。
- App Store Connect 单页 `limit` 最大 200，按 `-createdDate` 排序，跟随 `links.next`，单次预览最多保留 500 条。
- App Store Connect 私钥、Key ID、Issuer ID 只能存在于服务端环境变量；不得进入浏览器响应、日志、事件、artifact、缓存、测试快照或 git 跟踪文件。
- App Store Connect API Key 通过 `APP_STORE_CONNECT_ISSUER_ID`、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_PRIVATE_KEY` 配置；私钥支持真实换行或双引号中的 `\n`。
- 公共 App 首次预览只承诺 Apple 当前可返回的最新样本，通常约 50 条；“最多 500 条”仅指同一 App 跨次采集/历史运行去重后的融合缓存，不得描述为一次实时抓取 500 条。
- App Store Connect 成功返回 0 条时视为可信空结果；仅在未配置、配置不完整、401、403、404、429 重试耗尽、5xx/网络失败且未采到任何评论时显式回退公共模式。
- App Store Connect 已采到至少一页后发生失败时保留已采数据并标记 `partial`，不得切换来源后把两个 provider 的结果静默混合。
- 公共 RSS 与 App Store Connect 使用独立来源标识和证据，不把 RSS 数字评论 ID 与 Connect UUID 当成同一 ID 去重。
- 继续支持中国区 App 页面 URL 输入，但所有评论查询仍使用美国区。
- 保留导入、缓存回放、预览 30 分钟 TTL、模型调用、证据验证、版本规划和 Draft/Final 行为。
- 不新增第三方评论抓取、网页 DOM 抓取或 Apple 内部未公开 bearer token 方案。
- 官方接口参考：`GET /v1/apps/{id}/customerReviews`，字段 `rating,title,body,createdDate,territory`，`limit<=200`，`sort=-createdDate`，响应通过 `links.next` 分页。
- 当前工作树已有公共 RSS 修复和文档修改；执行时先核对并保留 `README.md`、设计文档、collector 及其测试的未提交差异，绝不修改或暂存用户的 `docs/goal.md`。
- 下列 commit 步骤只是审查检查点；除非用户在执行阶段明确授权，不实际运行 `git commit`。

## Success Criteria

- 公共模式使用无页码 RSS 入口获取第一页；分页异常时仍展示已取得的最新评论和 `partial` 限制。
- 公共融合卡片分别显示 `freshReviewCount`、`cachedOnlyReviewCount`、`reviewCount`，三者关系可由 ID 集合独立验证。
- 配置有效凭据时，Connect 模式按游标分页取得美国区最多 500 条，并在预览和 source evidence 中显示 `totalAvailable`、请求数和采集数。
- 未配置或无权限时，Connect 模式自动进入公共模式，并向用户显示稳定的 `ASC_*` 回退原因；不得假装官方采集成功。
- Connect 私钥不会出现在 `/api/config`、`/api/source-previews`、run event、artifact、测试输出和 `git grep` 结果中。
- 公共、Connect、公共回退、导入和缓存回放均有自动化验收覆盖。

---

### Task 1: Stabilize the public first page and expose hybrid composition

**Files:**
- Modify: `src/server/sources/apple-rss-collector.ts:60-122`
- Modify: `src/server/sources/apple-rss-collector.test.ts:1-250`
- Modify: `src/server/sources/source-preview.ts:18-105`
- Modify: `src/server/sources/source-preview.test.ts:69-149`
- Modify: `src/server/sources/apple-review-cache.ts:17-35`

**Interfaces:**
- Consumes: `collectAppleReviews(deps: CollectorDeps): Promise<SourceResult>` and `AppleReviewCacheStore.mergeLive(...)`.
- Produces: `buildPageUrl(baseUrl, 1, appId)` without `/page=1`; `stable.freshReviewCount: number`; `stable.cachedOnlyReviewCount: number`.

- [ ] **Step 1: Add the failing public endpoint contract tests**

Add two literal URL assertions to `apple-rss-collector.test.ts`:

```ts
it("uses Apple's stable no-page entry point for the first public page", () => {
  expect(buildPageUrl("https://itunes.apple.com/us/rss/customerreviews", 1, "839285684")).toBe(
    "https://itunes.apple.com/us/rss/customerreviews/id=839285684/sortBy=mostRecent/json",
  );
});

it("keeps the page segment for public pages after page one", () => {
  expect(buildPageUrl("https://itunes.apple.com/us/rss/customerreviews", 2, "839285684")).toBe(
    "https://itunes.apple.com/us/rss/customerreviews/page=2/id=839285684/sortBy=mostRecent/json",
  );
});
```

The production mutation caught by these tests is reintroducing the unstable `/page=1/` entry or the case-sensitive `sortBy` typo.

- [ ] **Step 2: Run the endpoint tests and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/sources/apple-rss-collector.test.ts -t "stable no-page|pages after page one"
```

Expected: the page-one assertion fails because the current builder includes `/page=1/`; the page-two assertion passes.

- [ ] **Step 3: Implement the smallest page-one URL change**

Replace `buildPageUrl` with:

```ts
export function buildPageUrl(baseUrl: string, page: number, appId: string): string {
  if (page === 1) {
    return `${baseUrl}/id=${appId}/sortBy=mostRecent/json`;
  }
  return `${baseUrl}/page=${page}/id=${appId}/sortBy=mostRecent/json`;
}
```

Keep the App-specific `Mozilla/5.0 (compatible; AppReviewPlanner/1.0)` header added by the current uncommitted fix. Update literal page-one keys in collector tests; keep page-two keys paged.

- [ ] **Step 4: Verify the public collector GREEN**

Run:

```powershell
npx vitest run --project unit src/server/sources/apple-rss-collector.test.ts
$env:LIVE_SMOKE='1'; npx vitest run --project integration tests/integration/live-smoke.test.ts --reporter=verbose --disableConsoleIntercept
```

Expected: unit tests pass; the live smoke reports either non-empty `complete`/`partial` or a truthful upstream limitation. The smoke remains non-blocking because Apple RSS has no public SLA.

- [ ] **Step 5: Add failing hybrid-composition tests**

In `source-preview.test.ts`, seed cache IDs `old` and `shared`, return live IDs `new` and `shared`, then assert literal counts:

```ts
it("reports fresh and cached-only composition for the public hybrid sample", async () => {
  mockedCollect.mockResolvedValue(
    liveResult({
      reviews: [raw("new", "2026-08-05T00:00:00Z"), raw("shared", "2026-08-04T00:00:00Z")],
    }),
  );
  const cacheStore = new AppleReviewCacheStore(cacheDir);
  await cacheStore.mergeLive("us", "839285684", [
    raw("old", "2026-08-01T00:00:00Z"),
    raw("shared", "2026-08-02T00:00:00Z"),
  ]);

  const preview = await runPreviewImpl(makeInput());

  expect(preview.stable.freshReviewCount).toBe(2);
  expect(preview.stable.cachedOnlyReviewCount).toBe(1);
  expect(preview.stable.reviewCount).toBe(3);
});

function pageEvidence(attempt: number): SourceResult["pages"][number] {
  return {
    url: `https://itunes.apple.com/us/rss/customerreviews/id=839285684/sortBy=mostRecent/json?attempt=${attempt}`,
    finalUrl: `https://itunes.apple.com/us/rss/customerreviews/id=839285684/sortBy=mostRecent/json?attempt=${attempt}`,
    startedAt: "2026-08-12T00:00:00.000Z",
    finishedAt: "2026-08-12T00:00:01.000Z",
    httpStatus: 200,
    headers: { "content-type": "application/json" },
    byteLength: 100,
    sha256: "a".repeat(64),
    page: 1,
    attempt,
    reviewCount: attempt === 2 ? 1 : 0,
    parserWarnings: [],
    contentType: "application/json",
  };
}

it("counts distinct public pages separately from retry requests", async () => {
  mockedCollect.mockResolvedValue(
    liveResult({
      reviews: [raw("new", "2026-08-05T00:00:00Z")],
      pages: [pageEvidence(1), pageEvidence(2)],
    }),
  );

  const preview = await runPreviewImpl(makeInput());

  expect(preview.live.pageCount).toBe(1);
  expect(preview.live.requestCount).toBe(2);
});
```

- [ ] **Step 6: Run the composition test and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/sources/source-preview.test.ts -t "fresh and cached-only composition"
```

Expected: TypeScript/test failure because the two composition fields do not exist.

- [ ] **Step 7: Derive composition from independent ID sets**

Extend `SourcePreview["stable"]` with:

```ts
freshReviewCount: number;
cachedOnlyReviewCount: number;
```

After loading `cacheReviews`, calculate counts from the reviews that actually survived the 500-item cache cap:

```ts
const freshIds = new Set(live.reviews.map((review) => review.sourceReviewId));
const freshReviewCount = cacheReviews.filter((review) => freshIds.has(review.sourceReviewId)).length;
const cachedOnlyReviewCount = cacheReviews.filter((review) => !freshIds.has(review.sourceReviewId)).length;
```

Populate both values and compute live request metrics as:

```ts
pageCount: new Set(liveResult.pages.map((page) => page.page)).size,
requestCount: liveResult.pages.length,
```

This guarantees `stable.freshReviewCount + stable.cachedOnlyReviewCount === stable.reviewCount` and stops retries of page 1 from being displayed as three distinct pages. Do not change the existing 500-item cache cap, ordering, or empty-merge behavior.

- [ ] **Step 8: Verify public preview and cache behavior**

Run:

```powershell
npx vitest run --project unit src/server/sources/source-preview.test.ts src/server/sources/apple-review-cache.test.ts
```

Expected: both files pass, including cache cap, no-shrink, bootstrap, and literal `2 fresh + 1 cached-only = 3 total` coverage.

- [ ] **Step 9: Commit checkpoint if authorized**

```powershell
git add src/server/sources/apple-rss-collector.ts src/server/sources/apple-rss-collector.test.ts src/server/sources/source-preview.ts src/server/sources/source-preview.test.ts src/server/sources/apple-review-cache.ts
git commit -m "fix: stabilize public review sampling"
```

---

### Task 2: Add server-only App Store Connect configuration and ES256 JWT signing

**Files:**
- Create: `src/server/sources/app-store-connect-auth.ts`
- Create: `src/server/sources/app-store-connect-auth.test.ts`
- Modify: `src/server/config.ts:43-102`
- Modify: `src/server/config.test.ts:1-100`
- Modify: `src/app/api/config/route.ts:10-27`
- Modify: `src/app/api/config/route.test.ts:28-53`
- Modify: `.env.example:1-18`

**Interfaces:**
- Consumes: three non-public environment variables and Node.js P-256 private-key support.
- Produces: `AppStoreConnectConfiguration`; `isAppStoreConnectConfigured(config)`; `createAppStoreConnectToken(credentials, nowMs)`.

- [ ] **Step 1: Add failing configuration-state tests**

Add cleanup for all `APP_STORE_CONNECT_*` variables in `config.test.ts`, then add:

```ts
it("distinguishes absent, incomplete, and configured App Store Connect credentials", () => {
  expect(loadConfig().appStoreConnect).toEqual({ status: "not-configured" });

  process.env.APP_STORE_CONNECT_ISSUER_ID = "issuer-1";
  expect(loadConfig().appStoreConnect).toEqual({
    status: "incomplete",
    missing: ["APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_PRIVATE_KEY"],
  });

  process.env.APP_STORE_CONNECT_KEY_ID = "KEY123";
  process.env.APP_STORE_CONNECT_PRIVATE_KEY = "line-1\\nline-2";
  expect(loadConfig().appStoreConnect).toEqual({
    status: "configured",
    issuerId: "issuer-1",
    keyId: "KEY123",
    privateKey: "line-1\nline-2",
  });
});
```

Add a `/api/config` test that sets a sentinel private key, expects `appStoreConnectStatus === "configured"`, and verifies `JSON.stringify(response)` does not contain the sentinel.

- [ ] **Step 2: Run configuration tests and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/config.test.ts src/app/api/config/route.test.ts
```

Expected: failures because `appStoreConnect` and the public status field do not exist.

- [ ] **Step 3: Implement the configuration discriminated union**

Add to `config.ts`:

```ts
export type AppStoreConnectConfiguration =
  | { status: "not-configured" }
  | { status: "incomplete"; missing: string[] }
  | { status: "configured"; issuerId: string; keyId: string; privateKey: string };
```

Add `appStoreConnect`, `appStoreConnectMaxReviews`, `appStoreConnectTimeoutMs`, and `appStoreConnectBaseUrl` to `ServerConfig`. Build the credential state from exact trimmed values; normalize only literal `\\n` in the private key. Clamp max reviews to `1..500`, floor timeout at `1_000`, and accept a non-Apple base URL only when it is loopback:

```ts
function appStoreConnectBaseUrl(env: NodeJS.ProcessEnv): string {
  const official = "https://api.appstoreconnect.apple.com";
  const raw = env.APP_STORE_CONNECT_BASE_URL?.trim();
  if (!raw) return official;
  const candidate = new URL(raw);
  const loopback = candidate.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(candidate.hostname);
  if (candidate.origin !== official && !loopback) return official;
  return candidate.origin;
}
```

This override exists only for the isolated local E2E upstream. Authorization must never be sent to any other origin.

- [ ] **Step 4: Expose status without exposing credentials**

Add:

```ts
export function isAppStoreConnectConfigured(cfg: ServerConfig): boolean {
  return cfg.appStoreConnect.status === "configured";
}
```

Return only the following additional values from `/api/config`:

```ts
appStoreConnectStatus: cfg.appStoreConnect.status,
limits: {
  appleRssMaxPages: cfg.appleRssMaxPages,
  appleRssPageDelayMs: cfg.appleRssPageDelayMs,
  importMaxBytes: 2_000_000,
  maxReviews: 1_000,
  appStoreConnectMaxReviews: cfg.appStoreConnectMaxReviews,
},
```

Do not add App Store Connect values to the settings POST schema; credentials remain environment-managed.

- [ ] **Step 5: Verify configuration GREEN**

Run:

```powershell
npx vitest run --project unit src/server/config.test.ts src/app/api/config/route.test.ts
```

Expected: config-state, newline normalization, clamping, loopback restriction, and secret non-disclosure tests pass.

- [ ] **Step 6: Add the failing JWT contract test**

Create `app-store-connect-auth.test.ts` using a generated P-256 key pair:

```ts
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAppStoreConnectToken } from "./app-store-connect-auth";

it("creates a verifiable ten-minute ES256 App Store Connect token", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const token = createAppStoreConnectToken(
    {
      issuerId: "69a6de95-1111-2222-3333-47e3bb22d52f",
      keyId: "ABC123DEFG",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
    Date.parse("2026-08-13T00:00:00.000Z"),
  );
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  expect(JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"))).toEqual({
    alg: "ES256",
    kid: "ABC123DEFG",
    typ: "JWT",
  });
  expect(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))).toEqual({
    iss: "69a6de95-1111-2222-3333-47e3bb22d52f",
    iat: 1786579200,
    exp: 1786579800,
    aud: "appstoreconnect-v1",
  });
  expect(
    verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(encodedSignature, "base64url"),
    ),
  ).toBe(true);
});
```

- [ ] **Step 7: Run the JWT test and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/sources/app-store-connect-auth.test.ts
```

Expected: import failure because the signer does not exist.

- [ ] **Step 8: Implement the JWT signer with Node crypto only**

Create `app-store-connect-auth.ts` with these exports and exact claims:

```ts
import { createPrivateKey, sign } from "node:crypto";

export type AppStoreConnectCredentials = {
  issuerId: string;
  keyId: string;
  privateKey: string;
};

export function createAppStoreConnectToken(credentials: AppStoreConnectCredentials, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "ES256", kid: credentials.keyId, typ: "JWT" });
  const payload = encode({ iss: credentials.issuerId, iat, exp: iat + 600, aud: "appstoreconnect-v1" });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(credentials.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}
```

- [ ] **Step 9: Verify signer and full config tests**

Run:

```powershell
npx vitest run --project unit src/server/sources/app-store-connect-auth.test.ts src/server/config.test.ts src/app/api/config/route.test.ts
```

Expected: all tests pass, with no private-key text printed.

- [ ] **Step 10: Commit checkpoint if authorized**

```powershell
git add src/server/sources/app-store-connect-auth.ts src/server/sources/app-store-connect-auth.test.ts src/server/config.ts src/server/config.test.ts src/app/api/config/route.ts src/app/api/config/route.test.ts .env.example
git commit -m "feat: add App Store Connect server credentials"
```

---

### Task 3: Implement the authenticated US customer-review collector

**Files:**
- Create: `src/server/sources/app-store-connect-client.ts`
- Create: `src/server/sources/app-store-connect-client.test.ts`
- Modify: `src/domain/contracts/review.ts:3-5`
- Modify: `src/domain/contracts/review.test.ts`
- Create: `tests/fixtures/app-store-connect/reviews-page-01.json`
- Create: `tests/fixtures/app-store-connect/reviews-page-02.json`

**Interfaces:**
- Consumes: `AppStoreConnectCredentials`, `createAppStoreConnectToken`, `RawReview`, and injected `fetchFn/sleep/now`.
- Produces: `collectAppStoreConnectReviews(deps): Promise<AppStoreConnectResult>`.

- [ ] **Step 1: Extend the review source schema with a failing test**

Add a schema case asserting this literal object parses:

```ts
expect(
  RawReviewSchema.parse({
    sourceReviewId: "00000028-b08c-0014-729e-fbd500000000",
    source: "app-store-connect",
    title: "Useful",
    body: "The timer is much easier to use now.",
    rating: 5,
    version: null,
    updatedAt: "2026-08-12T08:10:34.000Z",
  }),
).toMatchObject({ source: "app-store-connect", rating: 5 });
```

Run the review-contract test and expect rejection because the enum currently excludes `app-store-connect`. Then add it to `ReviewSourceSchema` and rerun GREEN.

- [ ] **Step 2: Create literal two-page fixtures**

`reviews-page-01.json` contains two valid USA reviews, `meta.paging.total: 3`, and:

```json
{
  "links": {
    "self": "https://api.appstoreconnect.apple.com/v1/apps/839285684/customerReviews?limit=2",
    "next": "https://api.appstoreconnect.apple.com/v1/apps/839285684/customerReviews?cursor=cursor-2&limit=2"
  }
}
```

`reviews-page-02.json` contains one valid USA review, the same total, and no `links.next`. Each item includes `type`, UUID `id`, and complete `attributes.rating/title/body/createdDate/territory`.

- [ ] **Step 3: Define the collector contract**

Create these public types in `app-store-connect-client.ts`:

```ts
export type AppStoreConnectRequestEvidence = {
  request: number;
  url: string;
  startedAt: string;
  finishedAt: string;
  httpStatus: number;
  reviewCount: number;
  byteLength: number;
  sha256: string;
};

export type AppStoreConnectResult = {
  status: "complete" | "partial" | "failed";
  reviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  requests: AppStoreConnectRequestEvidence[];
  totalAvailable: number | null;
};

export type AppStoreConnectDeps = {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  credentials: AppStoreConnectCredentials;
  appId: string;
  maxReviews: number;
  timeoutMs: number;
  baseUrl: string;
  retryDelaysMs?: number[];
  signal?: AbortSignal;
};
```

Use the existing `Limitation` structural type; do not move or rename unrelated RSS code in this task.

- [ ] **Step 4: Add the failing happy-path pagination test**

Add these concrete fixture/dependency helpers. The fake returns page 1 for the initial literal URL and page 2 for the literal `links.next`; the generated private key keeps the real JWT signer in the test path:

```ts
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "app-store-connect", name), "utf8");
}

function depsForTwoPages(): AppStoreConnectDeps {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("cursor=cursor-2")
      ? fixture("reviews-page-02.json")
      : fixture("reviews-page-01.json");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => "2026-08-13T00:00:00.000Z",
    credentials: {
      issuerId: "69a6de95-1111-2222-3333-47e3bb22d52f",
      keyId: "ABC123DEFG",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
    appId: "839285684",
    maxReviews: 500,
    timeoutMs: 10_000,
    baseUrl: "https://api.appstoreconnect.apple.com",
    retryDelaysMs: [1, 1],
  };
}
```

Assert observable results, not the fake itself:

```ts
it("follows trusted next links and returns newest USA reviews", async () => {
  const result = await collectAppStoreConnectReviews(depsForTwoPages());

  expect(result.status).toBe("complete");
  expect(result.reviews.map((review) => review.sourceReviewId)).toEqual([
    "00000028-b08c-0014-729e-fbd500000001",
    "00000028-b08c-0014-729e-fbd500000002",
    "00000028-b08c-0014-729e-fbd500000003",
  ]);
  expect(result.reviews.every((review) => review.source === "app-store-connect")).toBe(true);
  expect(result.rawRefs).toEqual([
    "app-store-connect:request-01#00000028-b08c-0014-729e-fbd500000001",
    "app-store-connect:request-01#00000028-b08c-0014-729e-fbd500000002",
    "app-store-connect:request-02#00000028-b08c-0014-729e-fbd500000003",
  ]);
  expect(result.totalAvailable).toBe(3);
  expect(result.requests).toHaveLength(2);
});
```

- [ ] **Step 5: Run the pagination test and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/sources/app-store-connect-client.test.ts -t "trusted next links"
```

Expected: import failure because the collector is absent.

- [ ] **Step 6: Implement initial request, strict parsing, and trusted pagination**

Build the initial URL with `URLSearchParams`:

```ts
const initial = new URL(`/v1/apps/${encodeURIComponent(deps.appId)}/customerReviews`, deps.baseUrl);
initial.searchParams.set("limit", String(Math.min(200, deps.maxReviews)));
initial.searchParams.set("sort", "-createdDate");
initial.searchParams.set("filter[territory]", "USA");
initial.searchParams.set("fields[customerReviews]", "rating,title,body,createdDate,territory");
```

For each response, validate with a Zod schema requiring `data[].type === "customerReviews"`, a non-empty `id`, integer rating 1–5, non-empty body, ISO `createdDate`, and `territory === "USA"`. Map `version` to `null`. Deduplicate by Connect review UUID, stop at `deps.maxReviews`, stop when `links.next` is absent, and reject a next URL unless its origin exactly equals `new URL(deps.baseUrl).origin` and its pathname is the same app’s `/customerReviews` endpoint.

- [ ] **Step 7: Verify pagination GREEN**

Run the targeted test again. Expected: three ordered reviews, two request evidence entries, and total `3`.

- [ ] **Step 8: Add failure-policy tests before implementing retries**

Add separate tests for these exact outcomes:

- `401` before data → `failed` + `ASC_UNAUTHORIZED`.
- `403` before data → `failed` + `ASC_FORBIDDEN`.
- `404` before data → `failed` + `ASC_APP_NOT_FOUND`.
- `429`, then success → two fetches and `complete`.
- `500`, `500`, success with retry delays `[1, 1]` → three fetches and `complete`.
- invalid JSON before data → `failed` + `ASC_INVALID_RESPONSE`.
- foreign-host `links.next` → `partial` + `ASC_INVALID_NEXT_LINK`, with first-page reviews preserved.
- page-two network failure after page-one success → `partial` + `ASC_PARTIAL`, with page-one reviews preserved.
- 600 unique fixture items across pages with `maxReviews: 500` → exactly 500 reviews and no request after the cap.
- a repeated `links.next` URL → `partial` + `ASC_REPEATED_CURSOR` and bounded request count.
- [ ] **Step 9: Run all new failure tests and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/sources/app-store-connect-client.test.ts
```

Expected: happy path remains green; retry and failure-policy cases fail until their branches exist.

- [ ] **Step 10: Implement bounded retries and failure mapping**

Use default retry delays `[1_000, 2_000]` only for network errors, 429, and 5xx. Generate one ten-minute JWT per collection, set headers exactly as follows, and never record them in evidence:

```ts
headers: {
  accept: "application/json",
  authorization: `Bearer ${token}`,
}
```

For `429`, use a valid numeric `Retry-After` seconds value when present, capped at 30 seconds; otherwise use the configured delay. Do not retry 400, 401, 403, 404, invalid JSON, schema errors, invalid next links, or caller aborts. Record response body SHA-256 and safe numeric/string metadata only.

- [ ] **Step 11: Verify the complete Connect collector suite**

Run:

```powershell
npx vitest run --project unit src/server/sources/app-store-connect-client.test.ts src/domain/contracts/review.test.ts
```

Expected: every happy, cap, retry, partial, security, and schema case passes with no real network.

- [ ] **Step 12: Commit checkpoint if authorized**

```powershell
git add src/server/sources/app-store-connect-client.ts src/server/sources/app-store-connect-client.test.ts src/domain/contracts/review.ts src/domain/contracts/review.test.ts tests/fixtures/app-store-connect
git commit -m "feat: collect authorized App Store reviews"
```

---

### Task 4: Make source previews dispatch between public, Connect, and explicit fallback

**Files:**
- Modify: `src/server/sources/source-preview.ts:8-160`
- Modify: `src/server/sources/source-preview.test.ts:1-149`
- Modify: `src/app/api/source-previews/route.ts:10-108`
- Modify: `src/app/api/source-previews/route.test.ts:1-115`

**Interfaces:**
- Consumes: public `CollectorDeps`, optional configured `AppStoreConnectDeps`, and the two collector result types.
- Produces: persisted `SourcePreview` with `access`, nullable public/Connect samples, and one of `live | stable | connect` as the recommended selection.

- [ ] **Step 1: Define the preview union-compatible fields**

Refactor `SourcePreview` without changing its TTL/base identity fields:

```ts
export type ReviewAccessMode = "public" | "connect";
export type ReviewSelection = "live" | "stable" | "connect";

export type SourcePreview = {
  protocolVersion: "1";
  previewId: string;
  appId: string;
  canonicalUrl: string;
  createdAt: string;
  expiresAt: string;
  access: {
    requested: ReviewAccessMode;
    effective: ReviewAccessMode;
    fallbackCode: string | null;
  };
  live: PublicLiveSample | null;
  stable: PublicStableSample | null;
  connect: AppStoreConnectSample | null;
  recommendedSelection: ReviewSelection | null;
};
```

`PublicLiveSample` keeps the current fields. `PublicStableSample` keeps the current fields plus Task 1 composition counts. `AppStoreConnectSample` contains:

```ts
{
  configured: boolean;
  status: "complete" | "partial" | "failed";
  reviewCount: number;
  requestCount: number;
  totalAvailable: number | null;
  dateRange: { earliest: string | null; latest: string | null };
  limitations: Limitation[];
  reviews: RawReview[];
  rawRefs: string[];
}
```

- [ ] **Step 2: Add failing preview-dispatch tests**

Mock both collectors at their external boundary. Extend the existing test helpers with these exact shapes:

```ts
vi.mock("./app-store-connect-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app-store-connect-client")>();
  return { ...actual, collectAppStoreConnectReviews: vi.fn() };
});

const mockedConnect = vi.mocked(collectAppStoreConnectReviews);

function connectRaw(id: string): RawReview {
  return {
    sourceReviewId: id,
    source: "app-store-connect",
    title: `title ${id}`,
    body: `body ${id}`,
    rating: 5,
    version: null,
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function connectResult(overrides: Partial<AppStoreConnectResult> = {}): AppStoreConnectResult {
  const reviews = overrides.reviews ?? [];
  return {
    status: overrides.status ?? "complete",
    reviews,
    rawRefs: overrides.rawRefs ?? reviews.map((review) => `app-store-connect:request-01#${review.sourceReviewId}`),
    limitations: overrides.limitations ?? [],
    requests: overrides.requests ?? [],
    totalAvailable: overrides.totalAvailable ?? reviews.length,
  };
}

function makeInput(options: { accessMode?: ReviewAccessMode; connectConfigured?: boolean } = {}): PreviewInput {
  const configured = options.connectConfigured ?? false;
  return {
    previewId: "preview-1",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/x/id839285684",
    now: "2026-08-12T00:00:00.000Z",
    accessMode: options.accessMode ?? "public",
    collector: {} as CollectorDeps,
    appStoreConnect: configured
      ? { status: "configured", issuerId: "issuer", keyId: "key", privateKey: "test-key" }
      : { status: "not-configured" },
    connectCollector: configured ? ({} as AppStoreConnectDeps) : null,
    previewsDir,
    cacheDir,
    historyRoots: [],
    runsDir,
  };
}
```

Add these cases:

```ts
it("uses only Connect data when authorized collection succeeds", async () => {
  mockedConnect.mockResolvedValue(connectResult({ reviews: [connectRaw("c1")], totalAvailable: 4326 }));
  const preview = await runPreviewImpl(makeInput({ accessMode: "connect", connectConfigured: true }));
  expect(preview.access).toEqual({ requested: "connect", effective: "connect", fallbackCode: null });
  expect(preview.connect?.reviewCount).toBe(1);
  expect(preview.connect?.totalAvailable).toBe(4326);
  expect(preview.live).toBeNull();
  expect(preview.stable).toBeNull();
  expect(preview.recommendedSelection).toBe("connect");
});

it("falls back explicitly to public when Connect is not configured", async () => {
  mockedCollect.mockResolvedValue(liveResult({ reviews: [raw("r1", "2026-08-01T00:00:00Z")] }));
  const preview = await runPreviewImpl(makeInput({ accessMode: "connect", connectConfigured: false }));
  expect(preview.access).toEqual({ requested: "connect", effective: "public", fallbackCode: "ASC_NOT_CONFIGURED" });
  expect(preview.live?.reviewCount).toBe(1);
  expect(preview.connect?.configured).toBe(false);
});
```

Add literal cases for incomplete config, 403/404/429 exhausted fallback, partial Connect with reviews staying Connect, and successful empty Connect staying Connect with no recommendation.

- [ ] **Step 3: Run preview dispatch tests and verify RED**

Run:

```powershell
npx vitest run --project unit src/server/sources/source-preview.test.ts
```

Expected: type and assertion failures because preview access dispatch does not exist.

- [ ] **Step 4: Implement isolated public and Connect builders**

Extend `PreviewInput` with `accessMode`, `appStoreConnect`, and nullable `connectCollector`. Extract current RSS/cache logic behind these exact private interfaces:

```ts
async function buildPublicSnapshot(
  input: PreviewInput,
  access: SourcePreview["access"],
  connectAttempt: AppStoreConnectSample | null,
): Promise<SourcePreview>;

function buildConnectSnapshot(input: PreviewInput, result: AppStoreConnectResult): SourcePreview;

function buildConnectSample(result: AppStoreConnectResult, configured: boolean): AppStoreConnectSample;
```

Implement the bodies from the existing public sample construction, Task 1 composition counts, and the Connect result mapping. Dispatch with:

```ts
if (input.accessMode === "public") {
  return buildPublicSnapshot(
    input,
    { requested: "public", effective: "public", fallbackCode: null },
    null,
  );
}
if (input.appStoreConnect.status !== "configured") {
  const fallbackCode = input.appStoreConnect.status === "incomplete" ? "ASC_CONFIG_INCOMPLETE" : "ASC_NOT_CONFIGURED";
  return buildPublicSnapshot(
    input,
    { requested: "connect", effective: "public", fallbackCode },
    {
      configured: false,
      status: "failed",
      reviewCount: 0,
      requestCount: 0,
      totalAvailable: null,
      dateRange: { earliest: null, latest: null },
      limitations: [{ code: fallbackCode, message: "App Store Connect is unavailable", stage: "source" }],
      reviews: [],
      rawRefs: [],
    },
  );
}
const result = await collectAppStoreConnectReviews(input.connectCollector!);
if (result.reviews.length > 0 || result.status === "complete") return buildConnectSnapshot(input, result);
const fallbackCode = result.limitations[0]?.code ?? "ASC_FAILED";
return buildPublicSnapshot(
  input,
  { requested: "connect", effective: "public", fallbackCode },
  buildConnectSample(result, true),
);
```

The actual implementation must call each required helper once, persist one final snapshot atomically, and leave previews containing credentials impossible by type.

- [ ] **Step 5: Verify preview dispatch GREEN**

Run the complete `source-preview.test.ts`. Expected: public recommendation, hybrid counts, Connect success, trusted empty, partial preservation, explicit fallback, persistence, expiry, and pruning all pass.

- [ ] **Step 6: Add the request schema and public-response tests**

Extend `SourcePreviewRequestSchema`:

```ts
accessMode: z.enum(["public", "connect"]).default("public"),
```

Add route tests proving:

- omitted `accessMode` uses public for backward compatibility;
- `connect` passes configured credentials only to the server collector;
- incomplete config returns HTTP 200 with `requested: connect`, `effective: public`, and `ASC_CONFIG_INCOMPLETE`;
- the response contains counts/limitations but no `reviews`, `rawRefs`, private key, bearer token, Key ID, or Issuer ID.

- [ ] **Step 7: Run route tests and verify RED**

Run:

```powershell
npx vitest run --project unit src/app/api/source-previews/route.test.ts
```

Expected: access-mode and Connect summary assertions fail.

- [ ] **Step 8: Wire route configuration and strip all full datasets**

Build `connectCollector` only when `cfg.appStoreConnect.status === "configured"`, using `cfg.appStoreConnectBaseUrl`, max reviews, timeout, real `fetch`, and real sleep. `toPublicPreview` must map nullable samples and expose only:

```ts
access,
live: live && { status, reviewCount, pageCount, requestCount, dateRange, limitations },
stable: stable && { available, reviewCount, freshReviewCount, cachedOnlyReviewCount, cacheUpdatedAt, dateRange, bootstrapRunId },
connect: connect && { configured, status, reviewCount, requestCount, totalAvailable, dateRange, limitations },
recommendedSelection,
```

- [ ] **Step 9: Verify source-preview route GREEN**

Run:

```powershell
npx vitest run --project unit src/app/api/source-previews/route.test.ts src/server/sources/source-preview.test.ts
```

Expected: all dispatch, fallback, stripping, cache, and TTL cases pass.

- [ ] **Step 10: Commit checkpoint if authorized**

```powershell
git add src/server/sources/source-preview.ts src/server/sources/source-preview.test.ts src/app/api/source-previews/route.ts src/app/api/source-previews/route.test.ts
git commit -m "feat: preview public and authorized review sources"
```

---

### Task 5: Carry selected provider and provenance into immutable runs

**Files:**
- Modify: `src/domain/contracts/run.ts:7-25`
- Modify: `src/domain/contracts/run.test.ts`
- Modify: `src/app/api/runs/route.ts:185-291`
- Modify: `src/app/api/runs/route.test.ts:1-160`
- Modify: `src/server/pipeline/orchestrator.ts:29-116`
- Modify: `tests/integration/pipeline-live.test.ts:321-435`

**Interfaces:**
- Consumes: persisted `SourcePreview`, `ReviewSelection`, and selected full dataset.
- Produces: preview-backed run input and `source-evidence` discriminated by `kind: "apple-rss" | "app-store-connect"`.

- [ ] **Step 1: Extend the request selection contract test-first**

Add a run-schema test that parses:

```ts
{
  protocolVersion: "1",
  mode: "analyze",
  uiLocale: "en",
  outputLocale: "en",
  goal: "Understand current customer feedback",
  source: {
    kind: "live",
    appStoreUrl: "https://apps.apple.com/us/app/x/id839285684",
    previewId: "preview-connect",
    reviewSelection: "connect",
  },
}
```

Run the contract test, observe enum rejection, then extend `reviewSelection` to `z.enum(["live", "stable", "connect"])`.

- [ ] **Step 2: Add failing route tests for selection/provider matching**

Create public and Connect snapshot helpers and assert:

- `connect` is accepted only when `preview.access.effective === "connect"` and `connect.reviewCount > 0`.
- `live`/`stable` are rejected for a Connect snapshot.
- `connect` is rejected for a public or fallback snapshot.
- Connect selection returns NDJSON and later persists raw reviews whose `source` is `app-store-connect`.
- public stable selection adds `RSS_CACHE_AUGMENTED` and records literal fresh/cached-only counts.
- app ID mismatch and expiry checks remain provider-independent.

- [ ] **Step 3: Run route tests and verify RED**

Run:

```powershell
npx vitest run --project unit src/domain/contracts/run.test.ts src/app/api/runs/route.test.ts
```

Expected: Connect selection fails validation/availability.

- [ ] **Step 4: Implement provider-aware preview validation**

Change `loadValidPreview` to accept `ReviewSelection` and enforce this exact matrix:

```ts
const available =
  selection === "connect"
    ? preview.access.effective === "connect" && (preview.connect?.reviewCount ?? 0) > 0
    : preview.access.effective === "public" &&
      (selection === "live"
        ? (preview.live?.reviewCount ?? 0) > 0
        : Boolean(preview.stable?.available && preview.stable.reviewCount > 0));
```

Select reviews/raw refs/limitations from exactly one sample. Never re-collect in `/api/runs`.

- [ ] **Step 5: Define exact source evidence unions**

Widen `PreviewSourceShape.sourceSummary` to:

```ts
type PreviewSourceSummary =
  | {
      kind: "apple-rss";
      appId: string;
      status: "complete" | "suspect-empty" | "partial" | "failed";
      selection: "live" | "stable";
      requestedAccessMode: "public" | "connect";
      effectiveAccessMode: "public";
      fallbackCode: string | null;
      liveCount: number;
      freshReviewCount: number;
      cachedOnlyReviewCount: number;
      stableCount: number;
      pages: number;
      requestCount: number;
      reviewCount: number;
    }
  | {
      kind: "app-store-connect";
      appId: string;
      status: "complete" | "partial";
      selection: "connect";
      requestedAccessMode: "connect";
      effectiveAccessMode: "connect";
      territory: "USA";
      requestCount: number;
      reviewCount: number;
      totalAvailable: number | null;
    };
```

For fallback runs, preserve the `ASC_*` limitation alongside RSS limitations so the reason is auditable.

- [ ] **Step 6: Verify route GREEN**

Run the route and run-contract tests again. Expected: exact selection matrix and source evidence pass; legacy public preview calls remain valid where the route test helper sets public access fields.

- [ ] **Step 7: Add and run pipeline integration tests**

Add a Connect preview `ExecuteDeps` integration case with two `app-store-connect` raw reviews. Assert:

```ts
expect(sourceEvidence.kind).toBe("app-store-connect");
expect(sourceEvidence.territory).toBe("USA");
expect(sourceEvidence.reviewCount).toBe(2);
expect(rawReviews.reviews.every((review: RawReview) => review.source === "app-store-connect")).toBe(true);
```

Add a public fallback case asserting both `ASC_FORBIDDEN` and `RSS_CACHE_AUGMENTED` survive in limitations and `kind` remains `apple-rss`.

Run:

```powershell
npx vitest run --project integration tests/integration/pipeline-live.test.ts
```

Expected: Connect and fallback evidence cases pass without model-grounding regressions.

- [ ] **Step 8: Commit checkpoint if authorized**

```powershell
git add src/domain/contracts/run.ts src/domain/contracts/run.test.ts src/app/api/runs/route.ts src/app/api/runs/route.test.ts src/server/pipeline/orchestrator.ts tests/integration/pipeline-live.test.ts
git commit -m "feat: preserve review provider provenance"
```

---

### Task 6: Add explicit public/owned-App controls and honest sample cards

**Files:**
- Modify: `src/components/workbench/run-form.tsx:1-260`
- Modify: `src/components/workbench/run-form.test.tsx:1-150`
- Modify: `src/components/workbench/workbench.tsx:93-110`
- Modify: `src/components/workbench/workbench.test.tsx`
- Modify: `src/i18n/index.ts:1-390`
- Modify: `src/i18n/index.test.ts:1-30`

**Interfaces:**
- Consumes: public `SourcePreviewSummary` containing access state and nullable sample summaries.
- Produces: preview requests with `accessMode`, analysis requests with matching `reviewSelection`, source badges and bilingual limitation copy.

- [ ] **Step 1: Add failing RunForm interaction tests**

Extend the existing `previewSummary` helper so public summaries include `access`, composition counts, and `connect: null`. Add this complete Connect helper:

```ts
function connectPreviewSummary(input: { reviewCount: number; totalAvailable: number }) {
  return {
    protocolVersion: "1" as const,
    previewId: "preview-connect",
    appId: "839285684",
    canonicalUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
    createdAt: "2026-08-12T00:00:00.000Z",
    expiresAt: "2026-08-12T00:30:00.000Z",
    access: { requested: "connect" as const, effective: "connect" as const, fallbackCode: null },
    live: null,
    stable: null,
    connect: {
      configured: true,
      status: "complete" as const,
      reviewCount: input.reviewCount,
      requestCount: 3,
      totalAvailable: input.totalAvailable,
      dateRange: { earliest: "2026-07-01T00:00:00.000Z", latest: "2026-08-12T00:00:00.000Z" },
      limitations: [],
    },
    recommendedSelection: "connect" as const,
  };
}
```

Add the interaction test using the existing `stubFetch` helper:

```ts
it("requests Connect mode and starts the authorized sample", async () => {
  const fetchMock = stubFetch(connectPreviewSummary({ reviewCount: 500, totalAvailable: 4326 }));
  const user = userEvent.setup();
  const onStart = vi.fn();
  render(<RunForm t={t} onStart={onStart} />);
  await user.click(screen.getByRole("button", { name: "My App (App Store Connect)" }));
  await user.type(screen.getByLabelText("Analysis goal"), "Understand current customer feedback");
  await user.click(screen.getByRole("button", { name: "Check review sample" }));
  const previewCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/source-previews"));
  const requestInit = previewCall?.[1] as RequestInit;
  expect(JSON.parse(String(requestInit.body))).toMatchObject({ accessMode: "connect" });
  expect(await screen.findByText("500 collected / 4,326 available in USA")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Analyze App Store Connect sample" }));
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
    source: expect.objectContaining({ reviewSelection: "connect" }),
  }));
});
```

Add public composition coverage for `50 fresh + 450 history = 500 total`, and Connect fallback coverage that renders `App Store Connect unavailable (ASC_FORBIDDEN); using Public + History` before showing public cards.

- [ ] **Step 2: Run RunForm tests and verify RED**

Run:

```powershell
npx vitest run --project unit:dom src/components/workbench/run-form.test.tsx
```

Expected: source-mode controls and new sample text are absent.

- [ ] **Step 3: Implement access-mode controls and reset semantics**

Add state:

```ts
const [accessMode, setAccessMode] = useState<"public" | "connect">("public");
```

Changing access mode or URL clears preview/error. Send `accessMode` to `/api/source-previews`. Render two controls above the URL:

- English: `Public App` and `My App (App Store Connect)`.
- Chinese: `任意公开 App` and `自家 App（App Store Connect）`.

Do not render or accept credential values in the component.

- [ ] **Step 4: Render provider-specific cards**

For effective public access, render:

- Latest public: `live.reviewCount`, page/request status, analyze `live`.
- Public + history: `${freshReviewCount} fresh + ${cachedOnlyReviewCount} history = ${reviewCount} total`, cache timestamp, analyze `stable`.

For effective Connect access, render one card:

- `${reviewCount} collected / ${totalAvailable ?? "unknown"} available in USA`.
- request count and `complete|partial`.
- analyze `connect`.

When requested Connect falls back, render `fallbackCode` before public cards. When Connect is complete with zero reviews, disable analysis and offer switching to Public App or Import.

- [ ] **Step 5: Verify RunForm GREEN**

Run:

```powershell
npx vitest run --project unit:dom src/components/workbench/run-form.test.tsx
```

Expected: public, Connect, fallback, URL reset, goal validation, import, and replay tests pass.

- [ ] **Step 6: Add source-badge tests**

Add cases asserting source evidence with `"kind":"app-store-connect"` renders `App Store Connect` / `App Store Connect 官方数据`, and fallback evidence with `ASC_*` plus `RSS_CACHE_AUGMENTED` renders `Public + History` / `公开数据 + 历史缓存` rather than `Live`.

- [ ] **Step 7: Implement badge precedence and bilingual strings**

In `workbench.tsx`, check structured source evidence before generic limitations:

```ts
if (texts.some((value) => value.includes('"kind":"app-store-connect"'))) {
  return { kind: "source" as const, label: t.sourceAppStoreConnect };
}
if (texts.some((value) => value.includes("RSS_CACHE_AUGMENTED"))) {
  return { kind: "source" as const, label: t.sourcePublicHistory };
}
```

Add every new dictionary key to the type and both locale objects, including controls, counts, fallback, no-credentials guidance, Connect status, and source badges. Extend `index.test.ts` required keys so an untranslated key fails.

- [ ] **Step 8: Verify all UI and i18n tests**

Run:

```powershell
npx vitest run --project unit:dom src/components/workbench/run-form.test.tsx src/components/workbench/workbench.test.tsx
npx vitest run --project unit src/i18n/index.test.ts
```

Expected: all provider controls, cards, fallbacks, badges, and bilingual keys pass.

- [ ] **Step 9: Commit checkpoint if authorized**

```powershell
git add src/components/workbench/run-form.tsx src/components/workbench/run-form.test.tsx src/components/workbench/workbench.tsx src/components/workbench/workbench.test.tsx src/i18n/index.ts src/i18n/index.test.ts
git commit -m "feat: expose public and owned App review modes"
```

---

### Task 7: Document, exercise, review, and verify both acquisition modes

**Files:**
- Modify: `README.md:62-95`
- Modify: `docs/superpowers/specs/2026-08-12-app-review-analysis-design.md:52-65`
- Create: `docs/app-store-connect.md`
- Modify: `scripts/check-docs.mjs:25-65`
- Modify: `playwright.config.ts:1-36`
- Modify: `tests/e2e/upstream-server.ts:1-100`
- Modify: `tests/e2e/cached-replay-i18n.spec.ts:1-35`
- Modify: `tests/e2e/stable-sample.spec.ts:1-35`
- Create: `tests/e2e/app-store-connect.spec.ts`

**Interfaces:**
- Consumes: completed dual-source implementation and its public API.
- Produces: operator documentation, secret scanning, deterministic browser coverage, review report, QA evidence, and final verification output.

- [ ] **Step 1: Update the source contract documentation**

Document these exact facts in README and the design spec:

- Public RSS first entry is `/us/rss/customerreviews/id={id}/sortBy=mostRecent/json`; Apple may expose only the newest 50 even when pagination links claim more pages.
- Public + History is per-App, US-only, ID-deduped, newest-first, capped at 500, and may contain fewer than 500 until history accumulates.
- App Store Connect is for apps accessible to the configured account, filters `USA`, requests 200 per page, follows cursor links, and caps the preview at 500.
- Configure three server-only variables; use a multiline `.p8` value or escaped newlines; restart after changing `.env.local`.
- Required key permissions, expected 401/403/404 behavior, explicit public fallback, and private-key handling.
- No public claim that App Store Connect can retrieve arbitrary competitors’ full history.

`docs/app-store-connect.md` must include a concrete `.env.local` example with non-secret markers:

```dotenv
APP_STORE_CONNECT_ISSUER_ID=00000000-0000-0000-0000-000000000000
APP_STORE_CONNECT_KEY_ID=ABC123DEFG
APP_STORE_CONNECT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nEXAMPLE_ONLY_NOT_A_VALID_P8_KEY\n-----END PRIVATE KEY-----"
APP_STORE_CONNECT_MAX_REVIEWS=500
APP_STORE_CONNECT_TIMEOUT_MS=10000
```

State that marker values cannot authenticate and must not be committed.

- [ ] **Step 2: Extend docs and secret drift checks**

Add `App Store Connect`, `Public + History`, and `APP_STORE_CONNECT_PRIVATE_KEY` to required documentation checks. Extend the tracked-file secret scan to inspect both `MODEL_API_KEY` and a configured App Store Connect private key, while excluding the exact non-secret marker string used in documentation.

Run:

```powershell
npm run check:docs
```

Expected: docs check passes and no real credential appears in tracked files.

- [ ] **Step 3: Extend the isolated E2E upstream**

Add `connectRequests` to `UpstreamState`. Serve `/v1/apps/839285684/customerReviews` only when the authorization header matches `/^Bearer [^.]+\.[^.]+\.[^.]+$/`; return a deterministic three-review USA payload with no next link. Keep RSS and model handlers unchanged.

In `playwright.config.ts`, generate a temporary P-256 private key at config evaluation and pass its PKCS8 PEM through `webServer.env`. Set:

```ts
APP_STORE_CONNECT_ISSUER_ID: "69a6de95-1111-2222-3333-47e3bb22d52f",
APP_STORE_CONNECT_KEY_ID: "E2ETESTKEY",
APP_STORE_CONNECT_PRIVATE_KEY: testPrivateKeyPem,
APP_STORE_CONNECT_BASE_URL: "http://127.0.0.1:39876",
APP_STORE_CONNECT_MAX_REVIEWS: "3",
```

The generated private key exists only in the Playwright process environment and must never be written to disk.

- [ ] **Step 4: Add the failing Connect browser journey**

Create `app-store-connect.spec.ts`:

```ts
test("authorized owned-App mode analyzes the frozen Connect preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "My App (App Store Connect)" }).click();
  await page.getByLabel("Analysis goal").fill("Understand current customer feedback");
  await page.getByRole("button", { name: "Check review sample" }).click();
  await expect(page.getByText("3 collected / 3 available in USA")).toBeVisible();
  await page.getByRole("button", { name: "Analyze App Store Connect sample" }).click();
  await expect(page.getByText("App Store Connect", { exact: true })).toBeVisible();
  await expect(page.getByText(/Completed/)).toBeVisible({ timeout: 30_000 });
});
```

Run only this spec and verify it fails before upstream/config/UI wiring is complete.

- [ ] **Step 5: Update public and replay E2E assertions**

In `stable-sample.spec.ts`, assert the public card shows the literal composition from the isolated cache. In cached replay, assert `connectRequests` is unchanged in addition to RSS/model counts, proving replay never contacts either Apple source.

- [ ] **Step 6: Run the complete browser matrix**

Run:

```powershell
npm run test:e2e
```

Expected minimum matrix:

1. public latest analysis;
2. public + history analysis;
3. App Store Connect analysis;
4. import conflict handling;
5. cached replay with zero RSS/Connect/model calls;
6. China storefront URL normalized to US.

- [ ] **Step 7: Run the full automated verification gate**

Run in this order and stop on the first failure:

```powershell
npm run lint
npm run typecheck
npm run check:docs
npm run test:coverage
npm run test:integration
npm run build
npm run test:e2e
npm run verify
git diff --check
git diff --name-only --diff-filter=U
```

Expected: every command exits 0, no unresolved paths are printed, and `docs/goal.md` remains untracked and unchanged.

- [ ] **Step 8: Run pre-landing review**

Use the `review` skill against the complete diff. Resolve all P0/P1 findings. Pay special attention to:

- credential exposure through public config, snapshots, artifacts, events, errors, and test output;
- authorization header forwarding to an untrusted `links.next` origin;
- silent provider mixing or incorrect source badges;
- unbounded cursor loops, retries, timeout, or result count;
- public 50-review samples being labeled as complete history.

Rerun the smallest affected test after each review fix, then rerun `npm run verify`.

- [ ] **Step 9: Run Standard UI QA**

Use the `qa` skill in Standard mode. Exercise public, public-history, Connect, Connect fallback, import, and cached replay in English and Chinese. Capture any user-visible source-label, disabled-button, overflow, responsive-layout, or stale-preview defect; fix each with a failing automated test and rerun its suite.

- [ ] **Step 10: Inspect final scope and secrets**

Run:

```powershell
git status --short
git diff --stat
git diff -- README.md docs/app-store-connect.md docs/superpowers/specs/2026-08-12-app-review-analysis-design.md src tests scripts .env.example playwright.config.ts
git grep -n "BEGIN PRIVATE KEY" -- ':!docs/app-store-connect.md'
```

Expected: only intended dual-source files plus the prior RSS fix are modified; the final grep prints no tracked private key; `docs/goal.md` is not staged.

- [ ] **Step 11: Commit documentation checkpoint if authorized**

```powershell
git add README.md docs/app-store-connect.md docs/superpowers/specs/2026-08-12-app-review-analysis-design.md scripts/check-docs.mjs playwright.config.ts tests/e2e
git commit -m "docs: document dual App Store review sources"
```

## Execution Notes

- Execute Tasks 1–3 first and checkpoint review the server-only contracts before changing preview/UI types.
- Execute Tasks 4–5 together as the preview-to-run protocol batch; do not leave the worktree with a preview selection the run route cannot consume.
- Execute Tasks 6–7 as the user-visible batch, followed by review, Standard QA, and the full gate.
- A real App Store Connect smoke cannot run until the operator supplies credentials in `.env.local`; automated tests use generated P-256 keys and an isolated local upstream. Final delivery must report real Connect smoke as “not run—credentials not provided” unless the environment is configured.
