import { test, expect } from "@playwright/test";
import { getUpstreamState, resetCounters } from "./upstream-server";

// Offline replay must work from the bundled fixture alone, with zero Apple RSS
// or model calls. It is deliberately decoupled from any live setup: no seeding
// run is needed, only the demo fixture shipped under fixtures/demo-runs.
test("cached replay of the bundled fixture never calls upstream", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Cached Replay/i }).click();
  await page
    .getByRole("combobox", { name: /Cached Replay/i })
    .selectOption("run-workout-for-women-us");
  // Zero both counters before replay: the replay that follows must not touch
  // Apple RSS or the model endpoint.
  resetCounters();

  await page.getByRole("button", { name: /^Start$/i }).click();
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Cached Replay/i).first()).toBeVisible();

  // Replay must not have hit Apple RSS or the model endpoint again.
  expect(getUpstreamState()).toEqual({ rssRequests: 0, modelRequests: 0 });

  // Final Deliverables tab shows counts and the legacy fallback: the bundled
  // fixture predates the P1 planning factors, so Version Plan reports it.
  await page.getByRole("button", { name: /Final Deliverables/i }).click();
  await expect(page.getByText(/Traceability/i).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Version Plan/i }).click();
  await expect(page.getByText(/Not available in this cached run/i).first()).toBeVisible({ timeout: 10_000 });
});
