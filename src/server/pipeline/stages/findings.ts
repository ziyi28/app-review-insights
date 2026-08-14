import type { Finding } from "@/domain/contracts/analysis";
import type { NormalizedReview } from "@/domain/contracts/review";
import { isExactExcerpt } from "@/domain/analysis/evidence";
import { computeConfidence, type SourceStatus } from "@/domain/analysis/confidence";
import { assessEvidenceSufficiency } from "@/domain/analysis/sufficiency";
import {
  FindingConsolidationOutputSchema,
  FindingOutputSchema,
  findingsConsolidationPrompt,
  findingsPrompt,
  type FindingOutput,
} from "@/server/model/prompts/prompts";
import { chunkByBodyBudget, mapWithConcurrency } from "../batching";
import { modelProgressRelay, type StageModelClient } from "../dependencies";

export type FindingsStageContext = {
  model: StageModelClient;
  reviews: NormalizedReview[];
  topics: { id: string; label: string; description: string; candidateIds: string[]; reviewIds: string[]; focusAreaIds: string[] }[];
  outputLocale: string;
  goal: string;
  /** Structured goal dimensions from the scope stage. */
  focusAreas?: { id: string; label: string }[];
  sourceStatus: SourceStatus;
  /** Live progress callback; invoked with a human-readable message while the
   *  model call is in flight so the UI can show feedback. */
  onProgress?: (message: string) => void;
  /** Max findings calls issued in parallel (default 3). */
  maxConcurrency?: number;
};

export type FindingsStageResult = {
  findings: Finding[];
  warnings: { code: string; message: string }[];
  insufficientEvidence: boolean;
  /** Audit trail of the semantic consolidation step. */
  consolidationAudit?: {
    candidateCount: number;
    consolidatedCount: number;
    finalCount: number;
    groups: { findingId: string; sourceFindingIds: string[] }[];
    droppedCandidateIds: string[];
    addedForCoverage: string[];
  };
};

export type FindingNormalizeContext = Pick<FindingsStageContext, "reviews" | "topics" | "sourceStatus"> & {
  /** Allowed goal-dimension ids. When present, unknown focusAreaIds are stripped. */
  allowedFocusAreaIds?: Set<string>;
};

/**
 * No finding, or every surviving finding short of the evidentiary bar, means
 * the corpus cannot support a broad or critical conclusion. Shared by the
 * single-corpus normalizer and the chunked stage so the merged result never
 * re-derives the policy.
 */
function isInsufficientEvidence(findings: Finding[]): boolean {
  return findings.length === 0 || findings.every((f) => f.evidenceSufficiency.status === "insufficient");
}

/**
 * Normalizes raw model findings into protocol-valid findings. Every citation
 * and excerpt is validated; sample count and confidence are always derived
 * deterministically by code, never trusted from the model. Findings without
 * valid support, or whose supporting reviews lack an exact excerpt, are
 * dropped (unsupported conclusions never survive).
 */
