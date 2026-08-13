import { describe, it, expect, vi } from "vitest";
import type { NormalizedReview } from "@/domain/contracts/review";
import { runTopicsStage, type TopicsStageContext } from "./topics";

function review(id: string, body: string): NormalizedReview {
  return {
    reviewId: id,
    sourceReviewId: id,
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: body,
    bodyNormalized: body.toLowerCase(),
    rating: 5,
    version: null,
    updatedAt: null,
    language: "en",
    rawRef: "raw:" + id,
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
  };
}

const reviews: NormalizedReview[] = [
  review("r1", "The price is too expensive for me"),
  review("r2", "Price too high, cannot afford"),
  review("r3", "Timer restarts randomly during rest"),
];

const DISCOVERY_RESPONSE = {
  topics: [
    {
      id: "topic-candidate-1",
      label: "Pricing",
      description: "Users complain about cost",
      supportingReviewIds: ["r1", "r2"],
      quote: "price is too expensive",
    },
  ],
};

const CONSOLIDATION_RESPONSE = {
  topics: [
    {
      id: "topic-1",
      label: "Pricing concerns",
      description: "Users complain about cost",
      // Discovery namespaces candidate ids per chunk (@c0); consolidation must
      // reference the namespaced id to match a validated candidate.
      candidateIds: ["topic-candidate-1@c0"],
    },
  ],
};

function context(overrides: Partial<TopicsStageContext> = {}, discoveryResponse = DISCOVERY_RESPONSE): TopicsStageContext {
  const generate = vi.fn(async (request: { promptVersion: string }) =>
    request.promptVersion === "topics.consolidation@1" ? CONSOLIDATION_RESPONSE : discoveryResponse,
  );
  return {
    model: { generate } as never,
    reviews,
    outputLocale: "en",
    goal: "Understand pricing complaints",
    sourceStatus: "complete" as const,
    ...overrides,
  };
}

