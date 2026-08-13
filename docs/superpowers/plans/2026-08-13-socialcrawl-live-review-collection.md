# SocialCrawl Live App Review Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动已完成 P0/P1 分析链路的前提下，让用户可在页面设置中安全配置 SocialCrawl API Key，并将任意公开 App 的美国区最新评论主采集源切换为 SocialCrawl，一次强制刷新最多取得 500 条，同时保留 Apple RSS 与本地历史缓存作为明确标注的降级能力。

**Architecture:** 复用现有设置面板和 `/api/config`：用户在密码输入框提交 SocialCrawl Key，服务端立即写入独立运行时覆盖并持久化到 git-ignored `.env.local`，GET/POST 响应只返回 `socialCrawlApiKeyConfigured`，从不回显 Key。`/api/source-previews` 使用当前服务端 Key 调用 `GET /v1/app_store/app-reviews`，固定 `country=US`、`language=en`、`depth=500`、`sort_by=most_recent`，并通过 `Cache-Control: no-cache` 请求新鲜上游数据；成功结果写入现有 30 分钟不可变预览并合入每 App 500 条本地缓存。SocialCrawl 未配置或确定失败时才调用现有 Apple RSS collector，且一次预览只采用一个实时 provider；分析运行继续只读取已冻结的预览，不再次采集。

**Tech Stack:** Next.js 16.3 Node runtime、TypeScript 6、Zod 4、Vitest、Playwright、现有文件缓存与 NDJSON 运行协议。

## Global Constraints

- P0、P1 已完成并作为回归基线；本计划不重做分析、证据、PRD、测试生成、回放或导入功能。
- SocialCrawl 仅从服务端调用；除用户在设置页输入时的内存状态和同源 `POST /api/config` 请求体外，API Key 不得进入客户端 bundle、浏览器存储、URL、HTTP 响应、日志、异常文本、事件、artifact、preview JSON、测试快照或 git 跟踪文件。
- git 跟踪文档只记录变量名 `SOCIALCRAWL_API_KEY` 和空值示例；真实值仅放在已被 `.gitignore` 排除的 `.env.local` 或进程环境中。
- 用户在对话中提供的旧 Key 不写入任何文件；实施前在 SocialCrawl 控制台轮换，新 Key 可由设置页保存到本地 `.env.local`，无需再手工编辑或发送给开发者。
- 设置页的 SocialCrawl 输入必须为 `type="password"`、`autoComplete="off"`，打开设置和保存成功后输入值均为空；页面只显示“已配置/未配置”，不提供 Key 查看、复制或掩码尾号。
- 页面保存 Key 后当前进程立即生效且无需重启；页面清除 Key 后当前进程立即禁用 SocialCrawl、删除 `.env.local` 中该项，并使下一次预览明确降级为 RSS。
- `GET /api/config` 和 `POST /api/config` 的响应只允许返回 `socialCrawlApiKeyConfigured: boolean`，不得返回 `socialCrawlApiKey`、Key 长度、前缀或后四位。
- 主采集请求固定为 `GET https://www.socialcrawl.dev/v1/app_store/app-reviews?app_id={numericId}&country=US&language=en&depth=500&sort_by=most_recent`。
- 每次用户点击“检查/重新检查”生成新的 `Idempotency-Key`，同一次请求的重试复用该值；同时发送 `Cache-Control: no-cache`，以绕过 SocialCrawl 共享缓存。
- 应用层上限固定 500 条，虽然 SocialCrawl `depth` 最大支持 600；不得因 provider 上限提高而扩大本项目分析样本。
- SocialCrawl 成功且至少有一条有效评论时，不再请求 RSS；只有未配置、认证/余额/参数错误、明确的空结果、网络失败或安全重试耗尽时，才以 RSS 作为同次预览的替代 provider。
- SocialCrawl 返回部分合法、部分非法条目时保留合法条目并标记 `partial`，不得再把 RSS 评论混入该实时样本。
- `429`、`500`、`502`、带 `Retry-After` 的 `503` 最多重试两次；`400`、`401`、`402`、`404` 以及不带 `Retry-After` 的 `503` 不重试。
- 美国区约束必须同时出现在请求参数、预览摘要、source evidence 和 README；输入 `/cn/` 链接仍只提取 App ID，采集参数仍为 `country=US`。
- “实时”在 UI 中表示本次请求要求 SocialCrawl 绕过其共享缓存；UI 仍显示 provider 的 `cached` 信号和采集时间，不承诺 Apple 写入评论后的零延迟可见性。
- 现有 `live` / `stable` 两张样本卡保留：`live` 是本次 SocialCrawl 或 RSS 结果，`stable` 是按 App ID 隔离、去重、最新优先、最多 500 条的本地历史样本。
- Preview TTL 继续为 30 分钟；分析请求必须消费 preview 中冻结的数据，不能在 `/api/runs` 内再次采集。
- 执行时保留当前工作树中的 `README.md`、设计文档、RSS collector 及测试差异；不得修改或暂存用户的 `docs/goal.md`。
- 修改 Next.js route 前，先阅读仓库实际安装版本对应的 `node_modules/next/dist/docs/` 相关 route handler 文档。

## Success Criteria

- 用户能在现有设置弹窗的“数据采集平台”区域输入、保存和清除 SocialCrawl API Key；保存/清除无需重启，刷新设置页后只显示配置状态且密码框保持空白。
- 配置接口将非空 Key 写入 git-ignored `.env.local` 的 `SOCIALCRAWL_API_KEY`，清除时删除该项并保留其他环境配置；GET/POST 响应、保存完成后的浏览器状态和错误消息均不回显 Key。
- 配置有效 Key 后，对任意合法 App Store URL 检查样本时，首个上游请求命中 SocialCrawl，包含正确 query、`x-api-key`、`Cache-Control: no-cache` 与 `Idempotency-Key`。
- SocialCrawl 返回 500 条有效评论时，预览 `live.reviewCount === 500`，本地 stable 缓存不超过 500，运行使用同一冻结数据且不产生第二次采集请求。
- SocialCrawl 响应中的 `cached`、`credits_used`、`request_id` 和采集时间进入服务端 source evidence；API Key 与 `credits_remaining` 不进入预览公共响应或运行 artifact。
- SocialCrawl 缺少 Key、余额不足、认证失败、限流重试耗尽或上游失败时，UI 明确显示原因和 `Apple RSS fallback`，不会把缓存标成实时数据。
- SocialCrawl 返回部分坏条目时，合法条目仍可分析，坏条目数量进入 limitation，RSS 不被调用。
- 中国区页面 URL 的采集请求仍明确发送 `country=US`。
- Live、stable、RSS fallback、导入和 cached replay 的自动化测试全部通过；cached replay 对 SocialCrawl、RSS 和模型的请求计数都保持不变。
- `npm run verify` 与 SocialCrawl 本地 stub E2E 通过，tracked-file secret scan 未发现真实 Key。

## File Structure