export function normalizeFindings(output: FindingOutput, ctx: FindingNormalizeContext): FindingsStageResult {
  const warnings: { code: string; message: string }[] = [];
  // Model output may cite either the stable reviewId or the original source id.
  const reviewMap = new Map<string, NormalizedReview>();
  for (const r of ctx.reviews) {
    reviewMap.set(r.reviewId, r);
    reviewMap.set(r.sourceReviewId, r);
  }
  const allowedTopicIds = new Set(ctx.topics.map((t) => t.id));

  const findings: Finding[] = [];
  for (const f of output.findings) {
    // Validate topic links. `?? []` guards direct-object stubs that bypass
    // schema defaults.
    const validTopicIds = (f.topicIds ?? []).filter((id) => allowedTopicIds.has(id));

    // Validate goal-dimension links; unknown ids are stripped by code, never
    // trusted from the model.
    const validFocusAreaIds = ctx.allowedFocusAreaIds
      ? (f.focusAreaIds ?? []).filter((id) => ctx.allowedFocusAreaIds!.has(id))
      : (f.focusAreaIds ?? []);

    // Validate supporting citations; normalize any source-id reference to the
    // stable reviewId so the downstream ledger is consistent.
    const validSupport = f.supportingReviewIds.filter((id) => reviewMap.has(id));
    if (validSupport.length === 0) {
      warnings.push({ code: "UNSUPPORTED_FINDING", message: `dropped ${f.id} (no valid supporting reviews)` });
      continue;
    }

    // Validate excerpts: each must be an exact substring of the cited review.
    const validExcerpts = f.evidenceExcerpts.flatMap((e) => {
      const review = reviewMap.get(e.reviewId);
      if (!review) return [];
      if (!isExactExcerpt(e.excerpt, review.bodyNormalized)) return [];
      return [{ reviewId: review.reviewId, excerpt: e.excerpt }];
    });

    // Every supporting review must be backed by at least one exact excerpt.
    // A review cited only by ID (no verified excerpt) is not evidence, so it
    // is removed from the support set rather than counted toward sample size
    // and confidence. This prevents inflated evidence without valid quotes.
    const excerptedReviewIds = new Set(validExcerpts.map((e) => e.reviewId));
    const supportingReviewIds = [...new Set(validSupport.map((id) => reviewMap.get(id)!.reviewId))].filter((id) =>
      excerptedReviewIds.has(id),
    );
    if (supportingReviewIds.length === 0) {
      warnings.push({ code: "UNSUPPORTED_FINDING", message: `dropped ${f.id} (no supported reviews have an exact excerpt)` });
      continue;
    }
    const conflictingReviewIds = f.conflictingReviewIds.filter((id) => reviewMap.has(id)).map((id) => reviewMap.get(id)!.reviewId);
    const hasConflict = conflictingReviewIds.length > 0;
    const confidence = computeConfidence({
      supportCount: supportingReviewIds.length,
      sourceStatus: ctx.sourceStatus,
      hasConflict,
    });
    const evidenceSufficiency = assessEvidenceSufficiency({
      supportCount: supportingReviewIds.length,
      corpusCount: ctx.reviews.length,
      conflictCount: new Set(conflictingReviewIds).size,
      sourceStatus: ctx.sourceStatus,
    });

    findings.push({
      id: f.id,
      topicIds: validTopicIds,
      focusAreaIds: validFocusAreaIds,
      sourceFindingIds: [],
      title: f.title,
      summary: f.summary,
      supportingReviewIds,
      supportingSampleCount: supportingReviewIds.length,
      evidenceExcerpts: validExcerpts,
      conflictingReviewIds,
      confidence,
      evidenceSufficiency,
      uncertainties: f.uncertainties,
      limitations: f.limitations,
    });
  }

  return {
    findings,
    warnings,
    insufficientEvidence: isInsufficientEvidence(findings),
  };
}

// Findings is the one stage that historically fed the entire review corpus into
// a single model call. For a large corpus that input ballooned to hundreds of
// KB and the provider returned truncated, non-JSON output. Splitting into
// size-bounded chunks (same budget as topic discovery) keeps each call small
// enough to succeed; results are then merged deterministically by code.
const FINDINGS_CHUNK_CHAR_BUDGET = 8_000;
const DEFAULT_FINDINGS_CONCURRENCY = 3;

// The model only needs the review id (stable + source) and the normalized body
// it must quote exactly. Stripping the original body/title/rawRef (and the rest)
// removes ~300KB of redundant input on a 500-review corpus while keeping the
// exact-excerpt validation in normalizeFindings intact (it runs against the
// full ctx.reviews, not the slim copy).
type SlimReview = { reviewId: string; sourceReviewId: string; rating: number; bodyNormalized: string };

// Topics are trimmed to the same essentials the model reasons over: id, label
// and description. The candidate/review id lists are pipeline bookkeeping, not
// signal, and dropping them shrinks every findings prompt on a many-topic run.
type SlimTopic = { id: string; label: string; description: string; focusAreaIds: string[] };

// Model output is bounded so a large corpus never yields unbounded findings:
// at most 4 findings survive per chunk, at most 60 candidates reach semantic
// consolidation, and at most 20 canonical findings survive globally. A single
// consolidation call may output at most 20 groups. Excess output is truncated
// deterministically with a warning — never retried.
const MAX_FINDINGS_PER_CHUNK = 4;
// Number of candidates admitted to the semantic consolidation stage. A regular
// 500-review corpus produces about 14 chunks × 4 = 56 candidates, so 60 keeps
// every candidate eligible; the cap only bites on pathological oversized
// corpora.
const MAX_CONSOLIDATION_CANDIDATES = 60;
const MAX_FINDINGS_TOTAL = 20;

function candidateById(candidates: Finding[]): Map<string, Finding> {
  return new Map(candidates.map((c) => [c.id, c]));
}

