import { test, expect } from "@playwright/test";
import { getUpstreamState, setSerpApiMode, resetCounters } from "./upstream-server";
import { startLiveRun, waitForRunComplete } from "./wizard";

test("live analysis runs preview-first and shows grounded artifacts", async ({ page }) => {
  // The stub mode and counters persist across runs in the temp dir; force the
  // SerpApi live envelope so this test is deterministic.
  setSerpApiMode("live");
  resetCounters();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();
  const newRunBtn = page.getByRole("button", { name: /新建运行|新建分析|New Run/ });
  if (await newRunBtn.isVisible()) {
    await newRunBtn.click();
  }

  // Sanity: model must be configured for the live path.
  const cfg = await page.request.get("/api/config");
  const cfgJson = (await cfg.json()) as { modelConfigured: boolean; modelBaseUrl: string | null };
  expect(cfgJson.modelConfigured).toBe(true);

  // Walk the wizard: live mode, example URL, goal, confirm. Entering confirm
  // auto-checks the sample; the SerpApi live card shows 2 fresh reviews and the
  // forced-fresh label (never presented as cached).
  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /使用示例 App/ }).click();
  await page.getByLabel(/分析目标/).fill("了解用户为什么喜欢这个应用以及他们遇到的问题");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /下一步/ }).click();
  expect((await previewPromise).status()).toBe(200);
  await expect(page.getByText(/2 条最新采集评论/)).toBeVisible();
  await expect(page.getByText(/SerpApi · 强制实时采集/)).toBeVisible();

  // Analyze the fresh sample: POST /api/runs carries the preview selection.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /分析最新样本/ }).click();
  expect((await postPromise).status()).toBe(202);

  // Wait for the run to complete (run.completed lands in the run-log tab).
  await waitForRunComplete(page);

  // Findings tab shows generated findings and the sufficiency guardrail: with
  // a 2-review corpus both findings are insufficient, so they stay as limited
  // facts and their requirements are pinned to P2 with no target version.
  await page.getByRole("tab", { name: /发现/ }).click();
  await expect(page.getByText(/Loves variety/i)).toBeVisible({ timeout: 10_000 });

  // Classification tab shows the discovered candidates.
  await page.getByRole("tab", { name: /分类/ }).click();
  await expect(page.getByText(/Workout quality/i)).toBeVisible({ timeout: 10_000 });

  // Evidence Validation tab shows the audit counts.
  await page.getByRole("tab", { name: /证据验证/ }).click();
  await expect(page.getByText(/证据不足/).first()).toBeVisible({ timeout: 10_000 });

  // PRD tab shows the insufficiency guardrail: insufficient finding converted to assumption
  await page.getByRole("tab", { name: /PRD/ }).click();
  await expect(page.getByText(/Users praise workout variety/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/SUPPORT_BELOW_MINIMUM/i).first()).toBeVisible();

  // Traceability passes (structural validity is intact with 0 violations).
  await page.getByRole("tab", { name: /追溯/ }).click();
  await expect(page.locator("#panel-traceability").getByText(/0 错误/)).toBeVisible({ timeout: 10_000 });

  // Final Deliverables tab shows deliverables and traceability status.
  await page.getByRole("tab", { name: /最终交付物/ }).click();
  await expect(page.getByText(/追溯/i).first()).toBeVisible({ timeout: 10_000 });

  // The run must not re-collect: exactly one SerpApi request (the preview)
  // happened, and the provenance badge reflects the SerpApi source.
  const state = getUpstreamState();
  expect(state.serpApiRequests).toBe(1);
  await expect(page.getByText(/SerpApi \/ 美国区 App Store/)).toBeVisible();
});

test("selecting a review count sends it with the preview request and starts a live run", async ({ page }) => {
  setSerpApiMode("live");
  resetCounters();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();
  const newRunBtn = page.getByRole("button", { name: /新建运行|新建分析|New Run/ });
  if (await newRunBtn.isVisible()) {
    await newRunBtn.click();
  }

  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /使用示例 App/ }).click();

  // Default is 100; switch to 300 before checking the sample.
  await expect(page.getByLabel(/评论数量/)).toHaveValue("100");
  await page.getByLabel(/评论数量/).selectOption("300");

  await page.getByLabel(/分析目标/).fill("了解用户为什么喜欢这个应用以及他们遇到的问题");

  const previewReqPromise = page.waitForRequest((r) => r.url().includes("/api/source-previews") && r.method() === "POST");
  await page.getByRole("button", { name: /下一步/ }).click();
  const previewReq = await previewReqPromise;
  expect(previewReq.postDataJSON()).toMatchObject({ reviewLimit: 300 });

  await expect(page.getByText(/2 条最新采集评论/)).toBeVisible();

  // Starting from the preview must still work with the chosen count.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /分析最新样本/ }).click();
  expect((await postPromise).status()).toBe(202);

  await waitForRunComplete(page);
  await page.getByRole("tab", { name: /概览/ }).click();
});

test("analyzes a forced-fresh SerpApi preview via the settings page", async ({ page }) => {
  setSerpApiMode("live");
  resetCounters();
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const serpApiKey = page.getByLabel("SerpApi API Key");
  await expect(serpApiKey).toHaveValue("");
  await serpApiKey.fill("serp_e2e_only");
  const configPostPromise = page.waitForResponse((r) => r.url().includes("/api/config") && r.request().method() === "POST", { timeout: 10_000 });
  await page.getByRole("button", { name: "保存" }).click();
  const configPost = await configPostPromise;
  expect(configPost.status()).toBe(200);
  await expect(serpApiKey).toHaveValue("", { timeout: 5_000 });
  await page.getByText("关闭", { exact: true }).click();

  await startLiveRun(page, "理解最近的健身可用性问题");
  await expect(page.getByText(/SerpApi \/ 美国区 App Store/, { exact: true })).toBeVisible();
});
