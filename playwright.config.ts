import { defineConfig, devices } from "@playwright/test";

const port = 3123;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  globalSetup: "./tests/e2e/global-setup.ts",
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    locale: "en-US",
  },
  webServer: {
    command: `npm run build && npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      APPLE_RSS_BASE_URL: "http://127.0.0.1:39876/rss/customerreviews",
      MODEL_BASE_URL: "http://127.0.0.1:39876/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "e2e-model",
      RUNS_DIR: "./data/runs-e2e",
      SOURCE_CACHE_DIR: "./data/source-cache-e2e",
      SOURCE_PREVIEWS_DIR: "./data/source-previews-e2e",
      REPLAY_EVENT_DELAY_MS: "0",
      // Server-process-only test values: the SerpApi key is non-production
      // and must never equal the operator's real key. The isolated env file
      // keeps settings-page persistence out of the developer's .env.local.
      SERPAPI_API_KEY: "serp_e2e_only",
      SERPAPI_BASE_URL: "http://127.0.0.1:39876",
      ENV_LOCAL_FILE: "./data/config-e2e/.env.local",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
