import { test, expect } from "@playwright/test";

test("live analysis runs preview-first and shows grounded artifacts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App Review Planner/i })).toBeVisible();

  // Sanity: model must be configured for the live path.
  const cfg = await page.request.get("/api/config");
  const cfgJson = (await cfg.json()) as { modelConfigured: boolean; modelBaseUrl: string | null };
  expect(cfgJson.modelConfigured).toBe(true);

  // Default URL is prefilled with the US store URL; set a goal and check the
  // review sample before any run can start.
  await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /Check review sample/i }).click();
  expect((await previewPromise).status()).toBe(200);
  // The live sample card shows the review count from the isolated cache.
  await expect(page.getByText(/Live reviews:\s*2/i)).toBeVisible();

  // Analyze the live sample: POST /api/runs carries the preview selection.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /Analyze live sample/i }).click();
  expect((await postPromise).status()).toBe(200);

  // Wait for the run to complete in the event log.
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });

  // Findings tab shows generated findings and the sufficiency guardrail: with
  // a 2-review corpus both findings are insufficient, so they stay as limited
  // facts and their requirements are pinned to P2 with no target version.
  await page.getByRole("button", { name: /Findings/i }).click();
  await expect(page.getByText(/Loves variety/i)).toBeVisible({ timeout: 10_000 });

  // Traceability passes.
  await page.getByRole("button", { name: /Traceability/i }).click();
  await expect(page.getByText(/Completed/)).toBeVisible();

  // Test Cases tab shows the direct Requirement -> Finding -> Review -> Priority
  // chain; P2 is the end-to-end evidence of the small-sample guardrail.
  await page.getByRole("button", { name: /Test Cases/i }).click();
  // "req-1" also appears inside the Overview warning text, so scope the chain
  // assertions to the Test Case card body (the Requirement:… · Finding:… row).
  const chainRow = page.getByText(/Requirement:\s*req-1/i);
  await expect(chainRow).toBeVisible({ timeout: 10_000 });
  await expect(chainRow).toContainText(/finding-1/i);
  // The downstream ledger uses the stable review id, so assert the Review ID
  // prefix appears in the row (the exact hash is a runtime value).
  await expect(chainRow).toContainText(/Review ID:/i);
  // The guardrail pins the small-sample requirement to P2 (shown as a badge);
  // both test cards carry it, so `.first()` is fine.
  await expect(page.getByText(/Priority:\s*P2/i).first()).toBeVisible();
});