- Create: `src/server/sources/source-types.ts` — provider 共享的采集状态、limitation 和安全 evidence 类型。
- Create: `src/server/sources/socialcrawl-collector.ts` — SocialCrawl 请求、响应校验、重试、字段映射和安全证据。
- Create: `src/server/sources/socialcrawl-collector.test.ts` — header、500 条、坏条目、错误映射和重试测试。
- Create: `tests/fixtures/socialcrawl/app-reviews.json` — 两条脱敏的 SocialCrawl 成功响应样本。
- Modify: `src/server/config.ts` / `src/server/config.test.ts` — server-only SocialCrawl 环境配置、页面运行时覆盖和受限 base URL override。
- Modify: `src/domain/contracts/config.ts` — 允许设置接口更新或清除 `socialCrawlApiKey`。
- Modify: `src/app/api/config/route.ts` / `.test.ts` — 持久化 Key、立即应用并仅返回非敏感配置状态。
- Modify: `src/components/workbench/settings-panel.tsx` / `.test.tsx` — 在现有设置页增加 SocialCrawl 密码输入、配置状态和清除动作。
- Modify: `src/server/sources/apple-rss-collector.ts` — 仅把共享类型移到 `source-types.ts`，不改变 RSS 行为。
- Modify: `src/server/sources/source-preview.ts` / `.test.ts` — SocialCrawl 优先、RSS 显式降级、缓存融合和 provider 元数据。
- Modify: `src/app/api/source-previews/route.ts` / `.test.ts` — 注入凭据、强制刷新依赖并返回安全摘要。
- Modify: `src/domain/contracts/review.ts` / `.test.ts` — 增加 `socialcrawl-app-store` 原始评论来源。
- Modify: `src/domain/reviews/prepare.ts` / `.test.ts` — 将 RSS 专用 collected bundle 名称泛化，不改清洗逻辑。
- Modify: `src/server/pipeline/orchestrator.ts`、`src/app/api/runs/route.ts` 及现有测试 — 将 provider evidence 从 preview 原样带入运行。
- Modify: `src/components/workbench/run-form.tsx` / `.test.tsx`、`src/i18n/index.ts` / `.test.ts` — 显示 provider、新鲜度、数量、降级原因及设置页中英文文案。
- Modify: `src/components/workbench/workbench.tsx` / `.test.tsx` — 读取 `source-evidence` 并区分 SocialCrawl、RSS fallback 和 local history。
- Modify: `.env.example`、`README.md`、`scripts/check-docs.mjs` — 配置、计费/缓存/限制说明和 secret scan。
- Modify: `playwright.config.ts`、`tests/e2e/upstream-server.ts`、`tests/e2e/global-setup.ts`、`tests/e2e/live-analysis.spec.ts`、`tests/e2e/stable-sample.spec.ts`、`tests/e2e/cached-replay-i18n.spec.ts` — 隔离页面配置文件、本地 SocialCrawl stub 与端到端验收。
- Modify: `tests/integration/live-smoke.test.ts` — 有显式环境开关时才执行真实 SocialCrawl smoke。

---

### Task 1: Add secure SocialCrawl Key management to the settings page

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`
- Modify: `src/domain/contracts/config.ts`
- Modify: `src/app/api/config/route.ts`
- Modify: `src/app/api/config/route.test.ts`
- Modify: `src/components/workbench/settings-panel.tsx`
- Modify: `src/components/workbench/settings-panel.test.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ServerConfig.socialCrawlApiKey: string | null`、`socialCrawlBaseUrl: string`、`socialCrawlTimeoutMs: number`、`isSocialCrawlConfigured(cfg): boolean`、`setRuntimeSocialCrawlConfig(...)`、`resetRuntimeSocialCrawlConfig()`、`ConfigUpdateSchema.socialCrawlApiKey` 和安全的 `socialCrawlApiKeyConfigured` 状态。
- Consumes: 现有 `SettingsPanel`、`GET/POST /api/config`、`loadConfig(env)`、`persistEnvLocal(...)` 与 `.env.local` 加载机制。

- [ ] **Step 1: Write failing configuration tests**

在 `beforeEach` 中删除三个 SocialCrawl 变量，并增加以下断言：

```ts
delete process.env.SOCIALCRAWL_API_KEY;
delete process.env.SOCIALCRAWL_BASE_URL;
delete process.env.SOCIALCRAWL_TIMEOUT_MS;

it("keeps SocialCrawl server-only and disabled without a key", () => {
  const cfg = loadConfig();
  expect(cfg.socialCrawlApiKey).toBeNull();
  expect(cfg.socialCrawlBaseUrl).toBe("https://www.socialcrawl.dev");
  expect(cfg.socialCrawlTimeoutMs).toBe(60_000);
  expect(isSocialCrawlConfigured(cfg)).toBe(false);
});

it("loads a trimmed SocialCrawl key and allows only a loopback test override", () => {
  process.env.SOCIALCRAWL_API_KEY = " sc_test_only ";
  process.env.SOCIALCRAWL_BASE_URL = "http://127.0.0.1:39876";
  process.env.SOCIALCRAWL_TIMEOUT_MS = "90000";
  const cfg = loadConfig();
  expect(cfg.socialCrawlApiKey).toBe("sc_test_only");
  expect(cfg.socialCrawlBaseUrl).toBe("http://127.0.0.1:39876");
  expect(cfg.socialCrawlTimeoutMs).toBe(90_000);
  expect(isSocialCrawlConfigured(cfg)).toBe(true);
});

it("rejects a non-official remote SocialCrawl base URL", () => {
  process.env.SOCIALCRAWL_BASE_URL = "https://collector.example.com";
  expect(loadConfig().socialCrawlBaseUrl).toBe("https://www.socialcrawl.dev");
});

it("applies and clears a SocialCrawl runtime key without restart", () => {
  process.env.SOCIALCRAWL_API_KEY = "sc_from_env";
  setRuntimeSocialCrawlConfig({ apiKey: "sc_from_page" });
  expect(loadConfig().socialCrawlApiKey).toBe("sc_from_page");
  setRuntimeSocialCrawlConfig({ apiKey: null });
  expect(loadConfig().socialCrawlApiKey).toBeNull();
});
```

Call `resetRuntimeSocialCrawlConfig()` in both `beforeEach` and `afterEach` so module state cannot leak between tests.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
npx vitest run --project unit src/server/config.test.ts
```

Expected: type/property failures because SocialCrawl config is not defined.

- [ ] **Step 3: Implement the minimal server configuration**

Add these fields and helper; trim the trailing slash so URL construction is stable:

```ts
export type ServerConfig = {
  // existing fields unchanged
  socialCrawlApiKey: string | null;
  socialCrawlBaseUrl: string;
  socialCrawlTimeoutMs: number;
};

export type RuntimeSocialCrawlConfig = {
  apiKey?: string | null;
};

const runtimeSocialCrawlConfig: RuntimeSocialCrawlConfig = {};

export function setRuntimeSocialCrawlConfig(update: RuntimeSocialCrawlConfig): void {
  if (update.apiKey !== undefined) runtimeSocialCrawlConfig.apiKey = update.apiKey;
}

export function resetRuntimeSocialCrawlConfig(): void {
  runtimeSocialCrawlConfig.apiKey = undefined;
}

const SOCIALCRAWL_ORIGIN = "https://www.socialcrawl.dev";

function socialCrawlBaseUrl(raw: string | undefined): string {
  const value = raw?.trim().replace(/\/+$/, "") || SOCIALCRAWL_ORIGIN;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    return value === SOCIALCRAWL_ORIGIN || loopback ? value : SOCIALCRAWL_ORIGIN;
  } catch {
    return SOCIALCRAWL_ORIGIN;
  }
}

export function isSocialCrawlConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.socialCrawlApiKey);
}
```

Return exact values from `loadConfig`:

```ts
const socialCrawlApiKey = runtimeSocialCrawlConfig.apiKey !== undefined
  ? runtimeSocialCrawlConfig.apiKey
  : (env.SOCIALCRAWL_API_KEY?.trim() || null);

// inside the returned ServerConfig
socialCrawlApiKey,
socialCrawlBaseUrl: socialCrawlBaseUrl(env.SOCIALCRAWL_BASE_URL),
socialCrawlTimeoutMs: Math.max(10_000, intFromEnv("SOCIALCRAWL_TIMEOUT_MS", 60_000)),
```

Keep this override separate from `RuntimeModelConfig`; do not rename or refactor the existing model configuration. Update the `persistEnvLocal` comment from MODEL-only wording to generic configuration wording because the same function will now persist `SOCIALCRAWL_API_KEY`.

- [ ] **Step 4: Write failing config-route tests for save, clear, and non-disclosure**

Reset both runtime stores in route-test setup and add:

