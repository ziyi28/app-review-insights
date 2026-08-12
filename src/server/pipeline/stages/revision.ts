import { revisionPrompt, RevisionOutputSchema } from "@/server/model/prompts/prompts";
import type { Violation } from "@/domain/traceability/validate";
import type { StageModelClient } from "../dependencies";

export type CitationLedger = {
  findings: Record<string, string[]>;
  requirements: Record<string, string[]>;
};

/** entityId -> reviewId pairs implied by a ledger, keyed "entityId:reviewId". */
export type CitationPairs = { findings: Map<string, Set<string>>; requirements: Map<string, Set<string>> };

function pairsFrom(ledger: CitationLedger, kind: "findings" | "requirements"): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [entityId, reviewIds] of Object.entries(ledger[kind])) {
    m.set(entityId, new Set(reviewIds));
  }
  return m;
}

export type RevisionStageContext = {
  model: StageModelClient;
  violations: Violation[];
  allowedReviewIds: string[];
  frozenLedger: CitationLedger;
  current: {
    findings: unknown[];
    requirements: unknown[];
    tests: unknown[];
    assumptions: unknown[];
  };
  outputLocale: "en" | "zh-CN";
};

export type RevisionStageResult = {
  findings: unknown[];
  requirements: unknown[];
  tests: unknown[];
  assumptions: unknown[];
  note: string;
};

function extractReviewIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v) => {
      if (typeof v === "string") return [v];
      return extractReviewIds(v);
    });
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: string[] = [];
    if ("supportingReviewIds" in obj) out.push(...extractReviewIds(obj.supportingReviewIds));
    if ("sourceReviewIds" in obj) out.push(...extractReviewIds(obj.sourceReviewIds));
    return out;
  }
  return [];
}

function entityIdOf(value: unknown): string | null {
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/** entityId -> reviewId pairs implied by a current bundle entity list. */
function pairsOf(entities: unknown[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of entities) {
    const id = entityIdOf(e);
    if (!id) continue;
    const set = m.get(id) ?? new Set<string>();
    for (const rid of extractReviewIds(e)) set.add(rid);
    m.set(id, set);
  }
  return m;
}

/** Builds the "entityId:reviewId" pair set implied by the current bundle. */
function currentLedger(current: RevisionStageContext["current"]): Set<string> {
  const pairs = new Set<string>();
  for (const [id, rids] of pairsOf(current.findings)) for (const r of rids) pairs.add(`finding:${id}:${r}`);
  for (const [id, rids] of pairsOf(current.requirements)) for (const r of rids) pairs.add(`req:${id}:${r}`);
  return pairs;
}

function frozenPairs(ctx: RevisionStageContext): CitationPairs {
  return { findings: pairsFrom(ctx.frozenLedger, "findings"), requirements: pairsFrom(ctx.frozenLedger, "requirements") };
}

/**
 * A revision may only reuse the exact citation pairs that already exist for
 * the SAME entity id in the frozen ledger. Moving a review between entities is
 * a new citation pair and is rejected.
 */
function allowedPair(kind: "finding" | "req", entityId: string, reviewId: string, ctx: RevisionStageContext): boolean {
  if (!ctx.allowedReviewIds.includes(reviewId)) return false;
  const frozen = frozenPairs(ctx)[kind === "finding" ? "findings" : "requirements"];
  return frozen.get(entityId)?.has(reviewId) ?? false;
}

/**
 * One-shot, evidence-constrained revision. The model may delete unsupported
 * entities, fix links to existing allowed ids, downgrade to assumptions, or
 * clarify limitations — but it may NEVER introduce a new citation pair. Any
 * new pair throws NEW_CITATION_NOT_ALLOWED, terminating rather than inventing
 * evidence.
 */
export async function runRevisionStage(ctx: RevisionStageContext): Promise<RevisionStageResult> {
  const before = currentLedger(ctx.current);

  const output = await ctx.model.generate({
    stage: "revision",
    promptVersion: revisionPrompt.version,
    system: revisionPrompt.system,
    user: revisionPrompt.buildUser({
      violations: ctx.violations,
      allowedReviewIds: ctx.allowedReviewIds,
      frozenLedger: ctx.frozenLedger,
      current: ctx.current,
      outputLocale: ctx.outputLocale,
    }),
    schema: RevisionOutputSchema,
  });

  const after = new Set<string>();
  const frozen = frozenPairs(ctx);

  // Findings and requirements must keep their exact existing citation pairs,
  // keyed by entity id. A review moving from one entity to another is a new
  // citation pair and is rejected.
  for (const f of output.findings) {
    const fid = entityIdOf(f);
    for (const id of extractReviewIds(f)) {
      after.add(`finding:${fid}:${id}`);
      if (!fid || !allowedPair("finding", fid, id, ctx)) {
        throw new Error(`NEW_CITATION_NOT_ALLOWED: finding ${fid} cites ${id}`);
      }
    }
  }
  for (const r of output.requirements) {
    const rid = entityIdOf(r);
    for (const id of extractReviewIds(r)) {
      after.add(`req:${rid}:${id}`);
      if (!rid || !allowedPair("req", rid, id, ctx)) {
        throw new Error(`NEW_CITATION_NOT_ALLOWED: requirement ${rid} cites ${id}`);
      }
    }
  }

  // Tests may be added to close coverage gaps, but every review they cite must
  // already be part of some requirement's frozen evidence (no new review
  // sources), and a test may not cite more reviews than exist in the union of
  // its requirements' frozen evidence.
  const backingEvidence = new Set<string>();
  for (const reqRids of frozen.requirements.values()) for (const r of reqRids) backingEvidence.add(r);
  for (const t of output.tests) {
    const testIds = t && typeof t === "object" ? extractReviewIds(t) : [];
    for (const id of testIds) {
      if (!backingEvidence.has(id)) {
        throw new Error(`NEW_CITATION_NOT_ALLOWED: test cites review ${id} outside requirement evidence`);
      }
    }
  }

  // A revision must not invent a new evidence excerpt for an already-cited
  // review: excerpts are the primary grounding artifact and may only be
  // removed or left unchanged.
  for (const f of output.findings) {
    if (!f || typeof f !== "object") continue;
    const excerpts = (f as { evidenceExcerpts?: unknown[] }).evidenceExcerpts ?? [];
    const fid = entityIdOf(f);
    const frozenExcerpts = fid ? frozen.findings.get(fid) : undefined;
    for (const e of excerpts) {
      const reviewId = e && typeof e === "object" ? (e as { reviewId?: unknown }).reviewId : undefined;
      if (typeof reviewId === "string" && !frozenExcerpts?.has(reviewId)) {
        throw new Error(`NEW_EXCERPT_NOT_ALLOWED: finding ${fid} adds excerpt for review ${reviewId}`);
      }
    }
  }

  for (const pair of after) {
    if (!before.has(pair)) {
      throw new Error(`NEW_CITATION_NOT_ALLOWED: ${pair} not in initial ledger`);
    }
  }

  return {
    findings: output.findings,
    requirements: output.requirements,
    tests: output.tests,
    assumptions: output.assumptions,
    note: output.note,
  };
}
