import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadReplayRun } from "@/server/runs/replay";
import { validateTraceability } from "@/domain/traceability/validate";
import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import type { Prd } from "@/domain/contracts/analysis";
import type { AppStoreReviewSourceSummary } from "@/server/pipeline/orchestrator";

const FIXTURE_ROOT = path.join(process.cwd(), "fixtures", "demo-runs");

const FIXTURES = [
  { runId: "run-workout-for-women-us", appId: "839285684" },
];

describe("real demo fixtures", () => {
  for (const { runId, appId } of FIXTURES) {
    const dir = path.join(FIXTURE_ROOT, runId);

    describe(runId, () => {
      it("contains exactly 300 reviews with verified source distribution and truthful provenance", () => {
        const rawArtifact = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "raw-reviews.attempt-01.json"), "utf8"),
        ) as { reviews: RawReview[]; rawRefs: string[] };
        const cleanedArtifact = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "cleaned-reviews.attempt-01.json"), "utf8"),
        ) as { reviews: NormalizedReview[] };
        const sourceEvidence = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "source-evidence.attempt-01.json"), "utf8"),
        ) as AppStoreReviewSourceSummary;
        const provenance = JSON.parse(
          readFileSync(path.join(dir, "provenance.json"), "utf8"),
        ) as {
          provenance: {
            reviewData: string;
            storefront: string;
            appId: string;
            privacyMinimization: string;
            cache?: {
              rawFile: string;
              byteLength: number;
              sha256: string;
              cacheUpdatedAt: string;
              bootstrapRunId: string | null;
              sourceCounts: Record<string, number>;
            };
          };
          analysis: { modelName: string; temperature: number; promptVersions: string[] };
        };

        expect(rawArtifact.reviews).toHaveLength(300);
        expect(cleanedArtifact.reviews).toHaveLength(300);
        expect(sourceEvidence.reviewCount).toBe(300);
        expect(provenance.provenance.storefront).toBe("us");
        expect(provenance.provenance.appId).toBe(appId);

        // Recompute source counts directly from raw reviews
        const computedCounts: Record<string, number> = {};
        for (const r of rawArtifact.reviews) {
          computedCounts[r.source] = (computedCounts[r.source] ?? 0) + 1;
        }

        if (sourceEvidence.provider === "cache") {
          expect(["local-cache-real", "local-cache-real-mixed"]).toContain(provenance.provenance.reviewData);
          expect(sourceEvidence.cache).toBeDefined();
          const cacheEvidence = sourceEvidence.cache!;

          const archivePath = path.join(dir, cacheEvidence.rawFile);
          expect(existsSync(archivePath)).toBe(true);
          const archiveContent = readFileSync(archivePath, "utf8");
          const byteLength = Buffer.byteLength(archiveContent, "utf8");
          const sha256 = createHash("sha256").update(archiveContent, "utf8").digest("hex");

          expect(cacheEvidence.byteLength).toBe(byteLength);
          expect(cacheEvidence.sha256).toBe(sha256);
          expect(cacheEvidence.sourceCounts).toEqual(computedCounts);
          expect(provenance.provenance.cache).toEqual(cacheEvidence);

          const parsedArchive = JSON.parse(archiveContent) as { reviews: RawReview[] };
          expect(parsedArchive.reviews).toEqual(rawArtifact.reviews);

          const expectedRawRefs = rawArtifact.reviews.map(
            (_, index) => `${cacheEvidence.rawFile}#/reviews/${index}`,
          );
          expect(rawArtifact.rawRefs).toHaveLength(300);
          expect(rawArtifact.rawRefs).toEqual(expectedRawRefs);
          expect(cleanedArtifact.reviews.map((review) => review.rawRef)).toEqual(expectedRawRefs);
        } else if (sourceEvidence.provider === "apple-rss") {
          expect(provenance.provenance.reviewData).toBe("apple-rss-real");
          expect(Object.keys(computedCounts)).toEqual(["apple-rss"]);
          for (const r of cleanedArtifact.reviews) {
            expect(r.source).toBe("apple-rss");
            expect(r.rawRef).toMatch(/^sources\/apple\//);
          }
        } else if (sourceEvidence.provider === "serpapi") {
          expect(provenance.provenance.reviewData).toBe("serpapi-apple-reviews-real");
          expect(Object.keys(computedCounts)).toEqual(["serpapi-apple-reviews"]);
          for (const r of cleanedArtifact.reviews) {
            expect(r.source).toBe("serpapi-apple-reviews");
          }
        }
      });

      it("pins cached source archives to LF line endings in Git", () => {
        const sourceEvidence = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "source-evidence.attempt-01.json"), "utf8"),
        ) as AppStoreReviewSourceSummary;
        const cacheEvidence = sourceEvidence.cache!;
        const archivePath = path.join(dir, cacheEvidence.rawFile);
        const gitArchivePath = path.relative(process.cwd(), archivePath).split(path.sep).join("/");
        const eolAttribute = execFileSync(
          "git",
          ["check-attr", "eol", "--", gitArchivePath],
          { cwd: process.cwd(), encoding: "utf8" },
        ).trim();

        expect(eolAttribute).toContain("eol: lf");
      });

      it("maintains consistent runId and event IDs across manifest and events.ndjson", () => {
        const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
          runId: string;
          status: string;
          canReplay: boolean;
        };
        expect(manifest.runId).toBe(runId);
        expect(manifest.status).toBe("completed");
        expect(manifest.canReplay).toBe(true);

        const eventsText = readFileSync(path.join(dir, "events.ndjson"), "utf8").trim();
        const events = eventsText.split("\n").filter(Boolean).map((l) => JSON.parse(l));
        expect(events.length).toBeGreaterThan(0);

        const seenEventIds = new Set<string>();
        for (const ev of events) {
          expect(ev.runId).toBe(runId);
          expect(ev.eventId).toBe(`${runId}-${ev.sequence}`);
          expect(seenEventIds.has(ev.eventId)).toBe(false);
          seenEventIds.add(ev.eventId);
        }
      });

      it("has replayable artifacts with valid traceability", () => {
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

        const sourceEvidence = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "source-evidence.attempt-01.json"), "utf8"),
        ) as AppStoreReviewSourceSummary;
        const cacheEvidence = sourceEvidence.cache!;
        const archivedFiles = (bundle.sourceFiles ?? []).filter(
          (file) => file.relativePath === cacheEvidence.rawFile,
        );
        expect(archivedFiles).toHaveLength(1);
        const archived = archivedFiles[0];
        expect(Buffer.byteLength(archived.content, "utf8")).toBe(cacheEvidence.byteLength);
        expect(createHash("sha256").update(archived.content, "utf8").digest("hex")).toBe(cacheEvidence.sha256);
      });

      it("is valid against the CURRENT traceability validator (re-derives from the corpus)", () => {
        const cleaned = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "cleaned-reviews.attempt-01.json"), "utf8"),
        ) as { reviews: NormalizedReview[] };
        const finalReport = JSON.parse(
          readFileSync(path.join(dir, "artifacts", "final-report.attempt-01.json"), "utf8"),
        ) as { prd: Prd; report: { valid: boolean } };
        expect(finalReport.report.valid).toBe(true);

        const reviewMap = new Map<string, NormalizedReview>();
        for (const r of cleaned.reviews) {
          reviewMap.set(r.reviewId, { ...r, contentGroupId: r.contentGroupId ?? "" });
          reviewMap.set(r.sourceReviewId, { ...r, contentGroupId: r.contentGroupId ?? "" });
        }
        const corpusReviewIds = cleaned.reviews.filter((r) => r.includedInAnalysis).map((r) => r.reviewId);
        const report = validateTraceability(finalReport.prd, corpusReviewIds, reviewMap);
        const codes = [...new Set(report.violations.map((v) => v.code))];
        expect({ valid: report.valid, violations: codes, total: report.violations.length }).toEqual(
          { valid: true, violations: [], total: 0 },
        );
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