```ts
it("reports only whether the SocialCrawl key is configured", async () => {
  process.env.SOCIALCRAWL_API_KEY = "sc_server_secret";
  const json = await jsonResponse(await GET());
  expect(json.socialCrawlApiKeyConfigured).toBe(true);
  expect(json).not.toHaveProperty("socialCrawlApiKey");
  expect(JSON.stringify(json)).not.toContain("sc_server_secret");
});

it("saves a SocialCrawl key, applies it immediately, and never echoes it", async () => {
  const res = await POST(configRequest({ socialCrawlApiKey: "sc_saved_from_page" }));
  expect(res.status).toBe(200);
  expect(loadConfig().socialCrawlApiKey).toBe("sc_saved_from_page");
  expect(readFileSync(envFile, "utf8")).toContain("SOCIALCRAWL_API_KEY=sc_saved_from_page");
  const json = await jsonResponse(res);
  expect(json.socialCrawlApiKeyConfigured).toBe(true);
  expect(JSON.stringify(json)).not.toContain("sc_saved_from_page");
});

it("clears only the SocialCrawl key and preserves model configuration", async () => {
  writeFileSync(envFile, "SOCIALCRAWL_API_KEY=sc_old\nMODEL_NAME=keep-me\n", "utf8");
  setRuntimeSocialCrawlConfig({ apiKey: "sc_old" });
  const res = await POST(configRequest({ socialCrawlApiKey: null }));
  expect(res.status).toBe(200);
  expect(loadConfig().socialCrawlApiKey).toBeNull();
  expect(readFileSync(envFile, "utf8")).not.toContain("SOCIALCRAWL_API_KEY");
  expect(readFileSync(envFile, "utf8")).toContain("MODEL_NAME=keep-me");
});
```

Add a local helper `configRequest(body)` that builds the existing JSON POST request. Also assert an empty string and a value longer than 4096 characters return 422.

- [ ] **Step 5: Run config-route tests and verify RED**

```powershell
npx vitest run --project unit src/app/api/config/route.test.ts
```

Expected: 422 or missing-property failures because the update schema and route do not know SocialCrawl.

- [ ] **Step 6: Extend the strict update schema and config route**

Rename the model-only schema to match its expanded responsibility:

```ts
export const ConfigUpdateSchema = z
  .object({
    modelBaseUrl: z.string().trim().max(2048).url().nullable().optional(),
    modelApiKey: z.string().trim().max(4096).nullable().optional(),
    modelName: z.string().trim().max(256).nullable().optional(),
    modelJsonMode: z.enum(["prompt", "json_object"]).optional(),
    socialCrawlApiKey: z.string().trim().min(1).max(4096).nullable().optional(),
  })
  .strict();
export type ConfigUpdate = z.infer<typeof ConfigUpdateSchema>;
```

Update the route import and return only the boolean status:

```ts
function configStatus(cfg: ReturnType<typeof loadConfig>) {
  return {
    // existing non-sensitive fields
    socialCrawlApiKeyConfigured: isSocialCrawlConfigured(cfg),
  };
}

if (update.socialCrawlApiKey !== undefined) {
  persistEnvLocal("SOCIALCRAWL_API_KEY", update.socialCrawlApiKey);
  setRuntimeSocialCrawlConfig({ apiKey: update.socialCrawlApiKey });
}
```

Keep model updates and response headers unchanged. Do not add the full key, a masked key, key length or suffix to `configStatus`.

- [ ] **Step 7: Write failing settings-page interaction tests**

Extend `settings-panel.test.tsx` with exact user behavior:

```tsx
it("shows configured SocialCrawl status without prefilling the secret", async () => {
  mockFetch({ socialCrawlApiKeyConfigured: true });
  render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
  const input = await screen.findByLabelText(tEn.socialCrawlApiKey);
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveAttribute("autocomplete", "off");
  expect(input).toHaveValue("");
  expect(screen.getByText(tEn.socialCrawlApiKeyConfigured)).toBeVisible();
});

it("sends a newly entered SocialCrawl key and clears the input after save", async () => {
  const fetchMock = configFetchSequence(
    { socialCrawlApiKeyConfigured: false },
    { socialCrawlApiKeyConfigured: true },
  );
  const user = userEvent.setup();
  render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
  const input = await screen.findByLabelText(tEn.socialCrawlApiKey);
  await user.type(input, "sc_ui_test");
  await user.click(screen.getByRole("button", { name: tEn.save }));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ socialCrawlApiKey: "sc_ui_test" });
  await waitFor(() => expect(input).toHaveValue(""));
  expect(screen.getByText(tEn.socialCrawlApiKeyConfigured)).toBeVisible();
});

it("clears only the SocialCrawl key", async () => {
  const fetchMock = configFetchSequence(
    { socialCrawlApiKeyConfigured: true },
    { socialCrawlApiKeyConfigured: false },
  );
  const user = userEvent.setup();
  render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: tEn.socialCrawlApiKeyClear }));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ socialCrawlApiKey: null });
});
```

Add the equivalent visibility test with `tZh` so the section labels and actions are present in Chinese.

- [ ] **Step 8: Run settings tests and verify RED**

```powershell
npx vitest run --project unit:dom src/components/workbench/settings-panel.test.tsx
```

Expected: missing dictionary keys, input and clear button.

- [ ] **Step 9: Implement the minimal settings UI**

Extend local state without storing any returned secret:

```ts
type ConfigState = {
  // existing model fields
  socialCrawlApiKeyConfigured: boolean;
};

const [socialCrawlApiKey, setSocialCrawlApiKey] = useState("");
```

On panel open set the input to `""` and read only `json.socialCrawlApiKeyConfigured`. On save, include `socialCrawlApiKey` only when the trimmed input is non-empty; after a successful POST, parse the returned status, clear the input, and set the boolean from the response rather than guessing optimistically.

Add a “数据采集平台 / Data collection platform” section below the existing model fields:

```tsx
<h4>{t.dataSourceSettings}</h4>
<label htmlFor="settings-socialcrawl-api-key">{t.socialCrawlApiKey}</label>
<p id="settings-socialcrawl-api-key-hint">{t.socialCrawlApiKeyHint}</p>
<div style={{ display: "flex", gap: "6px" }}>
  <input
    id="settings-socialcrawl-api-key"
    aria-describedby="settings-socialcrawl-api-key-hint"
    type="password"
    autoComplete="off"
    value={socialCrawlApiKey}
    onChange={(event) => setSocialCrawlApiKey(event.target.value)}
    placeholder={config.socialCrawlApiKeyConfigured ? t.apiKeyPlaceholder : ""}
    style={fieldStyle}
  />
  {config.socialCrawlApiKeyConfigured ? (
    <button type="button" onClick={() => handleClearSocialCrawlKey()} disabled={saving}>
      {t.socialCrawlApiKeyClear}
    </button>
  ) : null}
</div>
{config.socialCrawlApiKeyConfigured ? <span>{t.socialCrawlApiKeyConfigured}</span> : null}
```

`handleClearSocialCrawlKey` must POST exactly `{ socialCrawlApiKey: null }`, parse the returned status, clear the input and leave model fields untouched. Add these dictionary entries:

| Key | English | 简体中文 |
|---|---|---|
| `dataSourceSettings` | `Data collection platform` | `数据采集平台` |
| `socialCrawlApiKey` | `SocialCrawl API Key` | `SocialCrawl API Key` |
| `socialCrawlApiKeyHint` | `Stored locally and used only by the server for live App Store reviews.` | `仅保存在本机，并由服务端用于实时采集 App Store 评论。` |
| `socialCrawlApiKeyConfigured` | `SocialCrawl configured` | `SocialCrawl 已配置` |
| `socialCrawlApiKeyClear` | `Clear SocialCrawl Key` | `清除 SocialCrawl Key` |

Do not add a reveal button or store either API Key in `localStorage`/`sessionStorage`.

- [ ] **Step 10: Add safe environment documentation**

Append only empty/placeholder configuration to `.env.example`:

```dotenv
# Server-only key for live App Store reviews; save it through Settings or put it in .env.local.
SOCIALCRAWL_API_KEY=
# Production must use https://www.socialcrawl.dev; loopback overrides are for tests only.
# SOCIALCRAWL_BASE_URL=http://127.0.0.1:39876
SOCIALCRAWL_TIMEOUT_MS=60000
```

- [ ] **Step 11: Verify page-managed configuration GREEN**

```powershell
npx vitest run --project unit src/server/config.test.ts src/app/api/config/route.test.ts src/i18n/index.test.ts
npx vitest run --project unit:dom src/components/workbench/settings-panel.test.tsx
npm run typecheck
```

Expected: all suites pass; settings save and clear take effect immediately; `/api/config` JSON contains no `socialCrawlApiKey` field and no string beginning with `sc_`.

- [ ] **Step 12: Commit the secure settings flow**

```powershell
git add .env.example src/server/config.ts src/server/config.test.ts src/domain/contracts/config.ts src/app/api/config/route.ts src/app/api/config/route.test.ts src/components/workbench/settings-panel.tsx src/components/workbench/settings-panel.test.tsx src/i18n/index.ts src/i18n/index.test.ts
git commit -m "feat: configure SocialCrawl from settings"
```

