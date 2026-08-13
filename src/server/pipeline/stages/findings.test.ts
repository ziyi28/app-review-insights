import { describe, it, expect, vi } from "vitest";
import type { NormalizedReview } from "@/domain/contracts/review";
import { runFindingsStage, type FindingsStageContext } from "./findings";

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

const topics = [
  {
    id: "topic-1",
    label: "Pricing",
    description: "Users complain about cost",
    candidateIds: ["topic-candidate-1"],
    reviewIds: ["r1", "r2"],
  },
];

const FINDINGS_RESPONSE = {
  findings: [
    {
      id: "finding-1",
      topicIds: ["topic-1"],
      title: "Subscription too expensive",
      summary: "Users say the paid plan costs too much",
      supportingReviewIds: ["r1", "r2"],
      evidenceExcerpts: [
        { reviewId: "r1", excerpt: "price is too expensive" },
        { reviewId: "r2", excerpt: "price too high" },
      ],
      conflictingReviewIds: [],
      uncertainties: [],
      limitations: [],
    },
  ],
};

type FindingsResponse = {
  findings: {
    id: string;
    topicIds: string[];
    title: string;
    summary: string;
    supportingReviewIds: string[];
    evidenceExcerpts: { reviewId: string; excerpt: string }[];
    conflictingReviewIds: string[];
    uncertainties: string[];
    limitations: string[];
  }[];
};

function context(overrides: Partial<FindingsStageContext> = {}, findingsResponse: FindingsResponse = FINDINGS_RESPONSE): FindingsStageContext {
  const generate = vi.fn(async () => findingsResponse);
  return {
    model: { generate } as never,
    reviews,
    topics,
    outputLocale: "en",
    goal: "Understand pricing complaints",
    sourceStatus: "complete" as const,
    ...overrides,
  };
}

