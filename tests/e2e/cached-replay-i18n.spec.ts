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

  // Open the history panel and replay the bundled demo fixture. Its goal text is
  // unique to the fixture, so we assert on it to confirm the demo is listed.
  await page.getByRole("button", { name: /历史/ }).click();
  await expect(page.getByRole("dialog", { name: /历史/ })).toBeVisible();
  await expect(page.getByText(/识别最新版本引入的回归问题/).first()).toBeVisible();

  // The demo run is replayable; click its Replay action. Scope the Replay click
  // to the row whose goal text identifies the X fixture, so a second bundled
  // fixture (a different app) does not make the click ambiguous.
  const xRow = page.locator(".card", { hasText: /识别最新版本引入的回归问题/ }).first();
  const replayPromise = page.waitForResponse((r) => r.url().includes("/api/runs") && r.request().method() === "POST");
  await xRow.getByRole("button", { name: /回放/ }).click();
  expect((await replayPromise).status()).toBe(200);

  await waitForRunComplete(page);

  // Replay must not have hit SerpApi, Apple RSS, or the model endpoint again.
  expect(getUpstreamState()).toEqual({ serpApiRequests: 0, rssRequests: 0, modelRequests: 0 });

  // The provenance badge labels the run as a cached replay.
  await expect(page.getByText(/缓存回放/i).first()).toBeVisible();

  // Findings and traceability are grounded artifacts, not a fabricated mock.
  await page.getByRole("tab", { name: /发现/ }).click();
  await expect(page.getByText(/回归/i).first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("tab", { name: /追溯/ }).click();
  // Traceability panel renders "已完成 — N 错误"; scope the assertion to the
  // traceability tabpanel so the stage rail's sr-only "已完成" labels don't
  // trip strict mode.
  await expect(page.locator("#panel-traceability").getByText(/0 错误/)).toBeVisible({ timeout: 10_000 });
});