---

### Task 2: Implement and validate the SocialCrawl collector

**Files:**
- Create: `src/server/sources/source-types.ts`
- Create: `src/server/sources/socialcrawl-collector.ts`
- Create: `src/server/sources/socialcrawl-collector.test.ts`
- Create: `tests/fixtures/socialcrawl/app-reviews.json`
- Modify: `src/server/sources/apple-rss-collector.ts`
- Modify: `src/domain/contracts/review.ts`
- Modify: `src/domain/contracts/review.test.ts`

**Interfaces:**
- Consumes: numeric App ID from `parseAppStoreUrl(...)` and `RawReview`.
- Produces: `collectSocialCrawlReviews(deps: SocialCrawlCollectorDeps): Promise<SocialCrawlCollectionResult>` with at most 500 `RawReview` rows and secret-free request evidence.

- [ ] **Step 1: Extract provider-neutral source types**

Create `source-types.ts` with the exact shared contract:

```ts
import type { RawReview } from "@/domain/contracts/review";

export type Limitation = { code: string; message: string; stage: string };
export type CollectionStatus = "complete" | "suspect-empty" | "partial" | "failed";

export type CollectionResult<TEvidence> = {
  status: CollectionStatus;
  reviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  evidence: TEvidence;
};
```

Import `Limitation` from this file in RSS collector and current consumers; leave `PageEvidence`, `SourceResult` and RSS behavior unchanged.

- [ ] **Step 2: Extend the review source schema with an exact provider value**

Update the Zod enum and its positive test:

```ts
export const ReviewSourceSchema = z.enum([
  "apple-rss",
  "socialcrawl-app-store",
  "json-import",
  "csv-import",
]);

expect(ReviewSourceSchema.parse("socialcrawl-app-store")).toBe("socialcrawl-app-store");
```

- [ ] **Step 3: Add a small canonical SocialCrawl fixture**

Create `tests/fixtures/socialcrawl/app-reviews.json` with two items using the documented envelope; use synthetic text and no account information:

```json
{
  "success": true,
  "platform": "app_store",
  "endpoint": "/v1/app_store/app-reviews",
  "data": {
    "items": [
      { "review": { "id": "review-1", "entity_id": "839285684", "title": "Useful", "text": "The guided workout is clear.", "rating": { "value": 5, "max": 5 }, "author": { "name": "user-1" }, "published_at": "2026-08-12T00:00:00.000Z", "ext": { "appdata": { "version": "8.2.0" } } } },
      { "review": { "id": "review-2", "entity_id": "839285684", "title": "Timer issue", "text": "The timer resets after backgrounding.", "rating": { "value": 1, "max": 5 }, "author": { "name": "user-2" }, "published_at": "2026-08-11T00:00:00.000Z", "ext": { "appdata": { "version": "8.2.0" } } } }
    ],
    "total": 2,
    "dropped": 0
  },
  "credits_used": 5,
  "credits_remaining": 95,
  "request_id": "req_fixture",
  "cached": false,
  "pagination": { "next_cursor": null, "has_more": false, "page_size": 50 }
}
```

- [ ] **Step 4: Define collector input and safe output types**

Add the following exported contracts to `socialcrawl-collector.ts`:

```ts
export const SOCIALCRAWL_REVIEW_DEPTH = 500;

export type SocialCrawlCollectorDeps = {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  baseUrl: string;
  apiKey: string;
  appId: string;
  timeoutMs: number;
  idempotencyKey: string;
  signal?: AbortSignal;
  maxRetries?: number;
};

export type SocialCrawlEvidence = {
  provider: "socialcrawl";
  endpoint: "/v1/app_store/app-reviews";
  country: "US";
  language: "en";
  requestedDepth: 500;
  sortBy: "most_recent";
  forcedRefresh: true;
  cached: boolean | null;
  requestId: string | null;
  creditsUsed: number | null;
  startedAt: string;
  finishedAt: string;
  httpStatus: number | null;
  attemptCount: number;
  providerDropped: number;
  parserDropped: number;
};

export type SocialCrawlCollectionResult = CollectionResult<SocialCrawlEvidence>;
```

Deliberately omit `apiKey`, request headers and `credits_remaining` from evidence.

- [ ] **Step 5: Write failing request and mapping tests**

Use the fixture and assert the complete wire contract:

```ts
it("forces a fresh US most-recent request and maps unified reviews", async () => {
  const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    new Response(fixture("app-reviews.json"), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;

  const result = await collectSocialCrawlReviews(deps({ fetchFn }));

  const [url, init] = fetchFn.mock.calls[0];
  expect(String(url)).toBe("https://www.socialcrawl.dev/v1/app_store/app-reviews?app_id=839285684&country=US&language=en&depth=500&sort_by=most_recent");
  expect(new Headers(init?.headers).get("x-api-key")).toBe("sc_test_only");
  expect(new Headers(init?.headers).get("cache-control")).toBe("no-cache");
  expect(new Headers(init?.headers).get("idempotency-key")).toBe("preview-1");
  expect(result.reviews).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceReviewId: "review-1", source: "socialcrawl-app-store", rating: 5, version: "8.2.0" }),
  ]));
  expect(JSON.stringify(result.evidence)).not.toContain("sc_test_only");
});
```

- [ ] **Step 6: Write failing volume and malformed-item tests**

Programmatically clone the fixture item to avoid a 500-row fixture:

```ts
it("caps a successful response at 500 reviews", async () => {
  const body = successEnvelope(Array.from({ length: 600 }, (_, i) => reviewItem(`r-${i}`)));
  const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch(body) }));
  expect(result.reviews).toHaveLength(500);
  expect(result.rawRefs).toHaveLength(500);
  expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_APP_CAP" }));
});

it("keeps valid items and marks malformed items partial without RSS concerns", async () => {
  const body = successEnvelope([reviewItem("good"), { review: { id: "bad", text: "", rating: { value: 9 } } }]);
  const result = await collectSocialCrawlReviews(deps({ fetchFn: jsonFetch(body) }));
  expect(result.status).toBe("partial");
  expect(result.reviews.map((r) => r.sourceReviewId)).toEqual(["good"]);
  expect(result.evidence.parserDropped).toBe(1);
  expect(result.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_ITEMS_DROPPED" }));
});
```

- [ ] **Step 7: Write failing retry and deterministic-error tests**

Cover the documented error envelope and exact policy:

```ts
it.each([
  [401, "INVALID_API_KEY", "SOCIALCRAWL_AUTH_FAILED"],
  [402, "INSUFFICIENT_CREDITS", "SOCIALCRAWL_CREDITS_EXHAUSTED"],
  [404, "RESOURCE_NOT_FOUND", "SOCIALCRAWL_RESOURCE_NOT_FOUND"],
])("does not retry deterministic %s errors", async (status, type, code) => {
  const fetchFn = vi.fn(async () => errorResponse(status, type)) as unknown as typeof fetch;
  const result = await collectSocialCrawlReviews(deps({ fetchFn }));
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(result.limitations).toContainEqual(expect.objectContaining({ code }));
});

it("honors Retry-After and reuses the idempotency key on a 429 retry", async () => {
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(errorResponse(429, "RATE_LIMITED", { "retry-after": "1" }))
    .mockResolvedValueOnce(jsonResponse(successEnvelope([reviewItem("ok")])));
  const sleep = vi.fn(async () => {});
  const result = await collectSocialCrawlReviews(deps({ fetchFn: fetchFn as typeof fetch, sleep }));
  expect(result.status).toBe("complete");
  expect(sleep).toHaveBeenCalledWith(1000);
  expect(fetchFn.mock.calls.map(([, init]) => new Headers(init?.headers).get("idempotency-key"))).toEqual(["preview-1", "preview-1"]);
});
```

Add cases for `500`, `502`, `503` with and without `Retry-After`, timeout/abort, invalid JSON and a top-level `success:false` envelope returned with HTTP 200.

- [ ] **Step 8: Run collector tests and verify RED**

```powershell
npx vitest run --project unit src/server/sources/socialcrawl-collector.test.ts src/domain/contracts/review.test.ts
```

Expected: import failures because the collector and new source enum are not implemented.

