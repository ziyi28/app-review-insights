import { describe, it, expect, vi } from "vitest";
import { runRevisionStage, type RevisionStageContext } from "./revision";
import { RevisionOutputSchema } from "@/server/model/prompts/prompts";

const current = {
  findings: [{ id: "finding-1", supportingReviewIds: ["r1", "r2"] }],
  requirements: [{ id: "req-1", findingIds: ["finding-1"], sourceReviewIds: ["r1", "r2"] }],
  tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["r1"] }],
  assumptions: [],
};

const frozenLedger = {
  findings: { "finding-1": ["r1", "r2"], "finding-2": ["r9"] },
  requirements: { "req-1": ["r1", "r2"], "req-2": ["r9"] },
};

function context(overrides: Partial<RevisionStageContext> = {}): RevisionStageContext {
  const generate = vi.fn(async () => ({
    findings: current.findings,
    requirements: current.requirements,
    tests: current.tests,
    assumptions: [],
    note: "fixed",
  }));
  return {
    model: { generate } as never,
    violations: [{ code: "REVIEW_NOT_FOUND", message: "x", entity: "finding-1" }],
    allowedReviewIds: ["r1", "r2", "r9"],
    frozenLedger,
    current,
    outputLocale: "en",
    ...overrides,
  };
}

describe("runRevisionStage", () => {
  it("produces a revised bundle that preserves valid structure", async () => {
    const result = await runRevisionStage(context());
    expect(result.findings).toHaveLength(1);
    expect(result.note.length).toBeGreaterThan(0);
  });

  it("rejects a revision that adds a new citation pair", async () => {
    const ctx = context();
    (ctx.model.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      findings: [{ id: "finding-1", title: "Pricing", supportingReviewIds: ["r9"] }],
      requirements: [],
      tests: [],
      assumptions: [],
      note: "added r9",
    });
    await expect(runRevisionStage(ctx)).rejects.toThrow(/NEW_CITATION/);
  });

  it("rejects a requirement citing a review outside the frozen ledger", async () => {
    const ctx = context();
    (ctx.model.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      findings: [],
      requirements: [{ id: "req-1", findingIds: ["finding-1"], title: "x", sourceReviewIds: ["r9"] }],
      tests: [],
      assumptions: [],
      note: "bad req",
    });
    await expect(runRevisionStage(ctx)).rejects.toThrow(/NEW_CITATION/);
  });

  it("rejects moving a citation between entities (stealing another finding's review)", async () => {
    const ctx = context();
    (ctx.model.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      // finding-1 takes r9, which is only in finding-2's frozen evidence.
      findings: [{ id: "finding-1", supportingReviewIds: ["r1", "r9"] }],
      requirements: [],
      tests: [],
      assumptions: [],
      note: "moved r9",
    });
    await expect(runRevisionStage(ctx)).rejects.toThrow(/NEW_CITATION_NOT_ALLOWED/);
  });

  it("rejects an excerpt whose review is not in the entity's frozen citation pair", async () => {
    const ctx = context();
    (ctx.model.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      // finding-1 cites r1 (allowed) but adds an excerpt for r9, which is only
      // in finding-2's frozen evidence -> a new excerpt, rejected.
      findings: [{ id: "finding-1", supportingReviewIds: ["r1"], evidenceExcerpts: [{ reviewId: "r9", excerpt: "stolen quote" }] }],
      requirements: [],
      tests: [],
      assumptions: [],
      note: "added excerpt",
    });
    await expect(runRevisionStage(ctx)).rejects.toThrow(/NEW_EXCERPT/);
  });

  it("allows a valid revision that removes a citation pair", async () => {
    const ctx = context();
    (ctx.model.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      findings: [{ id: "finding-1", supportingReviewIds: ["r1"], evidenceExcerpts: [{ reviewId: "r1", excerpt: "existing quote" }] }],
      requirements: [{ id: "req-1", sourceReviewIds: ["r1"] }],
      tests: [{ id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["r1"] }],
      assumptions: [],
      note: "removed r2",
    });
    const result = await runRevisionStage(ctx);
    expect(result.note).toBe("removed r2");
  });
});

describe("RevisionOutputSchema (malformed model output)", () => {
  it("rejects an entity without an id so it fails as MODEL_SCHEMA_VIOLATION, not downstream", () => {
    const parsed = RevisionOutputSchema.safeParse({
      findings: [{ title: "no id", supportingReviewIds: ["r1"] }],
      requirements: [],
      tests: [],
      assumptions: [],
      note: "x",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a blank id and a wrong-shaped citation list", () => {
    expect(RevisionOutputSchema.safeParse({
      findings: [{ id: "   ", supportingReviewIds: ["r1"] }],
      requirements: [], tests: [], assumptions: [], note: "",
    }).success).toBe(false);
    expect(RevisionOutputSchema.safeParse({
      findings: [{ id: "finding-1", supportingReviewIds: "r1" }],
      requirements: [], tests: [], assumptions: [], note: "",
    }).success).toBe(false);
  });

  it("accepts well-formed entities and keeps unknown semantic fields via passthrough", () => {
    const parsed = RevisionOutputSchema.safeParse({
      findings: [{ id: "finding-1", title: "Pricing", severity: "high", supportingReviewIds: ["r1"] }],
      requirements: [{ id: "req-1", findingIds: ["finding-1"], planningFactors: { severity: "high" } }],
      tests: [{ id: "test-1", requirementIds: ["req-1"], steps: ["s1"] }],
      assumptions: [{ id: "asm-1", text: "t", basis: "b" }],
      note: "ok",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.findings[0]).toMatchObject({ id: "finding-1", severity: "high" });
      expect(parsed.data.requirements[0]).toMatchObject({ planningFactors: { severity: "high" } });
    }
  });

  it("defaults missing arrays and note like the previous permissive schema", () => {
    const parsed = RevisionOutputSchema.parse({ findings: [{ id: "finding-1" }] });
    expect(parsed.requirements).toEqual([]);
    expect(parsed.tests).toEqual([]);
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.note).toBe("");
  });
});
