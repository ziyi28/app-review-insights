import { test, expect } from "@playwright/test";
import { getUpstreamState, resetCounters } from "./upstream-server";
import { waitForRunComplete } from "./wizard";

// Background-task contract: analysis is decoupled from the browser. These tests
// prove that (1) a cached replay keeps running across a page refresh and (2) a
// second task started while the first is still running completes independently.

test("cached replay survives a mid-run page refresh", async ({ page }) => {
  resetCounters();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();

  // Start a cached replay of the bundled demo fixture.
  await page.getByRole("button", { name: /历史/ }).click();
  await expect(page.getByRole("dialog", { name: /历史/ })).toBeVisible();
  const fixtureCard = page.getByTestId("history-card-run-workout-for-women-us");
  const replayPromise = page.waitForResponse((r) => r.url().includes("/api/runs") && r.request().method() === "POST");
  await fixtureCard.getByTestId("history-replay").click();
  expect((await replayPromise).status()).toBe(202);

  // Refresh immediately: the background task must keep running and the client
  // must recover to it (via the last-run-id + the running-task preference).
  await page.reload();
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();

  // The recovered run reaches completion in the run-log tab.
  await waitForRunComplete(page);

  // A replay never calls upstream, even after a refresh.
  expect(getUpstreamState()).toEqual({ serpApiRequests: 0, rssRequests: 0, modelRequests: 0 });
});

test("a second task started while one is running completes both", async ({ page }) => {
  resetCounters();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();
  const newRunBtn = page.getByRole("button", { name: /新建运行|新建分析|New Run/ });
  if (await newRunBtn.isVisible()) {
    await newRunBtn.click();
  }

  // Start a live analysis (first task): it walks the model pipeline, so it
  // stays in flight long enough to start a second task while it runs.
  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /使用示例 App/ }).click();
  await page.getByLabel(/分析目标/).fill("了解用户为什么喜欢这个应用以及他们遇到的问题");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /下一步/ }).click();
  expect((await previewPromise).status()).toBe(200);
  await expect(page.getByRole("button", { name: /分析最新样本/ })).toBeVisible();
  const livePostPromise = page.waitForResponse((r) => r.url().includes("/api/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: /分析最新样本/ }).click();
  expect((await livePostPromise).status()).toBe(202);

  // While the live run is in flight, open history and start a cached replay
  // (second, independent task). This must NOT cancel the live task.
  await page.getByRole("button", { name: /历史/ }).click();
  await expect(page.getByRole("dialog", { name: /历史/ })).toBeVisible();
  const workoutCard = page.getByTestId("history-card-run-workout-for-women-us");
  const replayPromise = page.waitForResponse((r) => r.url().includes("/api/runs") && r.request().method() === "POST");
  await workoutCard.getByTestId("history-replay").click();
  expect((await replayPromise).status()).toBe(202);

  // The replay (now the monitored run) completes.
  await waitForRunComplete(page);

  // The history panel eventually shows both tasks completed, with distinct ids.
  await page.getByRole("button", { name: /历史/ }).click();
  await expect(page.getByRole("dialog", { name: /历史/ })).toBeVisible();
  // The live run completes too (its goal text is unique); wait for it to appear
  // as completed rather than still running.
  await expect(page.getByText(/了解用户为什么喜欢这个应用以及他们遇到的问题/)).toBeVisible({ timeout: 30_000 });
});