- [ ] **Step 9: Implement Zod validation, mapping and evidence**

Use a strict envelope for required top-level fields and per-item `safeParse`. Map only supported fields:

```ts
function toRawReview(item: SocialCrawlReviewItem): RawReview {
  return {
    sourceReviewId: item.review.id,
    source: "socialcrawl-app-store",
    title: item.review.title ?? "",
    body: item.review.text,
    rating: item.review.rating.value,
    version: item.review.ext?.appdata?.version ?? null,
    updatedAt: normalizePublishedAt(item.review.published_at),
  };
}

const rawRefs = reviews.map((review) =>
  `socialcrawl:${envelope.request_id}#review:${review.sourceReviewId}`,
);
```

`normalizePublishedAt` accepts ISO strings or millisecond epoch numbers, returns an ISO string or `null`, and never substitutes the current time.

- [ ] **Step 10: Implement bounded fetch and retry**

Build the query with `URL`/`searchParams`, not string interpolation, and use these headers on every attempt:

```ts
const headers = {
  accept: "application/json",
  "x-api-key": deps.apiKey,
  "cache-control": "no-cache",
  "idempotency-key": deps.idempotencyKey,
};
```

Reuse one abort controller per attempt, forward the caller signal, and cap parsed `Retry-After` sleeps at 30 seconds. A result with zero valid reviews returns `suspect-empty`; a malformed envelope or exhausted transient failure returns `failed`. Error messages may contain status, stable error type and SocialCrawl `request_id`, but never response/request headers or the API Key.

- [ ] **Step 11: Verify the complete collector suite GREEN**

```powershell
npx vitest run --project unit src/server/sources/socialcrawl-collector.test.ts src/server/sources/apple-rss-collector.test.ts src/domain/contracts/review.test.ts
npm run typecheck
```

Expected: all tests pass; existing RSS output and status behavior remain unchanged.

- [ ] **Step 12: Commit the collector**

```powershell
git add src/server/sources/source-types.ts src/server/sources/socialcrawl-collector.ts src/server/sources/socialcrawl-collector.test.ts src/server/sources/apple-rss-collector.ts src/domain/contracts/review.ts src/domain/contracts/review.test.ts tests/fixtures/socialcrawl/app-reviews.json
git commit -m "feat: collect live App Store reviews with SocialCrawl"
```

---

### Task 3: Make preview collection SocialCrawl-first with explicit RSS fallback

**Files:**
- Modify: `src/server/sources/source-preview.ts`
- Modify: `src/server/sources/source-preview.test.ts`
- Modify: `src/server/sources/apple-review-cache.ts`
- Modify: `src/server/sources/apple-review-cache.test.ts`
- Modify: `src/app/api/source-previews/route.ts`
- Modify: `src/app/api/source-previews/route.test.ts`

**Interfaces:**
- Consumes: optional `SocialCrawlCollectorDeps`, mandatory RSS `CollectorDeps`, existing `AppleReviewCacheStore`.
- Produces: one immutable preview whose `live.provider` is exactly `socialcrawl` or `apple-rss`, plus safe SocialCrawl metadata and explicit fallback limitation.

- [ ] **Step 1: Extend the preview contract without changing `live`/`stable` selection names**

Use this provider metadata in the server snapshot:

```ts
type LiveProvider = "socialcrawl" | "apple-rss";

type SourcePreviewStable = {
  available: boolean;
  reviewCount: number;
  cacheUpdatedAt: string | null;
  dateRange: { earliest: string | null; latest: string | null };
  bootstrapRunId: string | null;
  reviews: RawReview[];
};

type LiveSourceEvidence =
  | SocialCrawlEvidence
  | { provider: "apple-rss"; pageCount: number; requestCount: number };

export type SourcePreview = {
  // existing top-level fields unchanged
  live: {
    provider: LiveProvider;
    forcedRefresh: boolean;
    cached: boolean | null;
    collectedAt: string;
    status: CollectionStatus;
    reviewCount: number;
    pageCount: number;
    requestCount: number;
    dateRange: { earliest: string | null; latest: string | null };
    limitations: Limitation[];
    evidence: LiveSourceEvidence;
    reviews: RawReview[];
    rawRefs: string[];
  };
  stable: SourcePreviewStable;
  recommendedSelection: "live" | "stable" | null;
};
```

Do not put a provider-wide `cached:true` flag on `SourcePreviewStable` because it is explicitly local history.

- [ ] **Step 2: Write failing provider-dispatch tests**

Mock both collectors and assert exact call order:

```ts
it("uses SocialCrawl only when it returns valid reviews", async () => {
  mockedSocialCrawl.mockResolvedValue(socialResult({ reviews: [socialRaw("s1")] }));
  const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
  expect(mockedSocialCrawl).toHaveBeenCalledTimes(1);
  expect(mockedRss).not.toHaveBeenCalled();
  expect(preview.live.provider).toBe("socialcrawl");
  expect(preview.live.forcedRefresh).toBe(true);
  expect(preview.live.cached).toBe(false);
});

it("falls back to RSS when SocialCrawl is not configured", async () => {
  mockedRss.mockResolvedValue(rssResult({ reviews: [rssRaw("r1")] }));
  const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: null }));
  expect(mockedSocialCrawl).not.toHaveBeenCalled();
  expect(mockedRss).toHaveBeenCalledTimes(1);
  expect(preview.live.provider).toBe("apple-rss");
  expect(preview.live.limitations).toContainEqual(expect.objectContaining({ code: "SOCIALCRAWL_NOT_CONFIGURED" }));
});
```

- [ ] **Step 3: Write failing fallback and no-mixing tests**

```ts
it("uses RSS after SocialCrawl deterministic failure and preserves the reason", async () => {
  mockedSocialCrawl.mockResolvedValue(socialResult({ status: "failed", limitations: [limit("SOCIALCRAWL_CREDITS_EXHAUSTED")] }));
  mockedRss.mockResolvedValue(rssResult({ reviews: [rssRaw("rss-only")] }));
  const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
  expect(preview.live.provider).toBe("apple-rss");
  expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["rss-only"]);
  expect(preview.live.limitations.map((l) => l.code)).toContain("SOCIALCRAWL_CREDITS_EXHAUSTED");
});

it("does not mix RSS into a partial SocialCrawl result", async () => {
  mockedSocialCrawl.mockResolvedValue(socialResult({ status: "partial", reviews: [socialRaw("valid")], limitations: [limit("SOCIALCRAWL_ITEMS_DROPPED")] }));
  const preview = await runPreviewImpl(makeInput({ socialCrawlCollector: socialDeps() }));
  expect(mockedRss).not.toHaveBeenCalled();
  expect(preview.live.reviews.map((r) => r.sourceReviewId)).toEqual(["valid"]);
});
```

- [ ] **Step 4: Run preview tests and verify RED**

```powershell
npx vitest run --project unit src/server/sources/source-preview.test.ts
```

Expected: missing SocialCrawl dependency and provider metadata failures.

- [ ] **Step 5: Implement single-provider preview dispatch**

Change `PreviewInput` to contain:

```ts
export type PreviewInput = {
  // existing identity/storage fields
  socialCrawlCollector: SocialCrawlCollectorDeps | null;
  rssCollector: CollectorDeps;
};
```

Select the result with this exact rule:

```ts
const social = input.socialCrawlCollector
  ? await collectSocialCrawlReviews(input.socialCrawlCollector)
  : null;

const useSocial = social !== null && social.reviews.length > 0;
const rss = useSocial ? null : await collectAppleReviews(input.rssCollector);
const selected = useSocial ? social : rss!;
```

When `social === null`, prepend `SOCIALCRAWL_NOT_CONFIGURED`; when it failed or was empty, preserve all of its limitations before RSS limitations. Do not append SocialCrawl reviews to an RSS result.

- [ ] **Step 6: Preserve the 500-item local cache across both providers**

Keep `mergeLive("us", appId, selected.reviews)` and its existing max of 500. Update history bootstrap acceptance so both legacy and new source evidence qualify:

```ts
const supportedKind = sourceSummary.kind === "apple-rss" || sourceSummary.kind === "app-store-reviews";
if (!supportedKind || String(sourceSummary.appId) !== appId) continue;
```

Add a test proving a completed SocialCrawl run can bootstrap a cache and a legacy RSS run still works.

- [ ] **Step 7: Inject SocialCrawl only from the preview route**

Read the relevant installed Next.js route docs, then build the dependency only when a key is configured:

```ts
socialCrawlCollector: cfg.socialCrawlApiKey
  ? {
      fetchFn: fetch,
      sleep,
      now,
      baseUrl: cfg.socialCrawlBaseUrl,
      apiKey: cfg.socialCrawlApiKey,
      appId,
      timeoutMs: cfg.socialCrawlTimeoutMs,
      idempotencyKey: previewId,
      signal: req.signal,
    }
  : null,
