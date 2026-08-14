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

  // Sanity: model must be configured for the live path.
  const cfg = await page.request.get("/api/config");
  const cfgJson = (await cfg.json()) as { modelConfigured: boolean; modelBaseUrl: string | null };
  expect(cfgJson.modelConfigured).toBe(true);

  // Walk the wizard: live mode, example URL, goal, confirm. Entering confirm
  // auto-checks the sample; the SerpApi live card shows 2 fresh reviews and the
  // forced-fresh label (never presented as cached).
  await page.getByRole("radio", { name: /实时采集/ }).click();
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
  expect((await postPromise).status()).toBe(200);

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

  // Version Plan tab renders the per-requirement decision (small sample -> no
  // target release), without fabricating a version.
  await page.getByRole("tab", { name: /版本计划/ }).click();
  await expect(page.getByText("req-1", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Traceability passes.
  await page.getByRole("tab", { name: /追溯/ }).click();
  await expect(page.locator("#panel-traceability").getByText(/0 错误/)).toBeVisible({ timeout: 10_000 });

  // Test Cases tab shows the direct Requirement -> Finding -> Review -> Priority
  // chain; P2 is the end-to-end evidence of the small-sample guardrail.
  await page.getByRole("tab", { name: /测试用例/ }).click();
  // "req-1" also appears inside the Overview warning text, so scope the chain
  // assertions to the Test Case card body (the 需求:… · 发现:… row).
  const chainRow = page.getByText(/需求:\s*req-1/i);
  await expect(chainRow).toBeVisible({ timeout: 10_000 });
  await expect(chainRow).toContainText(/finding-1/i);
  // The downstream ledger uses the stable review id, so assert the Review ID
  // prefix appears in the row (the exact hash is a runtime value).
  await expect(chainRow).toContainText(/评论 ID:/i);
  // The guardrail pins the small-sample requirement to P2 (shown as a badge);
  // both test cards carry it, so `.first()` is fine.
  await expect(page.getByText(/优先级:\s*P2/i).first()).toBeVisible();

  // Final Deliverables tab shows counts, traceability status and model usage.
  await page.getByRole("tab", { name: /最终交付物/ }).click();
  await expect(page.getByText(/测试用例/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/追溯/i).first()).toBeVisible();

  // The run must not re-collect: exactly one SerpApi request (the preview)
  // happened, and the provenance badge reflects the SerpApi source.
  const state = getUpstreamState();
  expect(state.serpApiRequests).toBe(1);
  await expect(page.getByText(/SerpApi \/ 美国区 App Store/)).toBeVisible();
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
