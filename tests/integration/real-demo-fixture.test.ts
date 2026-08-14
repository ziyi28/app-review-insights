import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadReplayRun } from "@/server/runs/replay";

const FIXTURE_ROOT = path.join(process.cwd(), "fixtures", "demo-runs");

// Each shipped demo fixture: a real US-storefront capture of a different app,
// analyzed by a real model and bundled for offline replay. Two different app
// categories are intentionally shipped to demonstrate the pipeline is not
// hard-coded to any single app.
const FIXTURES = [
  { runId: "run-x-twitter-us", appId: "333903271", reviewData: "apple-rss-real" },
  { runId: "run-workout-for-women-us", appId: "839285684", reviewData: "serpapi-apple-reviews-real" },
];

describe("real demo fixtures", () => {
  for (const { runId, appId, reviewData } of FIXTURES) {
    const dir = path.join(FIXTURE_ROOT, runId);

    describe(runId, () => {
      it("ships a real US storefront replay with complete provenance", () => {
        const provenance = JSON.parse(readFileSync(path.join(dir, "provenance.json"), "utf8")) as {
          provenance: { reviewData: string; storefront: string; appId: string; privacyMinimization: string };
          analysis: { modelName: string; temperature: number; promptVersions: string[] };
        };
        expect(provenance.provenance.reviewData).toBe(reviewData);
        expect(provenance.provenance.storefront).toBe("us");
        expect(provenance.provenance.appId).toBe(appId);
        expect(provenance.analysis.modelName.length).toBeGreaterThan(0);
        expect(provenance.analysis.promptVersions.length).toBeGreaterThan(0);
      });

      it("has replayable artifacts with valid traceability", () => {
        const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
          status: string;
          canReplay: boolean;
        };
        expect(manifest.status).toBe("completed");
        expect(manifest.canReplay).toBe(true);
        expect(existsSync(path.join(dir, "events.ndjson"))).toBe(true);

        const finalReport = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "final-report.attempt-01.json"), "utf8"),
        ) as { prd: { findings: unknown[]; requirements: unknown[]; tests: unknown[] }; report: { valid: boolean } };
        expect(finalReport.report.valid).toBe(true);
        expect(finalReport.prd.findings.length).toBeGreaterThan(0);
        expect(finalReport.prd.requirements.length).toBeGreaterThan(0);
        expect(finalReport.prd.tests.length).toBeGreaterThan(0);
      });

      it("replays fully offline via loadReplayRun", async () => {
        const bundle = await loadReplayRun([FIXTURE_ROOT], runId);
        expect(bundle.manifest.status).toBe("completed");
        expect(bundle.events.length).toBeGreaterThan(0);
        expect(bundle.artifacts["final-report"]).toBeDefined();
      });

      it("review artifacts are privacy-minimized", () => {
        const rawReviews = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "raw-reviews.attempt-01.json"), "utf8"),
        ) as { reviews: Record<string, unknown>[] };
        const forbidden = ["nickname", "author", "uri", "email"];
        for (const r of rawReviews.reviews) {
          for (const key of Object.keys(r)) {
            expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
          }
        }
      });
    });
  }
});