rssCollector: {
  fetchFn: fetch,
  sleep,
  now,
  baseUrl: cfg.appleRssBaseUrl,
  appId,
  maxPages: cfg.appleRssMaxPages,
  pageDelayMs: cfg.appleRssPageDelayMs,
  timeoutMs: cfg.appleRssTimeoutMs,
  signal: req.signal,
},
```

- [ ] **Step 8: Return a secret-free public preview summary**

Expose only these new fields inside `live`:

```ts
provider: preview.live.provider,
forcedRefresh: preview.live.forcedRefresh,
cached: preview.live.cached,
collectedAt: preview.live.collectedAt,
creditsUsed: preview.live.provider === "socialcrawl" ? preview.live.evidence.creditsUsed : null,
requestId: preview.live.provider === "socialcrawl" ? preview.live.evidence.requestId : null,
```

Keep reviews and the full evidence object server-side. Do not expose `creditsRemaining` because it is account metadata unrelated to analysis.

- [ ] **Step 9: Add route-level header, US storefront and leakage tests**

Stub SocialCrawl and assert:

```ts
expect(url.searchParams.get("country")).toBe("US");
expect(url.searchParams.get("depth")).toBe("500");
expect(headers.get("cache-control")).toBe("no-cache");
expect(headers.get("x-api-key")).toBe("sc_route_test");
expect(JSON.stringify(await res.clone().json())).not.toContain("sc_route_test");
expect(JSON.stringify(await readPreview(previewsDir, previewId))).not.toContain("sc_route_test");
```

Also keep the existing `/cn/` input test and change its assertion from an RSS URL to `country=US` on the SocialCrawl request.

- [ ] **Step 10: Verify preview, route and cache GREEN**

```powershell
npx vitest run --project unit src/server/sources/source-preview.test.ts src/server/sources/apple-review-cache.test.ts src/app/api/source-previews/route.test.ts
npm run typecheck
```

Expected: SocialCrawl success performs one SocialCrawl call and zero RSS calls; each fallback performs the expected calls and carries the reason.

- [ ] **Step 11: Commit preview dispatch**

```powershell
git add src/server/sources/source-preview.ts src/server/sources/source-preview.test.ts src/server/sources/apple-review-cache.ts src/server/sources/apple-review-cache.test.ts src/app/api/source-previews/route.ts src/app/api/source-previews/route.test.ts
git commit -m "feat: prefer SocialCrawl in review previews"
```

---

### Task 4: Preserve SocialCrawl provenance in immutable analysis runs

**Files:**
- Modify: `src/domain/reviews/prepare.ts`
- Modify: `src/domain/reviews/prepare.test.ts`
- Modify: `src/server/pipeline/orchestrator.ts`
- Modify: `tests/integration/pipeline-live.test.ts`
- Modify: `src/app/api/runs/route.ts`
- Modify: `src/app/api/runs/route.test.ts`

**Interfaces:**
- Consumes: provider-aware `SourcePreview` selected by `previewId` and `reviewSelection`.
- Produces: `source-evidence` with `kind: "app-store-reviews"` and a provider discriminator, while keeping legacy RSS evidence readable for old runs/cache.

- [ ] **Step 1: Generalize the prepare input name without changing behavior**

Replace the RSS-only branch with a provider-neutral collected branch:

```ts
export function prepareReviews(
  input:
    | { kind: "collected"; reviews: RawReview[]; rawRefs: string[]; limitations: Limitation[] }
    | { kind: "import"; parse: ImportParseResult },
): PreparedReviews {
  const bundle = input.kind === "collected"
    ? { rawReviews: input.reviews, rawRefs: input.rawRefs, limitations: input.limitations, warnings: [] }
    : bundleFromImport(input.parse);
  // existing dedupe and stats logic unchanged
}
```

Update existing tests from `kind: "apple-rss"` to `kind: "collected"` and add one `socialcrawl-app-store` row proving the source survives normalization.

- [ ] **Step 2: Define a provider-aware source summary**

Update `PreviewSourceShape.sourceSummary` to this exact shape:

```ts
type AppStoreReviewSourceSummary = {
  kind: "app-store-reviews";
  provider: "socialcrawl" | "apple-rss";
  appId: string;
  storefront: "US";
  status: CollectionStatus;
  selection: "live" | "stable";
  liveCount: number;
  stableCount: number;
  reviewCount: number;
  collectedAt: string;
  forcedRefresh: boolean;
  providerCached: boolean | null;
  requestCount: number;
  requestId: string | null;
  creditsUsed: number | null;
};
```

No credential field is permitted in this type.

- [ ] **Step 3: Write failing run-route provenance tests**

Persist a SocialCrawl preview fixture, call `/api/runs`, and assert:

```ts
expect(sourceEvidence).toMatchObject({
  kind: "app-store-reviews",
  provider: "socialcrawl",
  appId: "839285684",
  storefront: "US",
  selection: "live",
  reviewCount: 2,
  forcedRefresh: true,
  providerCached: false,
  requestId: "req_test",
  creditsUsed: 5,
});
expect(JSON.stringify(sourceEvidence)).not.toContain("sc_");
```

Capture upstream call counts before starting the run and assert they do not change, proving the route reads frozen preview reviews.

- [ ] **Step 4: Carry preview provider evidence through `/api/runs`**

When building preview deps, preserve all source limitations and construct the summary from the selected snapshot:

```ts
sourceSummary: {
  kind: "app-store-reviews",
  provider: selected.live.provider,
  appId: parsed.appId,
  storefront: "US",
  status,
  selection,
  liveCount: selected.live.reviewCount,
  stableCount: selected.stable.reviewCount,
  reviewCount: reviews.length,
  collectedAt: selected.live.collectedAt,
  forcedRefresh: selected.live.forcedRefresh,
  providerCached: selected.live.cached,
  requestCount: selected.live.requestCount,
  requestId: selected.live.provider === "socialcrawl" ? selected.live.evidence.requestId : null,
  creditsUsed: selected.live.provider === "socialcrawl" ? selected.live.evidence.creditsUsed : null,
},
```

For `selection === "stable"`, add `LOCAL_HISTORY_SELECTED`; do not claim the stable dataset itself was forced fresh.

- [ ] **Step 5: Update the pipeline to prepare all collected providers uniformly**

Use:

```ts
const prepared = deps.source.kind === "import"
  ? prepareReviews({ kind: "import", parse: deps.source.parse })
  : prepareReviews({ kind: "collected", reviews: source.rawReviews, rawRefs: source.rawRefs, limitations: source.limitations });
