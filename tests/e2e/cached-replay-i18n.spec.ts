import { test, expect } from "@playwright/test";
import { getUpstreamState, resetCounters } from "./upstream-server";
import { waitForRunComplete } from "./wizard";

// Offline replay must work from the bundled fixture alone, with zero Apple RSS
// or model calls. It is deliberately decoupled from any live setup: no seeding
// run is needed, only the demo fixture shipped under fixtures/demo-runs.
test("cached replay of the bundled fixture never calls upstream", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: /缓存回放/ }).click();
  await page
    .getByRole("combobox", { name: /缓存回放/ })
    .selectOption("run-workout-for-women-us");
  // Zero both counters before replay: the replay that follows must not touch
  // Apple RSS or the model endpoint.
  resetCounters();

  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /^开始分析$/ }).click();
  await waitForRunComplete(page);
  await expect(page.getByText(/缓存回放/i).first()).toBeVisible();

  // Replay must not have hit SerpApi, Apple RSS, or the model endpoint again.
  expect(getUpstreamState()).toEqual({ serpApiRequests: 0, rssRequests: 0, modelRequests: 0 });

  // Final Deliverables tab shows counts and the legacy fallback: the bundled
  // fixture predates the P1 planning factors, so Version Plan reports it.
  await page.getByRole("tab", { name: /最终交付物/ }).click();
  await expect(page.getByText(/追溯/i).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: /版本计划/ }).click();
  await expect(page.getByText(/该缓存运行中不可用/i).first()).toBeVisible({ timeout: 10_000 });
});
