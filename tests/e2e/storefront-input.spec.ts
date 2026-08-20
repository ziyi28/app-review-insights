import { test, expect } from "@playwright/test";

// A China storefront App Store page must be accepted as input and resolved to
// the US storefront for review collection. This spec only drives the preview
// flow (no model pipeline): the collector URL the server builds is asserted in
// route unit tests; here we confirm the user-facing preview works and carries
// the canonical US URL.
test("China App Store page input previews against the US storefront", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();
  const newRunBtn = page.getByRole("button", { name: /新建运行|新建分析|New Run/ });
  if (await newRunBtn.isVisible()) {
    await newRunBtn.click();
  }

  await page.getByRole("radio", { name: /实时采集/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page
    .getByLabel(/App Store 链接/)
    .fill("https://apps.apple.com/cn/app/workout-for-women-home-gym/id839285684");
  await page.getByLabel(/分析目标/).fill("了解用户为什么喜欢这个应用");

  const previewPromise = page.waitForResponse("**/api/source-previews");
  await page.getByRole("button", { name: /下一步/ }).click();
  const preview = await previewPromise;
  expect(preview.status()).toBe(200);

  const previewJson = (await preview.json()) as { canonicalUrl?: string; live?: { reviewCount?: number } };
  expect(previewJson.canonicalUrl).toBe("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684");
  expect(previewJson.live?.reviewCount).toBe(2);

  // No invalid-storefront error surfaced in the UI.
  await expect(page.getByText(/US or China/i)).not.toBeVisible();
  // The live sample card shows the fresh-review count.
  await expect(page.getByText(/2 条最新采集评论/)).toBeVisible();
});