```

Keep the direct legacy `{ kind: "apple-rss" }` execution path for existing integration tests and API compatibility; only preview-backed UI runs use SocialCrawl.

- [ ] **Step 6: Verify immutable run provenance GREEN**

```powershell
npx vitest run --project unit src/domain/reviews/prepare.test.ts src/app/api/runs/route.test.ts
npx vitest run --project integration tests/integration/pipeline-live.test.ts
npm run typecheck
```

Expected: new SocialCrawl evidence passes; legacy RSS integration cases and import cases remain green.

- [ ] **Step 7: Commit run provenance**

```powershell
git add src/domain/reviews/prepare.ts src/domain/reviews/prepare.test.ts src/server/pipeline/orchestrator.ts tests/integration/pipeline-live.test.ts src/app/api/runs/route.ts src/app/api/runs/route.test.ts
git commit -m "feat: preserve SocialCrawl run provenance"
```

---

### Task 5: Show honest freshness, provider and fallback state in the UI

**Files:**
- Modify: `src/components/workbench/run-form.tsx`
- Modify: `src/components/workbench/run-form.test.tsx`
- Modify: `src/components/workbench/workbench.tsx`
- Modify: `src/components/workbench/workbench.test.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`

**Interfaces:**
- Consumes: public preview `live.provider`、`forcedRefresh`、`cached`、`collectedAt`、`creditsUsed`、`requestId` 和 limitations。
- Produces: 中英文一致的实时/降级/历史标签，并从 `source-evidence` artifact 驱动运行来源徽章，不显示 API Key 或账户余额。

- [ ] **Step 1: Extend the client preview summary type**

Add these exact fields under `live`:

```ts
provider: "socialcrawl" | "apple-rss";
forcedRefresh: boolean;
cached: boolean | null;
collectedAt: string;
creditsUsed: number | null;
requestId: string | null;
```

- [ ] **Step 2: Write failing SocialCrawl live-card tests**

```ts
it("shows a forced-fresh 500-review SocialCrawl sample", async () => {
  stubFetch(previewSummary({ provider: "socialcrawl", liveCount: 500, cached: false, creditsUsed: 5 }));
  await checkSample();
  expect(await screen.findByText("500 fresh reviews")).toBeVisible();
  expect(screen.getByText("SocialCrawl · fresh fetch")).toBeVisible();
  expect(screen.getByText("Credits used: 5")).toBeVisible();
  expect(screen.getByRole("button", { name: "Analyze fresh sample" })).toBeEnabled();
});
```

Add the Chinese equivalent: `500 条最新采集评论`、`SocialCrawl · 强制刷新`、`本次使用 credits: 5`、`分析最新样本`。

- [ ] **Step 3: Write failing RSS fallback and local-history tests**

```ts
it("labels RSS as a fallback and never as SocialCrawl fresh data", async () => {
  stubFetch(previewSummary({ provider: "apple-rss", liveCount: 50, limitations: [limit("SOCIALCRAWL_CREDITS_EXHAUSTED")] }));
  await checkSample();
  expect(await screen.findByText("Apple RSS fallback")).toBeVisible();
  expect(screen.getByText(/SocialCrawl credits unavailable/)).toBeVisible();
  expect(screen.queryByText("SocialCrawl · fresh fetch")).not.toBeInTheDocument();
});

it("keeps local history separate from the live provider", async () => {
  stubFetch(previewSummary({ provider: "socialcrawl", liveCount: 50, stableCount: 500 }));
  await checkSample();
  expect(screen.getByText("50 fresh reviews")).toBeVisible();
  expect(screen.getByText("500 local-history reviews")).toBeVisible();
});
```

- [ ] **Step 4: Add exact bilingual copy**

Add dictionary keys with these values:

| Key | English | 简体中文 |
|---|---|---|
| `freshReviews` | `fresh reviews` | `条最新采集评论` |
| `localHistoryReviews` | `local-history reviews` | `条本地历史评论` |
| `socialCrawlFresh` | `SocialCrawl · fresh fetch` | `SocialCrawl · 强制刷新` |
| `socialCrawlCached` | `SocialCrawl · provider cache` | `SocialCrawl · 服务商缓存` |
| `appleRssFallback` | `Apple RSS fallback` | `Apple RSS 降级采集` |
| `creditsUsed` | `Credits used` | `本次使用 credits` |
| `analyzeFresh` | `Analyze fresh sample` | `分析最新样本` |
| `analyzeHistory` | `Analyze local history` | `分析本地历史样本` |
| `freshnessCaveat` | `Fresh fetch requested; App Store publication may still be delayed.` | `已请求强制刷新；App Store 评论发布本身仍可能有延迟。` |
| `sourceSocialCrawl` | `SocialCrawl / US App Store` | `SocialCrawl / 美国区 App Store` |
| `sourceSocialCrawlHistory` | `SocialCrawl / US App Store · Local history` | `SocialCrawl / 美国区 App Store · 本地历史` |
| `sourceRssFallback` | `Apple RSS fallback / US App Store` | `Apple RSS 降级采集 / 美国区 App Store` |
| `sourceRssHistory` | `Apple RSS fallback / US App Store · Local history` | `Apple RSS 降级采集 / 美国区 App Store · 本地历史` |

Map stable error codes to user-facing text without including upstream error bodies.

- [ ] **Step 5: Implement the live and stable cards**

The live card provider label follows:

```ts
const providerLabel = preview.live.provider === "socialcrawl"
  ? (preview.live.cached ? t.socialCrawlCached : t.socialCrawlFresh)
  : t.appleRssFallback;
```

Show `collectedAt`; show `creditsUsed` only when it is a non-null number, formatted as `${t.creditsUsed}: ${creditsUsed}`. The stable card always uses local-history wording and keeps `cacheUpdatedAt`. Do not render `requestId` by default; retain it in the summary for support correlation from server-side evidence.

- [ ] **Step 6: Load source evidence and update the run provenance badge**

Add the source artifact to `ArtifactCache` and the existing artifact map in `workbench.tsx`:

```ts
type SourceEvidence = {
  kind: "app-store-reviews" | "apple-rss" | "import";
  provider?: "socialcrawl" | "apple-rss";
  selection?: "live" | "stable";
};

type ArtifactCache = {
  // existing fields
  sourceEvidence?: SourceEvidence;
};

const map: Record<string, keyof ArtifactCache> = {
  "source-evidence": "sourceEvidence",
  // existing artifact entries unchanged
};
```

After the existing cached-replay check, derive the label from `cache.sourceEvidence`:

```ts
const evidence = cache.sourceEvidence;
if (evidence?.kind === "app-store-reviews" && evidence.provider === "socialcrawl") {
  return { kind: "source" as const, label: evidence.selection === "stable" ? t.sourceSocialCrawlHistory : t.sourceSocialCrawl };
}
if (evidence?.kind === "app-store-reviews" && evidence.provider === "apple-rss") {
  return { kind: "source" as const, label: evidence.selection === "stable" ? t.sourceRssHistory : t.sourceRssFallback };
}
```

Retain the current event/limitation inference as the fallback for legacy `apple-rss`, import and old cached runs. Add `sourceSocialCrawl`, `sourceSocialCrawlHistory`, `sourceRssFallback` and `sourceRssHistory` in both locales, and cover all four branches in `workbench.test.tsx`.

- [ ] **Step 7: Verify UI and i18n GREEN**

```powershell
npx vitest run --project unit:dom src/components/workbench/run-form.test.tsx src/components/workbench/workbench.test.tsx
npx vitest run --project unit src/i18n/index.test.ts
npm run typecheck
```

Expected: both locales distinguish fresh provider data, RSS fallback and local history; existing import/replay controls still pass.

- [ ] **Step 8: Commit UI provenance**

```powershell
git add src/components/workbench/run-form.tsx src/components/workbench/run-form.test.tsx src/components/workbench/workbench.tsx src/components/workbench/workbench.test.tsx src/i18n/index.ts src/i18n/index.test.ts
git commit -m "feat: show live review freshness and provider"
```

---

### Task 6: Document, exercise and verify SocialCrawl acquisition

**Files:**
- Modify: `README.md`
- Modify: `scripts/check-docs.mjs`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/upstream-server.ts`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `tests/e2e/live-analysis.spec.ts`
- Modify: `tests/e2e/stable-sample.spec.ts`
- Modify: `tests/e2e/cached-replay-i18n.spec.ts`
- Modify: `tests/integration/live-smoke.test.ts`

**Interfaces:**
- Consumes: completed SocialCrawl-first preview and immutable-run flow.
- Produces: reproducible local E2E evidence, optional real smoke test, current source documentation and tracked-secret protection.

- [ ] **Step 1: Update README source and operation documentation**

Document these exact facts:

- Primary endpoint: `GET /v1/app_store/app-reviews`.
- Required parameters: `app_id`, `country=US`, `language=en`, `depth=500`, `sort_by=most_recent`.
- Authentication: server-only `x-api-key` from `SOCIALCRAWL_API_KEY`.
- Freshness: UI checks send `Cache-Control: no-cache`; `cached` and collection timestamp remain visible; this does not guarantee zero App Store publication delay.
- Current documented SocialCrawl cost: 5 credits per successful App Store reviews call; verify provider pricing before changing budgets.
- Error strategy: retry only transient `429/500/502/503`, maximum two retries, then explicit RSS fallback.
- Fallback: RSS may expose only a small newest window; local history is separate and never presented as live.
- Data volume: SocialCrawl supports up to 600 but this application intentionally caps at 500.
- Key setup: use the page Settings → Data collection platform form, or set `SOCIALCRAWL_API_KEY=` directly in `.env.local`; never paste the real value into README, `.env.example`, screenshots or issue text.

