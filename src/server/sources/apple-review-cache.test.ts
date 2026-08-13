import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import { AppleReviewCacheStore, CACHE_MAX_REVIEWS } from "./apple-review-cache";
import { RunStore } from "@/server/runs/run-store";

let root: string;
let store: AppleReviewCacheStore;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "review-cache-"));
  store = new AppleReviewCacheStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function raw(id: string, updatedAt: string | null, body = `body ${id}`): RawReview {
  return { sourceReviewId: id, source: "apple-rss", title: `t ${id}`, body, rating: 5, version: "1.0", updatedAt };
}

async function seedRun(runsDir: string, runId: string, opts: { appId: string; status: string; reviews: NormalizedReview[]; createdAt: string }) {
  const rs = new RunStore(runsDir);
  const runDir = rs.resolveRunDir(runId);
  await import("node:fs").then((fs) => fs.promises.mkdir(path.join(runDir, "artifacts"), { recursive: true }));
  await rs.writeArtifact(runId, "source-evidence", 1, {
    kind: "apple-rss",
    appId: opts.appId,
    status: opts.status,
    pages: 1,
    reviewCount: opts.reviews.length,
  });
  await rs.writeArtifact(runId, "cleaned-reviews", 1, {
    reviews: opts.reviews,
    stats: { rawCount: opts.reviews.length, includedCount: opts.reviews.length, duplicateCount: 0, identityConflictCount: 0 },
    limitations: [],
    warnings: [],
  });
  await rs.writeManifest(runId, {
    runId,
    status: "completed",
    executionMode: "live",
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
    stages: {},
    artifacts: { "source-evidence": { attempt: 1, file: "artifacts/source-evidence.attempt-01.json" } },
    limitations: [],
    canReplay: true,
  });
}

function normalized(id: string, updatedAt: string | null): NormalizedReview {
  return {
    reviewId: `review-${id}`,
    sourceReviewId: id,
    source: "apple-rss",
    titleOriginal: `t ${id}`,
    bodyOriginal: `body ${id}`,
    bodyNormalized: `body ${id}`,
    rating: 5,
    version: "1.0",
    updatedAt,
    language: "en",
    rawRef: `sources/apple/page-01.json#entry-0`,
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
  };
}

describe("AppleReviewCacheStore", () => {
  it("merges live reviews and dedupes by sourceReviewId with most-recent-wins", async () => {
    await store.mergeLive("us", "839285684", [raw("a", "2026-08-01T00:00:00Z"), raw("b", "2026-08-02T00:00:00Z")]);
    const cache = await store.mergeLive("us", "839285684", [raw("a", "2026-08-03T00:00:00Z")]);
    expect(cache.reviews).toHaveLength(2);
    const a = cache.reviews.find((r) => r.sourceReviewId === "a");
    expect(a?.updatedAt).toBe("2026-08-03T00:00:00Z");
  });

  it("sorts by updatedAt descending with undated reviews last", async () => {
    await store.mergeLive("us", "839285684", [
      raw("old", "2026-07-01T00:00:00Z"),
      raw("undated", null),
      raw("new", "2026-08-01T00:00:00Z"),
    ]);
    const cache = await store.readCache("us", "839285684");
    expect(cache?.reviews.map((r) => r.sourceReviewId)).toEqual(["new", "old", "undated"]);
  });

  it("caps at 500 reviews", async () => {
    const many = Array.from({ length: 600 }, (_, i) => raw(`id-${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`));
    const cache = await store.mergeLive("us", "839285684", many);
    expect(cache.reviews).toHaveLength(CACHE_MAX_REVIEWS);
  });

  it("never clears the cache on an empty live merge", async () => {
    await store.mergeLive("us", "839285684", [raw("a", "2026-08-01T00:00:00Z")]);
    const cache = await store.mergeLive("us", "839285684", []);
    expect(cache.reviews).toHaveLength(1);
  });

  it("bootstraps from history preferring the run with the most reviews", async () => {
    const runsDir = mkdtempSync(path.join(tmpdir(), "review-cache-runs-"));
    try {
      await seedRun(runsDir, "run-few", { appId: "839285684", status: "complete", reviews: [normalized("a", "2026-08-01T00:00:00Z")], createdAt: "2026-08-02T00:00:00.000Z" });
      await seedRun(runsDir, "run-many", { appId: "839285684", status: "complete", reviews: [normalized("a", "2026-08-01T00:00:00Z"), normalized("b", "2026-08-02T00:00:00Z")], createdAt: "2026-08-01T00:00:00.000Z" });

      const cache = await store.bootstrapFromHistory("us", "839285684", { roots: [runsDir], runsDir });
      expect(cache).not.toBeNull();
      expect(cache?.bootstrapRunId).toBe("run-many");
      expect(cache?.reviews).toHaveLength(2);
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it("bootstraps from a completed SocialCrawl run and still accepts legacy RSS runs", async () => {
    const runsDir = mkdtempSync(path.join(tmpdir(), "review-cache-runs-"));
    try {
      await seedRun(runsDir, "run-social", { appId: "839285684", status: "complete", reviews: [normalized("s1", "2026-08-12T00:00:00Z")], createdAt: "2026-08-12T00:00:00.000Z" });
      await seedRun(runsDir, "run-rss", { appId: "839285684", status: "complete", reviews: [normalized("r1", "2026-08-01T00:00:00Z")], createdAt: "2026-08-01T00:00:00.000Z" });
      // The SocialCrawl run records a provider-aware source summary.
      const rs = new RunStore(runsDir);
      await rs.writeArtifact("run-social", "source-evidence", 1, {
        kind: "app-store-reviews",
        provider: "socialcrawl",
        appId: "839285684",
        status: "complete",
        reviewCount: 1,
      });

      const cache = await store.bootstrapFromHistory("us", "839285684", { roots: [runsDir], runsDir });
      expect(cache).not.toBeNull();
      expect(cache?.bootstrapRunId).toBe("run-social");
      expect(cache?.reviews).toHaveLength(1);
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it("skips runs whose source status is not complete", async () => {
    const runsDir = mkdtempSync(path.join(tmpdir(), "review-cache-runs-"));
    try {
      await seedRun(runsDir, "run-partial", { appId: "839285684", status: "partial", reviews: [normalized("a", "2026-08-01T00:00:00Z")], createdAt: "2026-08-02T00:00:00.000Z" });
      const cache = await store.bootstrapFromHistory("us", "839285684", { roots: [runsDir], runsDir });
      expect(cache).toBeNull();
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it("converts normalized reviews back to raw losslessly", async () => {
    const runsDir = mkdtempSync(path.join(tmpdir(), "review-cache-runs-"));
    try {
      await seedRun(runsDir, "run-ok", {
        appId: "839285684",
        status: "complete",
        reviews: [normalized("a", "2026-08-01T00:00:00Z")],
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      const cache = await store.bootstrapFromHistory("us", "839285684", { roots: [runsDir], runsDir });
      expect(cache?.reviews[0]).toEqual(raw("a", "2026-08-01T00:00:00Z"));
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});
