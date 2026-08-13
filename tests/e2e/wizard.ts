import type { Page } from "@playwright/test";

/**
 * Shared helpers for driving the three-step "new run" wizard in E2E tests.
 * The UI defaults to Chinese; helpers use Chinese labels unless a test has
 * explicitly switched the interface language first.
 */

/** Start a live run: choose source → fill URL+goal → confirm → pick a sample. */
export async function startLiveRun(page: Page, goal: string, selection: "fresh" | "history" = "fresh") {
  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /使用示例 App/ }).click();
  await page.getByLabel(/分析目标/).fill(goal);
  await page.getByRole("button", { name: /下一步/ }).click();
  const button = selection === "fresh" ? /分析最新样本/ : /分析本地历史样本/;
  await page.getByRole("button", { name: button }).click();
}

/** Open the run-log tab and wait for the run to complete. */
export async function waitForRunComplete(page: Page, timeout = 30_000) {
  await page.getByRole("tab", { name: /运行日志/ }).click();
  await page.getByText(/run.completed/).first().waitFor({ state: "visible", timeout });
}

/** Switch the UI to English (for scenarios asserting English copy). */
export async function switchToEnglish(page: Page) {
  await page.getByRole("combobox", { name: /界面语言/ }).selectOption("en");
}
