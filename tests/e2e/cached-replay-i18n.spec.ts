import { test, expect, type Page } from "@playwright/test";
import { getUpstreamState, resetCounters } from "./upstream-server";

test("cached replay is marked and never calls upstream", async ({ page }) => {
  // Seed a live run first so a replayable snapshot exists.
  await page.goto("/");
  await page.getByLabel(/Analysis goal/i).fill("Understand why users love the app and what problems they have");
  await page.getByRole("button", { name: /Start/i }).click();
  await expect(page.locator("footer").getByText(/run.completed/)).toBeVisible({ timeout: 20_000 });

  // Zero both counters after the live run: the replay that follows must not
  // touch Apple RSS or the model endpoint.
  resetCounters();

  // Replay the completed run through the API.
  const runId = await latestRunId(page);
  const response = await page.request.post("/api/runs", {
    data: { protocolVersion: "1", mode: "cached-replay", sourceRunId: runId },
  });
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("cached-replay");
  expect(body).toContain("run.completed");

  // Replay must not have hit Apple RSS or the model endpoint again.
  const after = getUpstreamState();
  expect(after.rssRequests).toBe(0);
  expect(after.modelRequests).toBe(0);
});

async function latestRunId(page: Page): Promise<string> {
  const res = await page.request.get("/api/runs");
  const json = (await res.json()) as { runs: { runId: string; canReplay: boolean }[] };
  const replayable = json.runs.filter((r) => r.canReplay);
  return replayable[0].runId;
}