/**
 * Merges normalized finding candidates into canonical findings by semantic
 * group. The model returns groups referencing existing candidate ids only; the
 * code then merges evidence (supporting review ids, excerpts, topics, focus
 * areas) deterministically, recomputes counts/confidence/sufficiency, and
 * refuses to reuse a candidate in more than one final finding.
 *
 * `sourceStatus` is the authoritative collection status from the source stage
 * and is required: merging can change the support count, so confidence and
 * sufficiency must be re-derived here against the real source status rather
 * than assuming a complete corpus.
 */
export function consolidateFindings(
  candidates: Finding[],
  groups: { id: string; title: string; summary: string; candidateIds: string[]; focusAreaIds?: string[] }[],
  sourceStatus: SourceStatus,
): { findings: Finding[]; warnings: { code: string; message: string }[]; usedCandidateIds: Set<string>; droppedCandidateIds: string[] } {
  const warnings: { code: string; message: string }[] = [];
  const index = candidateById(candidates);
  const used = new Set<string>();
  const droppedCandidateIds: string[] = [];
  const findings: Finding[] = [];

  for (const g of groups) {
    // A group must reference at least one existing, not-yet-used candidate.
    // `?? []` guards direct-object stubs that bypass schema defaults.
    const candidateIds = g.candidateIds ?? [];
    const fresh = candidateIds.filter((id) => index.has(id) && !used.has(id));
    if (fresh.length === 0) {
      warnings.push({ code: "EMPTY_FINDING_GROUP", message: `dropped ${g.id} (no valid unused candidates)` });
      continue;
    }
    // Warn about unknown/duplicate candidate references (never silently drop).
    const unknown = candidateIds.filter((id) => !index.has(id) || used.has(id));
    if (unknown.length > 0) {
      warnings.push({
        code: "FINDING_GROUP_UNKNOWN_CANDIDATE",
        message: `${g.id} referenced ${unknown.length} unknown or already-used candidate(s); dropped deterministically`,
      });
    }
    for (const id of fresh) used.add(id);

    // Merge evidence deterministically: union of supporting reviews, excerpts,
    // topics, focus areas and conflicting reviews; all counts recomputed.
    const members = fresh.map((id) => index.get(id)!);
    const supportingReviewIds = [...new Set(members.flatMap((m) => m.supportingReviewIds))];
    const topicIds = [...new Set(members.flatMap((m) => m.topicIds))];
    const focusAreaIds = [...new Set([...members.flatMap((m) => m.focusAreaIds), ...(g.focusAreaIds ?? [])])];
    const conflictingReviewIds = [...new Set(members.flatMap((m) => m.conflictingReviewIds))];
    // Merge excerpts, preferring any exact excerpt that already survived
    // validation; dedupe by reviewId.
    const excerptByReview = new Map<string, string>();
    for (const m of members) {
      for (const e of m.evidenceExcerpts) {
        if (!excerptByReview.has(e.reviewId)) excerptByReview.set(e.reviewId, e.excerpt);
      }
    }
    const evidenceExcerpts = [...excerptByReview.entries()].map(([reviewId, excerpt]) => ({ reviewId, excerpt }));
    const hasConflict = conflictingReviewIds.length > 0;
    const confidence = computeConfidence({ supportCount: supportingReviewIds.length, sourceStatus, hasConflict });
    const evidenceSufficiency = assessEvidenceSufficiency({
      supportCount: supportingReviewIds.length,
      corpusCount: Math.max(...members.map((m) => m.evidenceSufficiency.corpusReviewCount)),
      conflictCount: new Set(conflictingReviewIds).size,
      sourceStatus,
    });

    findings.push({
      id: g.id,
      topicIds,
      focusAreaIds,
      sourceFindingIds: [...fresh],
      title: g.title,
      summary: g.summary,
      supportingReviewIds,
      supportingSampleCount: supportingReviewIds.length,
      evidenceExcerpts,
      conflictingReviewIds,
      confidence,
      evidenceSufficiency,
      uncertainties: members.flatMap((m) => m.uncertainties),
      limitations: members.flatMap((m) => m.limitations),
    });
  }

  // Candidates that ended up in no group are dropped (they are subsumed or
  // rejected by the model). Anything never referenced is silently discarded.
  for (const c of candidates) {
    if (!used.has(c.id)) droppedCandidateIds.push(c.id);
  }

  return { findings, warnings, usedCandidateIds: used, droppedCandidateIds };
}

/**
 * Picks one candidate per focus area that is not already represented in the
 * consolidated findings, ranked by evidence signal. Used to close goal-coverage
 * gaps when consolidation under-covered a dimension.
 */
