import type { Page } from "@playwright/test";

/**
 * Shared helpers for driving the three-step "new run" wizard in E2E tests.
 * The UI defaults to Chinese; helpers use Chinese labels unless a test has
 * explicitly switched the interface language first.
 */

/** Start a live run: choose source → fill URL+goal → confirm → pick a sample. */
export async function startLiveRun(page: Page, goal: string, selection: "fresh" | "history" = "fresh") {
  const newRunBtn = page.getByRole("button", { name: /新建运行|新建分析|New Run/ });
  if (await newRunBtn.isVisible()) {
    await newRunBtn.click();
  }
  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /下一步|Next/ }).click();
  await page.getByRole("button", { name: /使用示例 App|Use sample App/ }).click();
  await page.getByLabel(/分析目标|Analysis goal/).fill(goal);
  await page.getByRole("button", { name: /下一步|Next/ }).click();
  const button = selection === "fresh" ? /分析最新样本|Analyze fresh sample/ : /分析本地历史样本|Analyze local-history sample/;
  await page.getByRole("button", { name: button }).click();
}

/** Open the run-log tab and wait for the run to complete. */
export async function waitForRunComplete(page: Page, timeout = 30_000) {
  await page.getByRole("tab", { name: /运行日志/ }).click();
  // The run-log panel also renders an event-type filter whose <option>s include
  // "run.completed"; match the visible table cell (<code>) instead of the hidden
  // option so the wait resolves on the actual event row.
  await page.locator("tbody code", { hasText: "run.completed" }).first().waitFor({ state: "visible", timeout });
}

/** Switch the UI to English (for scenarios asserting English copy). */
export async function switchToEnglish(page: Page) {
  await page.getByRole("combobox", { name: /界面语言/ }).selectOption("en");
}
