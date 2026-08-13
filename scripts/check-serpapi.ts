/**
 * One-page paid canary for SerpApi Apple Reviews collection.
 *
 * Usage: npm run canary:serpapi
 *
 * Reads SERPAPI_API_KEY from the environment or the git-ignored `.env.local`,
 * calls collectSerpApiReviews with maxPages=1 (at most ONE paid search), and
 * prints only sanitized evidence. It never prints the API key, full request
 * URL, review title/body, or any raw provider error text.
 *
 * Without a key it prints `SERPAPI_API_KEY is not configured` and exits
 * non-zero WITHOUT making any network request.
 */
import { readFileSync } from "node:fs";
import { collectSerpApiReviews } from "../src/server/sources/serpapi-collector";

type CanaryOutput = {
  ok: boolean;
  provider: "serpapi";
  appId: "839285684";
  status: "complete" | "suspect-empty" | "partial" | "failed";
  reviewCount: number;
  requestCount: number;
  searchId: string | null;
  httpStatus: number | null;
  latestReviewAt: string | null;
  limitationCodes: string[];
};

function localEnvValue(name: string): string | undefined {
  if (!readFileExists(".env.local")) return undefined;
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  const raw = line.slice(line.indexOf("=") + 1).trim();
  return raw.startsWith('"') && raw.endsWith('"')
    ? raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : raw;
}

function readFileExists(p: string): boolean {
  try {
    readFileSync(p, "utf8");
    return true;
  } catch {
    return false;
  }
}

const APP_ID = "839285684";

const key = process.env.SERPAPI_API_KEY?.trim() || localEnvValue("SERPAPI_API_KEY")?.trim();
if (!key) {
  console.error("SERPAPI_API_KEY is not configured");
  process.exit(1);
}

const result = await collectSerpApiReviews({
  fetchFn: fetch,
  now: () => new Date().toISOString(),
  baseUrl: "https://serpapi.com",
  apiKey: key,
  appId: APP_ID,
  timeoutMs: 90_000,
  maxPages: 1,
});

const latestReviewAt = result.reviews
  .map((r) => r.updatedAt)
  .filter((d): d is string => d !== null)
  .sort()
  .at(-1) ?? null;

const output: CanaryOutput = {
  ok: result.status === "complete" && result.reviews.length > 0 && result.evidence.httpStatus === 200 && (result.evidence.searchIds.at(-1) ?? null) !== null,
  provider: "serpapi",
  appId: APP_ID,
  status: result.status,
  reviewCount: result.reviews.length,
  requestCount: result.evidence.requestCount,
  searchId: result.evidence.searchIds.at(-1) ?? null,
  httpStatus: result.evidence.httpStatus,
  latestReviewAt,
  limitationCodes: result.limitations.map((l) => l.code),
};

// Only sanitized evidence — never the key, the URL, or review bodies.
for (const [k, v] of Object.entries(output)) {
  console.log(`${k}=${typeof v === "boolean" ? String(v) : v ?? ""}`);
}

if (!output.ok) {
  console.error("Canary failed: SerpApi did not return a complete page of reviews.");
  process.exit(1);
}