- [ ] **Step 2: Extend documentation and secret checks**

Update `scripts/check-docs.mjs` to require the SocialCrawl endpoint, US parameters, `depth=500`, force-refresh wording, fallback wording and `SOCIALCRAWL_API_KEY`. Extend the existing tracked-file secret check:

```js
function localEnvValue(name) {
  if (!existsSync(".env.local")) return undefined;
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  const raw = line.slice(line.indexOf("=") + 1).trim();
  return raw.startsWith('"') && raw.endsWith('"')
    ? raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : raw;
}

const configuredSecrets = [
  process.env.MODEL_API_KEY?.trim() || localEnvValue("MODEL_API_KEY"),
  process.env.SOCIALCRAWL_API_KEY?.trim() || localEnvValue("SOCIALCRAWL_API_KEY"),
].filter((value) => value && value.length >= 12);

for (const secret of configuredSecrets) {
  assert(!trackedText.includes(secret), "a configured secret appears in a tracked file");
}
```

Never print `secret` in a failure message.

- [ ] **Step 3: Add a deterministic SocialCrawl E2E upstream**

Extend counters:

```ts
export type UpstreamState = {
  socialCrawlRequests: number;
  rssRequests: number;
  modelRequests: number;
};
```

Serve `/v1/app_store/app-reviews` only when all assertions hold:

```ts
req.headers["x-api-key"] === "sc_e2e_only";
req.headers["cache-control"] === "no-cache";
typeof req.headers["idempotency-key"] === "string";
url.searchParams.get("country") === "US";
url.searchParams.get("language") === "en";
url.searchParams.get("depth") === "500";
url.searchParams.get("sort_by") === "most_recent";
```

Return a deterministic two-review SocialCrawl envelope with `cached:false`, `credits_used:5` and `request_id:"req_e2e"`. Keep the current RSS and model handlers for fallback tests.

- [ ] **Step 4: Configure and isolate only the local E2E process**

In `playwright.config.ts` add server-process-only test values:

```ts
webServer: {
  // existing fields unchanged
  env: {
    // existing test environment unchanged
    SOCIALCRAWL_API_KEY: "sc_e2e_only",
    SOCIALCRAWL_BASE_URL: "http://127.0.0.1:39876",
    ENV_LOCAL_FILE: "./data/config-e2e/.env.local",
  },
},
```

Add `"config-e2e"` to `TEST_ONLY_DIRS` in global setup so the settings-page persistence file is removed before and after E2E. This test-only value is intentionally non-production and must never equal the operator's real key.

- [ ] **Step 5: Add the SocialCrawl live E2E**

Extend `live-analysis.spec.ts`:

```ts
test("analyzes a forced-fresh SocialCrawl preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const socialCrawlKey = page.getByLabel("SocialCrawl API Key");
  await expect(socialCrawlKey).toHaveValue("");
  await socialCrawlKey.fill("sc_e2e_only");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("SocialCrawl configured")).toBeVisible();
  await expect(socialCrawlKey).toHaveValue("");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Analysis goal").fill("Understand recent workout usability complaints");
  await page.getByRole("button", { name: "Check sample" }).click();
  await expect(page.getByText("SocialCrawl · fresh fetch")).toBeVisible();
  await expect(page.getByText("2 fresh reviews")).toBeVisible();
  await page.getByRole("button", { name: "Analyze fresh sample" }).click();
  await expect(page.getByText("SocialCrawl / US App Store", { exact: true })).toBeVisible();
});
```

Assert `socialCrawlRequests === 1` after preview and remains `1` after the run completes.

- [ ] **Step 6: Add fallback, stable and replay E2E assertions**

Provide a deterministic stub switch that returns a `402 INSUFFICIENT_CREDITS` envelope. Assert:

1. SocialCrawl count increments once.
2. RSS count increments and the UI displays `Apple RSS fallback`.
3. Stable sample displays `Local history`, never `fresh`.
4. Cached replay leaves SocialCrawl, RSS and model counters unchanged.

- [ ] **Step 7: Make the real smoke explicit and non-default**

Replace the default real RSS smoke with an opt-in SocialCrawl smoke:

```ts
const enabled = process.env.RUN_SOCIALCRAWL_SMOKE === "1" && Boolean(process.env.SOCIALCRAWL_API_KEY);

it.skipIf(!enabled)("collects current US App Store reviews through SocialCrawl", async () => {
  const result = await collectSocialCrawlReviews({
    fetchFn: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date().toISOString(),
    baseUrl: "https://www.socialcrawl.dev",
    apiKey: process.env.SOCIALCRAWL_API_KEY!,
    appId: "839285684",
    timeoutMs: 60_000,
    idempotencyKey: `smoke-${crypto.randomUUID()}`,
  });
  expect(result.reviews.length).toBeGreaterThan(0);
  expect(result.reviews.length).toBeLessThanOrEqual(500);
});
```

The test must not log the request headers, environment or full error response.

- [ ] **Step 8: Run focused integration and E2E verification**

```powershell
npm run check:docs
npx playwright test tests/e2e/live-analysis.spec.ts tests/e2e/stable-sample.spec.ts tests/e2e/cached-replay-i18n.spec.ts
npm run test:integration
```

Expected: local stubs pass without external credits; real SocialCrawl smoke remains skipped unless explicitly enabled.

- [ ] **Step 9: Run the full verification gate**

```powershell
npm run verify
git diff --check
git status --short
git grep -n --fixed-strings "$env:SOCIALCRAWL_API_KEY" -- ':!docs/goal.md' ':!.env.local'
```

Expected: lint, types, docs, coverage and build pass; diff check is clean; the final grep prints nothing when the environment variable is configured. Confirm `docs/goal.md` and `.env.local` are neither modified nor staged.

- [ ] **Step 10: Run Standard QA and fix only observed regressions**

Use the `qa` skill in Standard mode. Exercise English and Chinese live preview, forced refresh, 500-count rendering, SocialCrawl 402 fallback, partial provider data, stable selection, import and cached replay. For each discovered defect, first add a failing automated test, then make the smallest fix and rerun its owning suite.

- [ ] **Step 11: Commit final documentation and verification coverage**

```powershell
git add README.md scripts/check-docs.mjs playwright.config.ts tests/e2e/upstream-server.ts tests/e2e/global-setup.ts tests/e2e/live-analysis.spec.ts tests/e2e/stable-sample.spec.ts tests/e2e/cached-replay-i18n.spec.ts tests/integration/live-smoke.test.ts
git commit -m "test: verify SocialCrawl review acquisition"
```

## Execution Order and Review Gates

1. Task 1 must pass before any live key is read by application code.
2. Task 2 must pass collector unit tests and secret leakage assertions before route integration begins.
3. Task 3 is the acquisition cutover gate: review the single-provider/no-mixing rule before continuing.
4. Task 4 must prove preview-backed runs make zero new source calls.
5. Task 5 must pass both locales before E2E snapshots are updated.
6. Task 6 is the delivery gate; do not run the real smoke without `RUN_SOCIALCRAWL_SMOKE=1` because each forced refresh may consume provider credits.

## Operator Inputs and Defaults

- Already supplied: a SocialCrawl account/key exists. The value disclosed in chat must be rotated before implementation use.
- No additional product input is required for page configuration: the plan reuses the existing Settings modal, saves locally, applies immediately, never echoes the Key, and provides an explicit clear action.
- Defaulted without further input: US storefront, English request language, newest-first sort, 500-review cap, forced refresh on every manual check, Apple RSS fallback, local stable cache retained.
- Required before real smoke or production use: rotate the exposed key, then save the replacement through Settings → Data collection platform or place it directly in local `.env.local` as `SOCIALCRAWL_API_KEY=...`; ensure it has at least the credits required for one App Store review call.
- Optional policy decision: if forced refresh on every recheck is too costly, change the product requirement before Task 3; otherwise this plan deliberately prioritizes freshness over free SocialCrawl cache hits.