describe("runFindingsStage", () => {
  it("produces findings with code-derived sample count and confidence", async () => {
    const result = await runFindingsStage(context());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].supportingSampleCount).toBe(2);
    expect(result.findings[0].confidence.level).toBe("low");
    // 2 supporting reviews in a 3-review corpus clears the ratio floor but not
    // the absolute minimum, so the deterministic sufficiency assessment is
    // still insufficient.
    expect(result.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(result.findings[0].evidenceSufficiency.supportRatio).toBeCloseTo(2 / 3);
  });

  it("marks a finding insufficient on a large corpus with only two supporting reviews", async () => {
    // 3000-review corpus, only 2 legitimately supported excerpts -> the
    // finding survives as a limited fact but its evidence is insufficient for
    // a broad/critical claim.
    const corpus = Array.from({ length: 3000 }, (_, i) =>
      i < 2 ? review(`r${i}`, `timer resets on restart`) : review(`r${i}`, `review body number ${i}`),
    );
    const ctx = context(
      { reviews: corpus },
      {
        findings: [
          {
            id: "finding-1",
            topicIds: ["topic-1"],
            title: "x",
            summary: "y",
            supportingReviewIds: ["r0", "r1"],
            evidenceExcerpts: [
              { reviewId: "r0", excerpt: "timer resets on restart" },
              { reviewId: "r1", excerpt: "timer resets on restart" },
            ],
            conflictingReviewIds: [],
            uncertainties: [],
            limitations: [],
          },
        ],
      },
    );
    const result = await runFindingsStage(ctx);
    expect(result.findings[0].supportingSampleCount).toBe(2);
    expect(result.findings[0].confidence.level).toBe("low");
    expect(result.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(result.findings[0].evidenceSufficiency.corpusReviewCount).toBe(3000);
    expect(result.findings[0].evidenceSufficiency.supportRatio).toBeCloseTo(2 / 3000);
    expect(result.insufficientEvidence).toBe(true);
  });

  it("reports insufficientEvidence when every finding is insufficient", async () => {
    const ctx = context(
      {},
      {
        findings: [
          {
            id: "finding-1",
            topicIds: ["topic-1"],
            title: "x",
            summary: "y",
            // corpus is 3 reviews, both supporting reviews exist but with a
            // 2-support vs 3000-corpus... here corpus is 3 so 2/3 > 1%.
            supportingReviewIds: ["r1"],
            evidenceExcerpts: [{ reviewId: "r1", excerpt: "price is too expensive" }],
            conflictingReviewIds: ["r2", "r3"],
            uncertainties: [],
            limitations: [],
          },
        ],
      },
    );
    const result = await runFindingsStage(ctx);
    // 1 support vs 2 conflicts -> CONFLICT_NOT_MINOR, so insufficient.
    expect(result.findings[0].evidenceSufficiency.status).toBe("insufficient");
    expect(result.insufficientEvidence).toBe(true);
  });

  it("drops a finding whose cited review does not exist", async () => {
    const ctx = context(
      {},
      {
        findings: [
          {
            id: "finding-1",
            topicIds: ["topic-1"],
            title: "x",
            summary: "y",
            supportingReviewIds: ["ghost"],
            evidenceExcerpts: [{ reviewId: "ghost", excerpt: "whatever" }],
            conflictingReviewIds: [],
            uncertainties: [],
            limitations: [],
          },
        ],
      },
    );
    const result = await runFindingsStage(ctx);
    expect(result.findings).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_FINDING")).toBe(true);
  });

  it("keeps conflicting evidence separate", async () => {
    const ctx = context(
      {},
      {
        findings: [
          {
            id: "finding-1",
            topicIds: ["topic-1"],
            title: "x",
            summary: "y",
            supportingReviewIds: ["r1"],
            evidenceExcerpts: [{ reviewId: "r1", excerpt: "price is too expensive" }],
            conflictingReviewIds: ["r3"],
            uncertainties: [],
            limitations: [],
          },
        ],
      },
    );
    const result = await runFindingsStage(ctx);
    expect(result.findings[0].conflictingReviewIds).toEqual(["r3"]);
  });

  it("returns insufficient evidence status when no supported findings survive", async () => {
    const ctx = context({}, { findings: [] });
    const result = await runFindingsStage(ctx);
    expect(result.findings).toHaveLength(0);
    expect(result.insufficientEvidence).toBe(true);
  });

  it("drops a support review that lacks an exact excerpt instead of inflating the sample", async () => {
    const ctx = context(
      {},
      {
        findings: [
          {
            id: "finding-1",
            topicIds: ["topic-1"],
            title: "x",
            summary: "y",
            // r1 has an excerpt; r2 is cited but has NO excerpt.
            supportingReviewIds: ["r1", "r2"],
            evidenceExcerpts: [{ reviewId: "r1", excerpt: "price is too expensive" }],
            conflictingReviewIds: [],
            uncertainties: [],
            limitations: [],
          },
        ],
      },
    );
    const result = await runFindingsStage(ctx);
    // r2 must be removed from support and sample count; only r1 survives.
    // The finding itself stays (it still has valid support), so the sample is
    // not inflated by a review that has no exact excerpt.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].supportingReviewIds).toEqual(["r1"]);
    expect(result.findings[0].supportingSampleCount).toBe(1);
    expect(result.findings[0].confidence.level).toBe("low");
  });

  it("splits a large review set into bounded chunks without losing or duplicating reviews", async () => {
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const seenReviewIds: string[] = [];
    const generate = vi.fn(async (request: { user?: string }) => {
      const parsed = JSON.parse(request.user as string) as { reviews: { reviewId: string; sourceReviewId: string; rating: number; bodyNormalized: string }[] };
      for (const r of parsed.reviews) {
        seenReviewIds.push(r.reviewId);
        // The model only sees a slim copy of each review.
        expect(Object.keys(r).sort()).toEqual(["bodyNormalized", "rating", "reviewId", "sourceReviewId"]);
      }
      return { findings: [] };
    });
    const ctx = context({ reviews: many, model: { generate } as never });
    await runFindingsStage(ctx);
    // Every review is fed exactly once across chunks, in order — none dropped.
    expect(seenReviewIds).toEqual(many.map((r) => r.reviewId));
  });

  it("truncates oversized chunk output to 4 findings deterministically", async () => {
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const generate = vi.fn(async () => ({
      findings: Array.from({ length: 10 }, (_, i) => ({
        id: `finding-${i + 1}`,
        topicIds: ["topic-1"],
        title: "x",
        summary: "y",
        supportingReviewIds: ["r0"],
        evidenceExcerpts: [{ reviewId: "r0", excerpt: "review number 0" }],
        conflictingReviewIds: [],
        uncertainties: [],
        limitations: [],
      })),
    }));
    const ctx = context({ reviews: many, model: { generate } as never });
    const result = await runFindingsStage(ctx);
    // Each of the N chunks returns 10 raw findings but only 4 survive per chunk.
    expect(result.findings.length).toBeLessThanOrEqual(generate.mock.calls.length * 4);
    expect(result.warnings.some((w) => w.code === "FINDINGS_TRUNCATED")).toBe(true);
  });

  it("caps the global finding count at 20", async () => {
    // 8 chunks × 4 per-chunk cap = 32 → global cap of 20.
    const many = Array.from({ length: 120 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const generate = vi.fn(async () => ({
      findings: Array.from({ length: 10 }, (_, i) => ({
        id: `finding-${i + 1}`,
        topicIds: ["topic-1"],
        title: "x",
        summary: "y",
        supportingReviewIds: ["r0"],
        evidenceExcerpts: [{ reviewId: "r0", excerpt: "review number 0" }],
        conflictingReviewIds: [],
        uncertainties: [],
        limitations: [],
      })),
    }));
    const ctx = context({ reviews: many, model: { generate } as never });
    const result = await runFindingsStage(ctx);
    expect(result.findings.length).toBe(20);
    expect(result.warnings.some((w) => w.code === "FINDINGS_TRUNCATED")).toBe(true);
  });

  it("namespaces per-chunk finding ids and merges them without collision", async () => {
    const many = Array.from({ length: 30 }, (_, i) => review(`r${i}`, "x".repeat(490) + ` review number ${i}`));
    const generate = vi.fn(async (request: { user?: string }) => {
      const parsed = JSON.parse(request.user as string) as { reviews: { reviewId: string }[] };
      return {
        findings: [
          {
            id: "finding-1",
            topicIds: ["topic-1"],
            title: "x",
            summary: "y",
            supportingReviewIds: [parsed.reviews[0].reviewId],
            evidenceExcerpts: [{ reviewId: parsed.reviews[0].reviewId, excerpt: "x".repeat(10) }],
            conflictingReviewIds: [],
            uncertainties: [],
            limitations: [],
          },
        ],
      };
    });
    const ctx = context({ reviews: many, model: { generate } as never });
    const result = await runFindingsStage(ctx);
    // One chunk per bounded batch; each returns `finding-1` which must be
    // namespaced so the merged findings stay distinct.
    expect(generate).toHaveBeenCalledTimes(result.findings.length);
    expect(result.findings.length).toBeGreaterThan(1);
    const ids = result.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^finding-1@c\d+$/.test(id))).toBe(true);
    // Merged findings still carry code-derived sample counts.
    expect(result.findings.every((f) => f.supportingSampleCount === 1)).toBe(true);
  });
});
