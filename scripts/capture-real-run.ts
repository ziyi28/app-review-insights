/**
 * Captures a real US storefront Apple RSS review snapshot for the demo app.
 *
 * Usage: npm run sample:capture
 *
 * This script:
 *  - Uses the same loadConfig / collectAppleReviews as the live pipeline so the
 *    capture honors the documented rate limits (max pages, >=500ms delay) and
 *    suspect-empty semantics.
 *  - Saves raw pages + parsed reviews under data/runs/<runId>/sources/apple/.
 *  - Does NOT invoke the model (offline capture). Model-driven analysis of a
 *    captured snapshot is a separate, model-configured step.
 *
 * Data caveats (per the design spec):
 *  - RSS has no public SLA; empty pages can occur at any position and must not
 *    be treated as "no reviews".
 *  - This is a best-effort window (up to 10x50 entries), not the full history.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadConfig } from "../src/server/config";
import { collectAppleReviews } from "../src/server/sources/apple-rss-collector";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function captureRealRun(): Promise<string> {
  const cfg = loadConfig();
  const appId = process.env.APP_ID ?? "839285684";
  const runId = `run-${randomUUID()}`;
  const outDir = path.join(process.cwd(), "data", "runs", runId, "sources", "apple");
  await mkdir(outDir, { recursive: true });

  const result = await collectAppleReviews({
    fetchFn: fetch,
    sleep,
    now: () => new Date().toISOString(),
    baseUrl: cfg.appleRssBaseUrl,
    appId,
    maxPages: cfg.appleRssMaxPages,
    pageDelayMs: cfg.appleRssPageDelayMs,
    timeoutMs: cfg.appleRssTimeoutMs,
  });

  const pages = result.pages.map((p) => ({
    page: p.page,
    url: p.url,
    status: p.httpStatus,
    byteLength: p.byteLength,
    sha256: p.sha256,
    reviewCount: p.reviewCount,
    capturedAt: p.finishedAt,
  }));
  const reviews = result.reviews.map((r) => ({
    sourceReviewId: r.sourceReviewId,
    rating: r.rating,
    title: r.title,
    body: r.body,
    version: r.version,
    updatedAt: r.updatedAt,
  }));

  const snapshot = {
    schemaVersion: "1",
    app: { id: appId, storefront: "us" },
    source: "apple-rss",
    capturedAt: new Date().toISOString(),
    status: result.status,
    limitations: result.limitations,
    pages,
    reviews,
  };

  await writeFile(path.join(outDir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf8");
  await writeFile(
    path.join(process.cwd(), "data", "runs", runId, "manifest.json"),
    JSON.stringify(
      {
        runId,
        status: "captured",
        executionMode: "live",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stages: { source: { status: "completed" } },
        artifacts: {},
        limitations: result.limitations,
        canReplay: false,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Captured ${reviews.length} reviews across ${pages.length} pages (${result.status}) -> ${runId}`);
  for (const l of result.limitations) console.log(`  limitation: ${l.code} - ${l.message}`);
  return runId;
}

// Run when invoked directly.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || import.meta.url.endsWith("/scripts/capture-real-run.ts")) {
  captureRealRun().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
