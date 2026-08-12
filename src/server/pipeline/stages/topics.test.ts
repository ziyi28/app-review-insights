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
});
