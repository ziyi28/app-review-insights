import { test, expect } from "@playwright/test";

test("live analysis completes the full workflow and shows grounded artifacts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App Review Planner/i })).toBeVisible();

  // Sanity: model must be configured for the live path.
  const cfg = await page.request.get("/api/config");
  const cfgJson = (await cfg.json()) as { modelConfigured: boolean; modelBaseUrl: string | null };
  expect(cfgJson.modelConfigured).toBe(true);

  // Default URL is prefilled with the US store URL; set a goal and start.
  await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
  const startButton = page.getByRole("button", { name: /Start/i });
  await expect(startButton).toBeEnabled();
  const postPromise = page.waitForResponse("**/api/runs");
  await startButton.click();
  const post = await postPromise;
  expect(post.status()).toBe(200);

  // Wait for the run to complete in the event log.
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });

  // Findings tab shows generated findings.
  await page.getByRole("button", { name: /Findings/i }).click();
  await expect(page.getByText(/Loves variety/i)).toBeVisible({ timeout: 10_000 });

  // Traceability passes.
  await page.getByRole("button", { name: /Traceability/i }).click();
  await expect(page.getByText(/Completed/)).toBeVisible();
});
