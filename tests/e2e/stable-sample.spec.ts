import { test, expect } from "@playwright/test";
import { getUpstreamState, setSocialCrawlMode, resetCounters } from "./upstream-server";

// A live preview first merges its collected reviews into the isolated cache,
// so the stable sample card is usable in the very same response. Clicking
// "Analyze local history" must carry the stable selection and surface the
// local-history provenance without depending on another E2E file running
// first.
test("stable sample analysis uses the live-merged cache and reports local history", async ({ page }) => {
  setSocialCrawlMode("live");
  resetCounters();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App Review Planner/i })).toBeVisible();

  // Check the review sample: the live result is merged into the cache, making
  // the stable card available in the same response.
  await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /Check review sample/i }).click();
  expect((await previewPromise).status()).toBe(200);

  // The stable sample card shows local-history wording and becomes actionable.
  await expect(page.getByText(/2 local-history reviews/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyze local history/i })).toBeEnabled();

  // Analyze the stable sample.
  const postPromise = page.waitForResponse("**/api/runs");
  await page.getByRole("button", { name: /Analyze local history/i }).click();
  expect((await postPromise).status()).toBe(200);

  // Wait for the run to complete.
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });

  // Header badge shows the local-history source, never the fresh-fetch label.
  await expect(page.getByText(/SocialCrawl \/ US App Store · Local history/i)).toBeVisible();

  // Overview limitation reports LOCAL_HISTORY_SELECTED (scoped to the Overview
  // panel; the event log JSON also carries it).
  await page.getByRole("button", { name: /Overview/i }).click();
  const overviewLimitation = page.getByText(/LOCAL_HISTORY_SELECTED/i).first();
  await expect(overviewLimitation).toBeVisible({ timeout: 10_000 });

  // The stable selection re-uses the frozen preview: no second SocialCrawl call.
  expect(getUpstreamState().socialCrawlRequests).toBe(1);

  // Traceability passes.
  await page.getByRole("button", { name: /Traceability/i }).click();
  await expect(page.getByText(/Completed/)).toBeVisible();
});

test("falls back to Apple RSS when SocialCrawl is out of credits", async ({ page }) => {
  // The stub serves a 402 INSUFFICIENT_CREDITS envelope; the preview must fall
  // back to RSS and label the live card as such, never as SocialCrawl fresh data.
  resetCounters();
  setSocialCrawlMode("fallback");
  await page.goto("/");
  await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /Check review sample/i }).click();
  expect((await previewPromise).status()).toBe(200);

  // One SocialCrawl attempt happened, then RSS produced the sample.
  await expect(page.getByText(/Apple RSS fallback/i).first()).toBeVisible();
  await expect(page.getByText(/SocialCrawl · fresh fetch/i)).toHaveCount(0);

  const state = getUpstreamState();
  expect(state.socialCrawlRequests).toBe(1);
  // RSS may paginate (page 1 + empty page 2) so at least one request happened;
  // the important assertion is that RSS was actually used for the fallback.
  expect(state.rssRequests).toBeGreaterThanOrEqual(1);
});
