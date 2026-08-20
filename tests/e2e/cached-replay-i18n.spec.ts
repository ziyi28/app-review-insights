import { test, expect } from "@playwright/test";
import { getUpstreamState, resetCounters } from "./upstream-server";
import { waitForRunComplete } from "./wizard";

// Offline replay must work from the bundled fixture alone, with zero Apple RSS
// or model calls. It is deliberately decoupled from any live setup: no seeding
// run is needed, only the demo fixture shipped under fixtures/demo-runs.
test("cached replay of the bundled fixture never calls upstream", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();

  // Zero both counters before replay: the replay that follows must not touch
  // Apple RSS, SerpApi, or the model endpoint.
  resetCounters();

  // Open the history panel and replay the bundled demo fixture.
  await page.getByRole("button", { name: /历史/ }).click();
  await expect(page.getByRole("dialog", { name: /历史/ })).toBeVisible();

  const fixtureCard = page.getByTestId("history-card-run-workout-for-women-us");
  await expect(fixtureCard).toBeVisible();

  const replayPromise = page.waitForResponse((r) => r.url().includes("/api/runs") && r.request().method() === "POST");
  await fixtureCard.getByTestId("history-replay").click();
  expect((await replayPromise).status()).toBe(202);

  await waitForRunComplete(page);

  // Replay must not have hit SerpApi, Apple RSS, or the model endpoint again.
  expect(getUpstreamState()).toEqual({ serpApiRequests: 0, rssRequests: 0, modelRequests: 0 });

  // The provenance badge labels the run as a cached replay.
  await expect(page.getByText(/缓存回放/i).first()).toBeVisible();

  // Traceability panel renders valid closure status
  await page.getByRole("tab", { name: /追溯/ }).click();
  await expect(page.locator("#panel-traceability").getByText(/0 错误/)).toBeVisible({ timeout: 10_000 });
});

test("read-only viewing of a bundled fixture makes no analysis or upstream calls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();
  resetCounters();

  // Watch for any write/analysis request the view path must never make.
  let previewPosts = 0;
  let runPosts = 0;
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (req.url().includes("/api/source-previews")) previewPosts += 1;
    if (req.url().includes("/api/runs")) runPosts += 1;
  });

  // Open history and click 查看 (view), NOT 回放 (replay).
  await page.getByRole("button", { name: /历史/ }).click();
  await expect(page.getByRole("dialog", { name: /历史/ })).toBeVisible();
  const fixtureCard = page.getByTestId("history-card-run-workout-for-women-us");
  await expect(fixtureCard).toBeVisible();
  await fixtureCard.getByTestId("history-view").click();

  // The view loads the fixture's persisted artifacts; every deliverable must be
  // present and rendered from real fixture content.

  // Overview and review count.
  const overview = page.locator("#panel-overview");
  await expect(overview.locator(".stat-card").filter({ hasText: /原始评论/ })).toBeVisible();

  // Raw reviews.
  await page.getByRole("tab", { name: "原始评论", exact: true }).click();
  await expect(page.locator("#panel-raw")).toBeVisible();

  // Traceability.
  await page.getByRole("tab", { name: "追溯", exact: true }).click();
  await expect(page.locator("#panel-traceability").getByText(/0 错误/)).toBeVisible();

  // No POST to source-previews or runs, and zero upstream traffic.
  expect(previewPosts).toBe(0);
  expect(runPosts).toBe(0);
  expect(getUpstreamState()).toEqual({ serpApiRequests: 0, rssRequests: 0, modelRequests: 0 });
});
