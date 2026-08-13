import { test, expect } from "@playwright/test";
import { getUpstreamState, setSocialCrawlMode, resetCounters } from "./upstream-server";

test("live analysis runs preview-first and shows grounded artifacts", async ({ page }) => {
  // The stub mode and counters persist across runs in the temp dir; force the
  // SocialCrawl live envelope so this test is deterministic.
  setSocialCrawlMode("live");
  resetCounters();
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
  // The SocialCrawl live sample card shows 2 fresh reviews and the fresh-fetch
  // label (never presented as cached).
  await expect(page.getByText(/2 fresh reviews/i)).toBeVisible();
  await expect(page.getByText(/SocialCrawl · fresh fetch/i)).toBeVisible();

  // Analyze the fresh sample: POST /api/runs carries the preview selection.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /Analyze fresh sample/i }).click();
  expect((await postPromise).status()).toBe(200);

  // Wait for the run to complete in the event log.
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });

  // Findings tab shows generated findings and the sufficiency guardrail: with
  // a 2-review corpus both findings are insufficient, so they stay as limited
  // facts and their requirements are pinned to P2 with no target version.
  await page.getByRole("button", { name: /Findings/i }).click();
  await expect(page.getByText(/Loves variety/i)).toBeVisible({ timeout: 10_000 });

  // Classification tab shows the discovered candidates.
  await page.getByRole("button", { name: /Classification/i }).click();
  await expect(page.getByText(/Workout quality/i)).toBeVisible({ timeout: 10_000 });

  // Evidence Validation tab shows the audit counts.
  await page.getByRole("button", { name: /Evidence Validation/i }).click();
  await expect(page.getByText(/Insufficient Evidence/i).first()).toBeVisible({ timeout: 10_000 });

  // Version Plan tab renders the per-requirement decision (small sample -> no
  // target release), without fabricating a version.
  await page.getByRole("button", { name: /Version Plan/i }).click();
  await expect(page.getByText("req-1", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

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

  // Final Deliverables tab shows counts, traceability status and model usage.
  await page.getByRole("button", { name: /Final Deliverables/i }).click();
  await expect(page.getByText(/Test Cases/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Traceability/i).first()).toBeVisible();

  // The run must not re-collect: exactly one SocialCrawl request (the preview)
  // happened, and the provenance badge reflects the SocialCrawl source.
  const state = getUpstreamState();
  expect(state.socialCrawlRequests).toBe(1);
  await expect(page.getByText(/SocialCrawl \/ US App Store/i)).toBeVisible();
});

test("analyzes a forced-fresh SocialCrawl preview via the settings page", async ({ page }) => {
  setSocialCrawlMode("live");
  resetCounters();
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const socialCrawlKey = page.getByLabel("SocialCrawl API Key");
  await expect(socialCrawlKey).toHaveValue("");
  await socialCrawlKey.fill("sc_e2e_only");
  const configPostPromise = page.waitForResponse((r) => r.url().includes("/api/config") && r.request().method() === "POST", { timeout: 10_000 });
  await page.getByRole("button", { name: "Save" }).click();
  const configPost = await configPostPromise;
  expect(configPost.status()).toBe(200);
  await expect(socialCrawlKey).toHaveValue("", { timeout: 5_000 });
  await page.getByText("Close", { exact: true }).click();

  await page.getByLabel(/Analysis goal/i).fill("Understand recent workout usability complaints");
  await page.getByRole("button", { name: /Check review sample/i }).click();
  await expect(page.getByText(/SocialCrawl · fresh fetch/i)).toBeVisible();
  await expect(page.getByText(/2 fresh reviews/i)).toBeVisible();
  await page.getByRole("button", { name: /Analyze fresh sample/i }).click();
  await expect(page.getByText(/SocialCrawl \/ US App Store/i, { exact: true })).toBeVisible();
});