export function pickStrongestForUncovered(
  candidates: Finding[],
  focusAreaIds: string[],
  usedCandidateIds: Set<string>,
  consolidatedFocusAreaIds: Set<string>,
): Finding | null {
  const open = focusAreaIds.filter((id) => !consolidatedFocusAreaIds.has(id));
  if (open.length === 0) return null;
  const rank = (f: Finding) => f.supportingReviewIds.length + f.evidenceExcerpts.length;
  let best: Finding | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    if (usedCandidateIds.has(c.id)) continue;
    if (!open.some((id) => c.focusAreaIds.includes(id))) continue;
    const score = rank(c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Generates evidence-grounded findings. Reviews are slimmed down, split into
 * size-bounded chunks, and analyzed per-chunk in parallel; each chunk's output
 * is passed through the shared deterministic normalizer (see normalizeFindings)
 * against the full review set, then findings are id-namespaced per chunk to
 * avoid cross-chunk collisions. A bounded set of up to MAX_CONSOLIDATION_CANDIDATES
 * then goes through ONE semantic consolidation call (findings.consolidation@1)
 * which merges duplicates and normalizes titles; a coverage backfill adds the
 * strongest candidate for any goal dimension the consolidation left out.
 */
export async function runFindingsStage(ctx: FindingsStageContext): Promise<FindingsStageResult> {
  const warnings: { code: string; message: string }[] = [];
  const slimReviews: SlimReview[] = ctx.reviews.map((r) => ({
    reviewId: r.reviewId,
    sourceReviewId: r.sourceReviewId,
    rating: r.rating,
    bodyNormalized: r.bodyNormalized,
  }));
  const slimTopics: SlimTopic[] = ctx.topics.map((t) => ({ id: t.id, label: t.label, description: t.description, focusAreaIds: t.focusAreaIds }));
  const allowedFocusAreaIds = new Set(ctx.focusAreas?.map((a) => a.id) ?? []);
  const focusAreas = ctx.focusAreas ?? [];

  const chunks = chunkByBodyBudget(slimReviews, FINDINGS_CHUNK_CHAR_BUDGET);
  const perChunk = await mapWithConcurrency(chunks, ctx.maxConcurrency ?? DEFAULT_FINDINGS_CONCURRENCY, async (chunk, chunkIndex) => {
    ctx.onProgress?.(`generating findings for review batch ${chunkIndex + 1} of ${chunks.length} (${chunk.length} reviews)`);
    const output = await ctx.model.generate({
      stage: "findings",
      promptVersion: findingsPrompt.version,
      system: findingsPrompt.system,
      user: findingsPrompt.buildUser({ reviews: chunk, topics: slimTopics, goal: ctx.goal, focusAreas, outputLocale: ctx.outputLocale }),
      schema: FindingOutputSchema,
      onProgress: modelProgressRelay(ctx.onProgress),
    });
    // Truncate this chunk's raw output to the per-chunk cap before any
    // normalization: excess findings are dropped deterministically, not retried.
    if (output.findings.length > MAX_FINDINGS_PER_CHUNK) {
      warnings.push({
        code: "FINDINGS_TRUNCATED",
        message: `batch ${chunkIndex + 1} returned ${output.findings.length} findings; kept first ${MAX_FINDINGS_PER_CHUNK} deterministically`,
      });
      output.findings.length = MAX_FINDINGS_PER_CHUNK;
    }
    // Normalize against the full review set: the model saw only this chunk, so
    // any review it cites resolves here and its excerpt is still verified as an
    // exact substring of the normalized body.
    const result = normalizeFindings(output, { reviews: ctx.reviews, topics: ctx.topics, sourceStatus: ctx.sourceStatus, allowedFocusAreaIds });
    return { chunkIndex, result };
  });

  // Namespacing is only needed when the corpus actually split: two chunks can
  // both emit `finding-1` and collide. For a single chunk the ids pass through
  // unchanged so the small-corpus path is identical to before chunking.
  const namespaceIds = chunks.length > 1;
  const candidates: Finding[] = [];
  for (const { chunkIndex, result } of perChunk) {
    warnings.push(...result.warnings);
    for (const f of result.findings) candidates.push(namespaceIds ? { ...f, id: `${f.id}@c${chunkIndex}` } : f);
  }

  let consolidationAudit: FindingsStageResult["consolidationAudit"];
  let finalFindings: Finding[];
  if (candidates.length === 0) {
    finalFindings = [];
  } else if (candidates.length === 1) {
    // No consolidation needed for a single candidate.
    finalFindings = candidates;
  } else {
    // Cap the candidate set entering consolidation. Excess is dropped with a
    // warning — never retried.
    let consolidatedCandidates = candidates;
    if (candidates.length > MAX_CONSOLIDATION_CANDIDATES) {
      warnings.push({
        code: "FINDINGS_CONSOLIDATION_CANDIDATES_TRUNCATED",
        message: `kept ${MAX_CONSOLIDATION_CANDIDATES} of ${candidates.length} finding candidates for consolidation; excess dropped deterministically`,
      });
      consolidatedCandidates = candidates.slice(0, MAX_CONSOLIDATION_CANDIDATES);
    }
    ctx.onProgress?.(`consolidating ${consolidatedCandidates.length} candidate findings`);
    const consolidation = await ctx.model.generate({
      stage: "findings-consolidation",
      promptVersion: findingsConsolidationPrompt.version,
      system: findingsConsolidationPrompt.system,
      user: findingsConsolidationPrompt.buildUser({ candidates: consolidatedCandidates, focusAreas, outputLocale: ctx.outputLocale }),
      schema: FindingConsolidationOutputSchema,
      onProgress: modelProgressRelay(ctx.onProgress),
    });
    // Cap the consolidation output at 20 groups deterministically.
    const groups = consolidation.groups.slice(0, MAX_FINDINGS_TOTAL);
    if (groups.length < consolidation.groups.length) {
      warnings.push({
        code: "FINDINGS_CONSOLIDATION_TRUNCATED",
        message: `consolidation returned ${consolidation.groups.length} groups; kept first ${MAX_FINDINGS_TOTAL} deterministically`,
      });
    }
    const merged = consolidateFindings(consolidatedCandidates, groups, ctx.sourceStatus);
    warnings.push(...merged.warnings);

    // Goal-coverage backfill: if a focus area has evidence but the
    // consolidation left it out, add the strongest candidate for it. When at
    // the cap, replace the lowest-ranked duplicate that does not uniquely
    // cover a dimension.
    const findings = merged.findings;
    const coveredFocus = new Set<string>();
    for (const f of findings) for (const id of f.focusAreaIds) coveredFocus.add(id);
    const used = new Set(merged.usedCandidateIds);
    const addedForCoverage: string[] = [];
    for (const area of focusAreas) {
      if (coveredFocus.has(area.id)) continue;
      const strongest = pickStrongestForUncovered(consolidatedCandidates, [area.id], used, coveredFocus);
      if (!strongest) continue;
      if (findings.length >= MAX_FINDINGS_TOTAL) {
        // Replace the lowest-ranked duplicate that does not uniquely cover a
        // dimension. Recompute ranks from the final list.
        const rank = (f: Finding) => f.supportingReviewIds.length;
        const replaceable = findings
          .filter((f) => !f.focusAreaIds.some((id) => focusAreas.some((a) => a.id === id) && f.focusAreaIds.length === 1))
          .sort((a, b) => rank(a) - rank(b));
        const victim = replaceable[0];
        if (!victim) continue;
        const victimIdx = findings.findIndex((f) => f.id === victim.id);
        findings[victimIdx] = { ...strongest, id: victim.id };
        used.add(strongest.id);
        addedForCoverage.push(victim.id);
      } else {
        findings.push(strongest);
        used.add(strongest.id);
        addedForCoverage.push(strongest.id);
      }
      for (const id of strongest.focusAreaIds) coveredFocus.add(id);
    }

    finalFindings = findings;
    consolidationAudit = {
      candidateCount: consolidatedCandidates.length,
      consolidatedCount: merged.findings.length,
      finalCount: finalFindings.length,
      groups: merged.findings.map((f) => ({ findingId: f.id, sourceFindingIds: f.sourceFindingIds })),
      droppedCandidateIds: merged.droppedCandidateIds,
      addedForCoverage,
    };
  }

  // Global cap: keep only the first MAX_FINDINGS_TOTAL surviving findings.
  if (finalFindings.length > MAX_FINDINGS_TOTAL) {
    warnings.push({
      code: "FINDINGS_TRUNCATED",
      message: `kept first ${MAX_FINDINGS_TOTAL} of ${finalFindings.length} findings; excess dropped deterministically`,
    });
    finalFindings.length = MAX_FINDINGS_TOTAL;
  }

  return { findings: finalFindings, warnings, insufficientEvidence: isInsufficientEvidence(finalFindings), consolidationAudit };
}