describe("runTopicsStage", () => {
  it("runs discovery then consolidation and validates candidate excerpts", async () => {
    const result = await runTopicsStage(context());
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].id).toMatch(/^topic-/);
    expect(result.warnings).toHaveLength(0);
  });

  it("drops a candidate whose quote is not an exact excerpt", async () => {
    const ctx = context(
      {},
      {
        topics: [{ id: "topic-candidate-1", label: "x", description: "y", supportingReviewIds: ["r1"], quote: "never said" }],
      },
    );
    const result = await runTopicsStage(ctx);
    expect(result.topics).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "INVALID_TOPIC_EVIDENCE")).toBe(true);
  });

  it("consolidation can only reference validated candidates", async () => {
    const result = await runTopicsStage(context());
    // Candidate ids are namespaced per discovery chunk (@c0) to avoid
    // cross-chunk collisions; the consolidation references the original local
    // id, so it resolves only if it maps to a validated namespaced candidate.
    expect(result.topics[0].candidateIds).toEqual(["topic-candidate-1@c0"]);
  });

  it("chunks large review sets deterministically without losing reviews", async () => {
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, `review number ${i} body`));
    const discoveryForChunk = {
      topics: many.slice(0, 5).map((r, i) => ({
        id: `topic-candidate-${i + 1}`,
        label: "x",
        description: "y",
        supportingReviewIds: [r.reviewId],
        quote: `review number ${i}`,
      })),
    };
    const ctx = context({ reviews: many }, discoveryForChunk);
    const result = await runTopicsStage(ctx);
    expect(result.topics.length).toBeLessThanOrEqual(5);
  });

  it("reports live progress for each discovery batch", async () => {
    const onProgress = vi.fn();
    // 30 reviews with ~500-char bodies push the corpus past the 8k chunk
    // budget so discovery runs in 2 batches.
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const discoveryForChunk = {
      topics: many.slice(0, 5).map((r, i) => ({
        id: `topic-candidate-${i + 1}`,
        label: "x",
        description: "y",
        supportingReviewIds: [r.reviewId],
        quote: `review number ${i}`,
      })),
    };
    const ctx = context({ reviews: many, onProgress }, discoveryForChunk);
    await runTopicsStage(ctx);
    // A progress message is emitted before each discovery call, so the number
    // of batches and which batch is current are always visible.
    const msgs = onProgress.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes("1 of"))).toBe(true);
    expect(msgs.some((m) => m.includes("2 of"))).toBe(true);
    expect(msgs.some((m) => /\(\d+ reviews\)/.test(m))).toBe(true);
    expect(msgs.some((m) => m.includes("in parallel"))).toBe(true);
  });

  it("calls discovery once per chunk", async () => {
    // 30 reviews with ~500-char bodies split into 2 chunks; each chunk must
    // get its own discovery call regardless of parallel execution.
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const generate = vi.fn(async () => ({ topics: [] }));
    const ctx = context({ reviews: many, model: { generate } as never });
    await runTopicsStage(ctx);
    // No candidates -> consolidation is skipped, so exactly one call per chunk.
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("respects maxConcurrency when running discovery batches in parallel", async () => {
    // 60 reviews with ~500-char bodies split into 4 chunks.
    const many = Array.from({ length: 60 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    let active = 0;
    let maxActive = 0;
    const generate = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return { topics: [] };
    });
    const ctx = context({ reviews: many, maxConcurrency: 2, model: { generate } as never });
    await runTopicsStage(ctx);
    // Parallel execution actually overlaps discovery calls, but never more
    // than the configured limit at once.
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("splits a large candidate set into small consolidation calls", async () => {
    // A corpus large enough to produce many candidates across chunks: 30
    // reviews with ~500-char bodies → 2 chunks → 2 discovery calls, each
    // returning 10 candidates = 20 candidates > the 15-per-call budget.
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const discoveryForChunk = {
      topics: Array.from({ length: 10 }, (_, i) => ({
        id: `topic-candidate-${i + 1}`,
        label: `candidate ${i + 1}`,
        description: "d",
        supportingReviewIds: [many[0].reviewId],
        quote: "review number 0",
      })),
    };
    const fedCounts: number[] = [];
    const generate = vi.fn(async (request: { promptVersion: string; user?: unknown }) => {
      if (request.promptVersion === "topics.consolidation@1") {
        const parsed = JSON.parse(request.user as string) as { candidates: unknown[] };
        fedCounts.push(parsed.candidates.length);
        return { topics: [] };
      }
      return discoveryForChunk;
    });
    const ctx = context({ reviews: many, model: { generate } as never });
    const result = await runTopicsStage(ctx);
    // 20 candidates / 15 budget = 2 consolidation calls, each fed at most 15.
    expect(fedCounts).toHaveLength(2);
    expect(fedCounts[0]).toBe(15);
    expect(fedCounts[1]).toBe(5);
    expect(result.topics).toHaveLength(0); // groups returned no topics
  });

  it("merges topics with the same label across consolidation groups", async () => {
    // 30 reviews → 2 chunks → 20 candidates → 2 consolidation groups. Group 0
    // gets candidates @c0 (10) + @c1 (5); group 1 gets @c1 (5) + @c2 (10).
    // Both groups return a "Pricing" topic citing candidates they actually
    // hold; the code merge joins them into one topic.
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const discoveryForChunk = {
      topics: Array.from({ length: 10 }, (_, i) => ({
        id: `topic-candidate-${i + 1}`,
        label: `candidate ${i + 1}`,
        description: "d",
        supportingReviewIds: [many[0].reviewId],
        quote: "review number 0",
      })),
    };
    let consGroup = 0;
    const generate = vi.fn(async (request: { promptVersion: string }) => {
      if (request.promptVersion === "topics.consolidation@1") {
        const group = consGroup++;
        // Group 0 holds @c0 (10) + @c1 (5); group 1 holds @c1 (5) + @c2 (10).
        // Cite distinct candidates that each group actually owns.
        const ids = group === 0 ? ["topic-candidate-1@c0", "topic-candidate-2@c0"] : ["topic-candidate-6@c1", "topic-candidate-7@c1"];
        return {
          topics: [
            {
              id: "topic-1",
              label: "Pricing concerns",
              description: "users complain about cost",
              candidateIds: ids,
            },
          ],
        };
      }
      return discoveryForChunk;
    });
    const ctx = context({ reviews: many, model: { generate } as never });
    const result = await runTopicsStage(ctx);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].label).toBe("Pricing concerns");
    expect(result.topics[0].candidateIds).toEqual(["topic-candidate-1@c0", "topic-candidate-2@c0", "topic-candidate-6@c1", "topic-candidate-7@c1"]);
  });
});
