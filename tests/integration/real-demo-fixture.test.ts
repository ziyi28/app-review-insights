import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadReplayRun } from "@/server/runs/replay";

const FIXTURE = path.join(process.cwd(), "fixtures", "demo-runs", "run-workout-for-women-us");
const FIXTURE_ROOT = path.join(process.cwd(), "fixtures", "demo-runs");

describe("real demo fixture", () => {
  it("ships a real US storefront replay with complete provenance", () => {
    const provenance = JSON.parse(readFileSync(path.join(FIXTURE, "provenance.json"), "utf8")) as {
      provenance: { reviewData: string; storefront: string; appId: string; privacyMinimization: string };
      analysis: { modelName: string; temperature: number; promptVersions: string[] };
    };
    expect(provenance.provenance.reviewData).toBe("apple-rss-real");
    expect(provenance.provenance.storefront).toBe("us");
    expect(provenance.provenance.appId).toBe("839285684");
    expect(provenance.analysis.modelName.length).toBeGreaterThan(0);
    expect(provenance.analysis.promptVersions).toContain("findings@1");
  });

  it("has replayable artifacts with valid traceability", () => {
    const manifest = JSON.parse(readFileSync(path.join(FIXTURE, "manifest.json"), "utf8")) as {
      status: string;
      canReplay: boolean;
    };
    expect(manifest.status).toBe("completed");
    expect(manifest.canReplay).toBe(true);
    expect(existsSync(path.join(FIXTURE, "events.ndjson"))).toBe(true);

    const finalReport = JSON.parse(
      readFileSync(path.join(FIXTURE, "artifacts", "final-report.attempt-01.json"), "utf8"),
    ) as { prd: { findings: unknown[]; requirements: unknown[]; tests: unknown[] }; report: { valid: boolean } };
    expect(finalReport.report.valid).toBe(true);
    expect(finalReport.prd.findings.length).toBeGreaterThan(0);
    expect(finalReport.prd.requirements.length).toBeGreaterThan(0);
    expect(finalReport.prd.tests.length).toBeGreaterThan(0);
  });

  it("replays fully offline via loadReplayRun", async () => {
    const bundle = await loadReplayRun([FIXTURE_ROOT], "run-workout-for-women-us");
    expect(bundle.manifest.status).toBe("completed");
    expect(bundle.events.length).toBeGreaterThan(0);
    expect(bundle.artifacts["final-report"]).toBeDefined();
  });

  it("snapshot is privacy-minimized", () => {
    const snapshot = JSON.parse(
      readFileSync(path.join(FIXTURE, "sources", "apple", "snapshot.json"), "utf8"),
    ) as { reviews: Record<string, unknown>[] };
    const forbidden = ["nickname", "author", "uri", "email"];
    for (const r of snapshot.reviews) {
      for (const key of Object.keys(r)) {
        expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
      }
    }
  });
});
