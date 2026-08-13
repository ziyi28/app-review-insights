import { test, expect } from "@playwright/test";

// A live preview first merges its collected reviews into the isolated cache,
// so the stable sample card is usable in the very same response. Clicking
// "Analyze stable sample" must carry the stable selection and surface the
// cache-augmented provenance without depending on another E2E file running
// first.
test("stable sample analysis uses the live-merged cache and reports Live + Cache", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App Review Planner/i })).toBeVisible();

  // Check the review sample: the live result is merged into the cache, making
  // the stable card available in the same response.
  await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /Check review sample/i }).click();
  expect((await previewPromise).status()).toBe(200);

  // The stable sample card becomes actionable.
  await expect(page.getByRole("button", { name: /Analyze stable sample/i })).toBeEnabled();

  // Analyze the stable sample.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /Analyze stable sample/i }).click();
  expect((await postPromise).status()).toBe(200);

  // Wait for the run to complete.
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });

  // Header badge shows the stable selection came from the live-merged cache.
  await expect(page.getByText(/Live \+ Cache/i)).toBeVisible();

  // Overview limitation reports RSS_CACHE_AUGMENTED (scoped to the Overview
  // panel; the event log JSON also carries it).
  await page.getByRole("button", { name: /Overview/i }).click();
  const overviewLimitation = page.getByText(/RSS_CACHE_AUGMENTED/i).first();
  await expect(overviewLimitation).toBeVisible({ timeout: 10_000 });

  // Traceability passes.
  await page.getByRole("button", { name: /Traceability/i }).click();
  await expect(page.getByText(/Completed/)).toBeVisible();
});
