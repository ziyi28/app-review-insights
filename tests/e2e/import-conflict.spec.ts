import { test, expect } from "@playwright/test";
import { waitForRunComplete } from "./wizard";

const CSV = [
  "id,title,body,rating,version,updatedAt,language",
  "imp-1,Great,Love the workout variety,5,3.2.1,2026-07-01T10:00:00Z,en",
  "imp-2,太贵,订阅费太贵了，很多功能都要付费,1,3.2.0,2026-07-02T10:00:00Z,zh",
  "imp-1,Changed my mind,Too expensive now,1,3.2.0,2026-07-03T10:00:00Z,en",
].join("\n");

test("imports a mixed-language CSV with duplicates and identity conflicts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /App 评论分析台/ })).toBeVisible();
  const newRunBtn = page.getByRole("button", { name: /新建运行|新建分析|New Run/ });
  if (await newRunBtn.isVisible()) {
    await newRunBtn.click();
  }

  // Switch to import mode (the UI already defaults to Chinese).
  await page.getByRole("radio", { name: /导入/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();

  // Upload the CSV via a file chooser.
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByLabel(/导入 JSON 或 CSV/).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "reviews.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });

  await page.getByLabel(/分析目标/).fill("理解用户为什么会流失以及如何改进订阅转化");
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /开始分析/ }).click();

  // Analysis completes and shows the imported source.
  await waitForRunComplete(page);

  // Cleaned data tab shows identity-conflict handling.
  await page.getByRole("tab", { name: /清洗数据/ }).click();
  await expect(page.getByText(/Too expensive now/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/订阅费太贵了/)).toBeVisible();
});
