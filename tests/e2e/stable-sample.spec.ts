import { test, expect } from "@playwright/test";
import { getUpstreamState, setSerpApiMode, resetCounters } from "./upstream-server";
import { waitForRunComplete } from "./wizard";

// A live preview first merges its collected reviews into the isolated cache,
// so the stable sample card is usable in the very same response. Clicking
// "Analyze local history" must carry the stable selection and surface the
// local-history provenance without depending on another E2E file running
// first.
test("stable sample analysis uses the live-merged cache and reports local history", async ({ page }) => {
  setSerpApiMode("live");
  resetCounters();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();

  // Walk the wizard: live mode, example URL, goal, confirm. The sample is
  // checked automatically; the live result is merged into the cache, making the
  // stable card available in the same response.
  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /使用示例 App/ }).click();
  await page.getByLabel(/分析目标/).fill("了解用户为什么喜欢这个应用以及他们遇到的问题");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /下一步/ }).click();
  expect((await previewPromise).status()).toBe(200);

  // The stable sample card shows local-history wording and becomes actionable.
  await expect(page.getByText(/2 条本地历史评论/)).toBeVisible();
  await expect(page.getByRole("button", { name: /分析本地历史样本/ })).toBeEnabled();

  // Analyze the stable sample.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /分析本地历史样本/ }).click();
  expect((await postPromise).status()).toBe(202);

  // Wait for the run to complete.
  await waitForRunComplete(page);

  // Header badge shows the local-history source, never the fresh-fetch label.
  await expect(page.getByText(/SerpApi \/ 美国区 App Store · 本地历史/i)).toBeVisible();

  // Overview limitation reports LOCAL_HISTORY_SELECTED (scoped to the Overview
  // panel; the run-log event list also carries it).
  await page.getByRole("tab", { name: /概览/ }).click();
  const overviewLimitation = page.getByText(/LOCAL_HISTORY_SELECTED/i).first();
  await expect(overviewLimitation).toBeVisible({ timeout: 10_000 });

  // The stable selection re-uses the frozen preview: no second SerpApi call.
  expect(getUpstreamState().serpApiRequests).toBe(1);

  // Traceability passes.
  await page.getByRole("tab", { name: /追溯/ }).click();
  await expect(page.locator("#panel-traceability").getByText(/0 错误/)).toBeVisible({ timeout: 10_000 });
});

test("falls back to Apple RSS when SerpApi is rate-limited", async ({ page }) => {
  // The stub serves a 429 quota envelope; the preview must fall back to RSS and
  // label the live card as such, never as SerpApi fresh data.
  resetCounters();
  setSerpApiMode("fallback");
  await page.goto("/");
  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /使用示例 App/ }).click();
  await page.getByLabel(/分析目标/).fill("了解用户为什么喜欢这个应用以及他们遇到的问题");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /下一步/ }).click();
  expect((await previewPromise).status()).toBe(200);

  // One SerpApi attempt happened, then RSS produced the sample.
  await expect(page.getByText(/Apple RSS 降级采集/).first()).toBeVisible();
  await expect(page.getByText(/SerpApi · 强制实时采集/)).toHaveCount(0);

  const state = getUpstreamState();
  expect(state.serpApiRequests).toBe(1);
  // RSS may paginate (page 1 + empty page 2) so at least one request happened;
  // the important assertion is that RSS was actually used for the fallback.
  expect(state.rssRequests).toBeGreaterThanOrEqual(1);
});
