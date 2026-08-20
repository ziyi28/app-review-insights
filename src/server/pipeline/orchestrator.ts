import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import type { FocusArea, Prd } from "@/domain/contracts/analysis";
import type { Limitation } from "@/server/sources/apple-rss-collector";
import type { SourceFile } from "@/server/sources/source-types";
import { prepareReviews } from "@/domain/reviews/prepare";
import { validateTraceability } from "@/domain/traceability/validate";
import { buildEvidenceValidationReport } from "@/domain/analysis/evidence-validation";
import { computeGoalCoverage } from "@/domain/analysis/goal-coverage";
import { createAssumptionFromInsufficientFinding } from "@/domain/analysis/sufficiency";
import { runScopeStage } from "./stages/scope";
import { runTopicsStage } from "./stages/topics";
import { runFindingsStage, normalizeFindings } from "./stages/findings";
import { runPlanningWithCoverage, normalizePlanningOutput } from "./stages/planning";
import { runRequirementEvidenceStage } from "./stages/requirement-evidence";
import { runTestsStage, normalizeTestsOutput } from "./stages/tests";
import { runRevisionStage } from "./stages/revision";
import type { FindingOutput, PlanningOutput, TestsOutput } from "@/server/model/prompts/prompts";
import type { EventPublisher } from "@/server/streaming/event-publisher";
import type { ArtifactName, RunStore } from "@/server/runs/run-store";
import type { RunStartRequest } from "@/domain/contracts/run";
import type { ScriptedModelClient } from "@/server/model/scripted-client";
import type { StageModelClient } from "./dependencies";

export type RunMetadata = {
  appName?: string;
  appUrl?: string;
  fileName?: string;
  startRequest?: RunStartRequest;
};

export type ImportParseShape = {
  reviews: RawReview[];
  rawRefs: string[];
  errors: string[];
  warnings: string[];
  duplicateIndices: number[];
  conflictIndices: number[];
  evidence: { fileName: string; mediaType: "application/json" | "text/csv"; byteLength: number; sha256: string; schemaVersion: string | null };
  /** The original imported file archived into the run directory. */
  sourceFiles: SourceFile[];
};

/**
 * Provider-aware source summary persisted as the `source-evidence` artifact.
 * `provider: "socialcrawl"` is legacy read-only compatibility for old cached
 * artifacts; it is never produced by new previews or runs. `searchCount` and
 * `searchId` are the live SerpApi search cost/provenance; `creditsUsed` and
 * `requestId` remain only as optional legacy fields when reading old artifacts.
 */
export type AppStoreReviewSourceSummary = {
  kind: "app-store-reviews";
  provider: "serpapi" | "apple-rss" | "socialcrawl";
  appId: string;
  storefront: "US";
  status: "complete" | "suspect-empty" | "partial" | "failed";
  selection: "live" | "stable";
  liveCount: number;
  stableCount: number;
  reviewCount: number;
  /** The selected review cap (100/300/500) this run's preview was built against. */
  reviewLimit?: number;
  collectedAt: string;
  forcedRefresh: boolean;
  providerCached: boolean | null;
  requestCount: number;
  searchCount: number;
  searchId: string | null;
  creditsUsed?: number | null;
  requestId?: string | null;
  /** Per-request archive evidence for an apple-rss provider (optional: absent
   *  for SerpApi providers and old artifacts). */
  pages?: {
    page: number;
    attempt: number;
    rawFile: string;
    url: string;
    finalUrl: string;
    httpStatus: number;
    headers: Record<string, string>;
    startedAt: string;
    finishedAt: string;
    byteLength: number;
    sha256: string;
    parserWarnings: { code: string; message: string; index?: number }[];
    reviewCount: number;
    contentType: string | null;
  }[];
};

/** A pre-collected live dataset taken from a preview snapshot. */
export type PreviewSourceShape = {
  previewId: string;
  appId: string;
  canonicalUrl: string;
  selection: "live" | "stable";
  reviews: RawReview[];
  rawRefs: string[];
  /** Source limitations carried from the preview (e.g. LOCAL_HISTORY_SELECTED). */
  limitations: Limitation[];
  sourceSummary: AppStoreReviewSourceSummary;
  /** Raw response bodies from the preview, archived into the run directory. */
  sourceFiles?: SourceFile[];
};

export type ExecuteDeps = {
  model: StageModelClient | ScriptedModelClient;
  source:
    | { kind: "apple-rss"; appleRssBaseUrl: string; appId: string; canonicalUrl: string }
    | { kind: "preview"; data: PreviewSourceShape }
    | { kind: "import"; parse: ImportParseShape };
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => string;
  pageDelayMs?: number;
  maxPages?: number;
  timeoutMs?: number;
};

type StageStatus = { status: string; startedAt?: string; finishedAt?: string; attempt?: number };

async function collectSource(
  source: ExecuteDeps["source"],
  deps: ExecuteDeps,
): Promise<{
  status: "complete" | "suspect-empty" | "partial" | "failed";
  rawReviews: RawReview[];
  rawRefs: string[];
  limitations: Limitation[];
  sourceSummary: unknown;
  sourceFiles: SourceFile[];
}> {
  if (source.kind === "preview") {
    const data = source.data;
    return {
      status: data.sourceSummary.status,
      rawReviews: data.reviews,
      rawRefs: data.rawRefs,
      limitations: data.limitations,
      sourceSummary: data.sourceSummary,
      sourceFiles: data.sourceFiles ?? [],
    };
  }
  if (source.kind === "apple-rss") {
    const { collectAppleReviews } = await import("@/server/sources/apple-rss-collector");
    const collectorDeps = {
      fetchFn: deps.fetchFn ?? fetch,
      sleep: deps.sleep ?? (async () => {}),
      now: deps.now ?? (() => new Date().toISOString()),
      baseUrl: source.appleRssBaseUrl,
      appId: source.appId,
      maxPages: deps.maxPages ?? 10,
      pageDelayMs: deps.pageDelayMs ?? 500,
      timeoutMs: deps.timeoutMs ?? 10_000,
    };
    const result = await collectAppleReviews(collectorDeps);
    return {
      status: result.status,
      rawReviews: result.reviews,
      rawRefs: result.rawRefs,
      limitations: result.limitations,
      sourceSummary: {
        kind: "apple-rss",
        appId: source.appId,
        status: result.status,
        reviewCount: result.reviews.length,
        requestCount: result.pages.length,
        pageCount: new Set(result.pages.map((p) => p.page)).size,
        // Per-request archive evidence so every raw response can be re-verified
        // from the run directory: page, attempt, raw file path, URL, HTTP
        // status, safe headers, timing, UTF-8 byte length, SHA-256, parser
        // warnings and review count. The raw bodies themselves are archived as
        // source files, never embedded here.
        pages: result.pages.map((p) => ({
          page: p.page,
          attempt: p.attempt,
          rawFile: p.rawFile,
          url: p.url,
          finalUrl: p.finalUrl,
          httpStatus: p.httpStatus,
          headers: p.headers,
          startedAt: p.startedAt,
          finishedAt: p.finishedAt,
          byteLength: p.byteLength,
          sha256: p.sha256,
          parserWarnings: p.parserWarnings,
          reviewCount: p.reviewCount,
          contentType: p.contentType,
        })),
      },
      sourceFiles: result.sourceFiles,
    };
  }
  const parse = source.parse as ImportParseShape;
  const limitations: Limitation[] = parse.errors.map((e) => ({ code: "IMPORT_ERROR", message: e, stage: "source", params: { detail: e } }));
  return {
    status: parse.errors.length > 0 ? "partial" : "complete",
    rawReviews: parse.reviews,
    rawRefs: parse.rawRefs,
    limitations,
    // Full parse evidence so the run snapshot records exactly what happened:
    // original filename (metadata only), media type, UTF-8 byte length, SHA-256
    // of the original file, schema version, row errors/warnings and the
    // duplicate/conflict indices the preparer will report.
    sourceSummary: {
      kind: "import",
      reviewCount: parse.reviews.length,
      evidence: parse.evidence,
      errors: parse.errors,
      warnings: parse.warnings,
      duplicateIndices: parse.duplicateIndices,
      conflictIndices: parse.conflictIndices,
    },
    sourceFiles: parse.sourceFiles ?? [],
  };
}

/**
 * Executes the full analysis pipeline for a single run, publishing stage
 * events and persisting every intermediate artifact. Traceability is validated
 * deterministically; on failure a single evidence-constrained revision runs,
 * then validation is retried once. A second failure terminates explicitly
 * instead of fabricating success.
 */
export async function executeRun(
  runId: string,
  goal: string,
  outputLocale: "en" | "zh-CN",
  deps: ExecuteDeps,
  publisher: EventPublisher,
  store: RunStore,
  executionMode: "live" | "import" = deps.source.kind === "import" ? "import" : "live",
  modelConfigured = true,
  metadata?: RunMetadata,
): Promise<void> {
  const createdAt = new Date().toISOString();
  const stages: Record<string, StageStatus> = {};
  const limitations: Limitation[] = [];
  const manifestArtifacts: Record<string, { attempt: number; file: string }> = {};
  let reviews: NormalizedReview[] = [];
  let prd: Prd | null = null;
  let revisionNeeded = false;

  const startStage = async (stage: string) => {
    stages[stage] = { status: "running", startedAt: new Date().toISOString() };
    await publisher.publish({ type: "stage.started", runId, stage: stage as never, data: { stage } });
  };
  const endStage = async (stage: string) => {
    const finishedAt = new Date().toISOString();
    const started = stages[stage]?.startedAt;
    const durationMs =
      started != null ? Math.max(0, new Date(finishedAt).getTime() - new Date(started).getTime()) : undefined;
    stages[stage] = { ...stages[stage], status: "completed", finishedAt };
    await publisher.publish({ type: "stage.completed", runId, stage: stage as never, data: { stage, durationMs } });
  };
  // Forwards a stage's live progress message into a streamed stage.progress
  // event so the UI can show what the model is doing instead of a silent wait.
  const onStageProgress = (stage: string) => (message: string) => {
    void publisher.publish({ type: "stage.progress", runId, stage: stage as never, data: { message } });
  };
  // Publishes an artifact and records its attempt/file for the final manifest.
  // The manifest is NOT rewritten here: rewriting it on every artifact while
  // consumers concurrently read it races on Windows (rename over an open file
  // throws EPERM). Instead a single running manifest is written at run start
  // and finalized at the end; the artifact route falls back to attempt-1 when
  // the manifest has no index for an artifact yet.
  const publishArtifact = async (name: ArtifactName, attempt: number, value: unknown): Promise<void> => {
    const file = await publisher.publishArtifact(runId, name, attempt, value);
    manifestArtifacts[name] = { attempt, file };
  };

  try {
    // Write a single running manifest up front so the run is identifiable
    // during execution and after a crash. Rewriting it per-artifact would race
    // with concurrent reads (EPERM on Windows), so it is only finalized at the
    // end; intermediate artifacts are read via attempt fallback.
    await store.writeManifest(runId, {
      runId,
      status: "running",
      executionMode,
      goal,
      appName: metadata?.appName,
      appUrl: metadata?.appUrl,
      fileName: metadata?.fileName,
      startRequest: metadata?.startRequest,
      createdAt,
      updatedAt: new Date().toISOString(),
      stages,
      artifacts: {},
      limitations: [],
      canReplay: false,
    });

    // Source. The collect phase can take tens of seconds (Apple RSS pages are
    // fetched ≥500ms apart), so announce it — the UI has nothing else to show
    // until the first model stage (scope) starts.
    await startStage("source");
    const sourceStageMessage =
      deps.source.kind === "apple-rss"
        ? "collecting app reviews…"
        : deps.source.kind === "preview"
          ? "loading selected review sample…"
          : "parsing imported reviews…";
    await publisher.publish({ type: "stage.progress", runId, stage: "source", data: { message: sourceStageMessage } });
    const source = await collectSource(deps.source, deps);
    // The authoritative source completeness for the entire run. It is captured
    // once here and threaded into every stage that derives confidence or
    // sufficiency — never re-derived from limitation codes, which would both
    // miss SerpApi partial states and allow a revision to silently re-upgrade
    // a partial source to complete.
    const sourceStatus = source.status;
    await publisher.publish({ type: "stage.progress", runId, stage: "source", data: { message: `collected ${source.rawReviews.length} reviews` } });
    // Source limitations enter the run ledger exactly once: prepareReviews
    // returns them (collected branch verbatim, import branch re-mapped from
    // parse errors) and only the prepare stage pushes. Announcing them as
    // events here must not duplicate the ledger entry.
    for (const l of source.limitations) {
      await publisher.publish({ type: "limitation.reported", runId, stage: "source", data: l });
    }
    // Archive every raw source response BEFORE the raw-reviews artifact is
    // published, so the moment an artifact references a source file it is
    // already on disk and immutable (the write rejects overwrites). Raw bodies
    // live only in the run directory and are never exposed over the API.
    for (const file of source.sourceFiles) {
      await store.writeSourceFile(runId, file.relativePath, file.content);
    }
    // Persist the exact reviews that entered this run so downstream rawRefs and
    // Cached Replay reference run-local immutable artifacts, never the source
    // cache or a live re-collection.
    await publishArtifact("raw-reviews", 1, { reviews: source.rawReviews, rawRefs: source.rawRefs });
    await publishArtifact("source-evidence", 1, source.sourceSummary);
    await endStage("source");

    if (source.status === "failed") {
      // The prepare stage (and its limitations push) never runs on this path,
      // so the source limitations enter the ledger here instead.
      limitations.push(...source.limitations);
      limitations.push({ code: "SOURCE_FAILED", message: "Source collection failed; no reviews could be analyzed", stage: "source" });
      await publisher.publish({ type: "run.failed", runId, data: { error: "source collection failed" } });
      await finalizeManifest(runId, "failed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
      return;
    }

    // Prepare
    await startStage("prepare");
    await publisher.publish({ type: "stage.progress", runId, stage: "prepare", data: { message: "cleaning and normalizing reviews…" } });
    const prepared =
      deps.source.kind === "import"
        ? prepareReviews({ kind: "import", parse: deps.source.parse })
        : prepareReviews({ kind: "collected", reviews: source.rawReviews, rawRefs: source.rawRefs, limitations: source.limitations });
    reviews = prepared.reviews;
    const cleanedIn = prepared.stats.includedCount;
    const cleanedDup = prepared.stats.duplicateCount;
    await publisher.publish({
      type: "stage.progress",
      runId,
      stage: "prepare",
      data: {
        message:
          cleanedDup > 0
            ? `cleaned ${prepared.stats.rawCount} → ${cleanedIn} reviews kept, ${cleanedDup} exact duplicates excluded`
            : `cleaned ${prepared.stats.rawCount} → ${cleanedIn} reviews kept (no duplicates found)`,
      },
    });
    limitations.push(...prepared.limitations);
    await publishArtifact("cleaned-reviews", 1, prepared);
    await publishArtifact("stats", 1, prepared.stats);
    await endStage("prepare");

    // Without a configured model, deterministic stages (collect/import, clean,
    // dedupe, stats) still run and produce cleaned-reviews/stats; analysis
    // stops here with a clear limitation instead of failing the run.
    if (!modelConfigured) {
      limitations.push({
        code: "MODEL_NOT_CONFIGURED",
        message: "No model is configured; only collection/import and cleaning ran",
        stage: "scope",
      });
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "model-not-configured", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
      return;
    }

    // The analysis corpus: exact duplicates are excluded and the full prepared
    // list is kept for the Raw/Cleaned tabs. The corpus is what the model
    // stages see and what traceability validates against.
    const corpus = reviews.filter((r) => r.includedInAnalysis);
    if (corpus.length === 0) {
      // Suspect-empty / no analyzable reviews: do not enter model stages.
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "insufficient-data", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
      return;
    }

    // Scope. The goal is also split into structured focusAreas that downstream
    // stages map findings/requirements back to, so the plan demonstrably covers
    // the goal the user asked for.
    await startStage("scope");
    const scope = await runScopeStage({
      model: deps.model,
      goal,
      stats: prepared.stats,
      sourceLimitations: prepared.limitations,
      outputLocale,
      onProgress: onStageProgress("scope"),
    });
    const focusAreas: FocusArea[] = scope.focusAreas;
    for (const l of scope.explicitLimitations) {
      limitations.push({ code: "SCOPE_LIMITATION", message: l, stage: "scope", params: { detail: l } });
    }
    // Apply the model-interpreted scope so later stages only analyze the
    // reviews the user's goal asked for. The FULL scoped set enters the model
    // stages — sampling was removed so no scope-matching review is left out.
    const scoped = applyScope(corpus, scope.filters);
    const analysisReviews = scoped;
    if (scoped.length === 0) {
      limitations.push({
        code: "SCOPE_EMPTY",
        message: "The selected scope filters matched no reviews; no model analysis was run",
        stage: "scope",
      });
    }
    await publishArtifact("scope", 1, scope);
    await endStage("scope");

    if (scoped.length === 0) {
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "insufficient-data", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt);
      return;
    }

    // Topics
    await startStage("topics");
    const topics = await runTopicsStage({
      model: deps.model,
      reviews: analysisReviews,
      outputLocale,
      goal,
      focusAreas,
      sourceStatus,
      onProgress: onStageProgress("topics"),
    });
    for (const w of topics.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "topics", data: w });
    await publishArtifact("topic-candidates", 1, {
      candidates: topics.candidates,
      warnings: topics.warnings,
    });
    await publishArtifact("topics", 1, { topics: topics.topics, warnings: topics.warnings });
    await endStage("topics");

    // Findings
    await startStage("findings");
    const findingsResult = await runFindingsStage({
      model: deps.model,
      reviews: analysisReviews,
      topics: topics.topics,
      outputLocale,
      goal,
      focusAreas,
      sourceStatus,
      onProgress: onStageProgress("findings"),
    });
    for (const w of findingsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "findings", data: w });
    await publishArtifact("findings", 1, findingsResult);
    await endStage("findings");

    // Goal-coverage artifact: published once the planning stage has produced a
    // plan so every goal dimension maps to finding/requirement coverage. Set to
    // null when the run never reaches planning (insufficient-evidence guardrail
    // below) — the artifact is still published so the UI can render "no plan".
    let goalCoverageArtifact: ReturnType<typeof computeGoalCoverage> | null = null;

    // Evidence validation: a deterministic audit of the findings result that
    // persists counts and per-finding evidence verdicts as an artifact. It runs
    // before any insufficient-evidence short-circuit so every completed run has
    // the audit available regardless of what the guardrail decides next.
    await startStage("evidence-validation");
    const evidenceReport = buildEvidenceValidationReport(findingsResult);
    await publishArtifact("evidence-validation", 1, evidenceReport);
    await endStage("evidence-validation");

    // Evidence guardrail: a run with no surviving findings, or where every
    // finding is short of the evidentiary bar, cannot support a broad or
    // critical plan. A run with ZERO findings stops here — no planning/tests
    // model calls, no PRD/test artifacts, and a final report that cannot be
    // replayed as a complete analysis.
    // A run where all findings have insufficient evidence also stops here:
    // planning, requirement-evidence, and tests stages are not invoked.
    // Instead, an assumption-only PRD is generated, empty artifacts are written,
    // and outcome is set to insufficient-evidence while allowing replay.
    const insufficientFindings = findingsResult.findings.filter(
      (finding) => finding.evidenceSufficiency.status === "insufficient",
    );
    const sufficientFindings = findingsResult.findings.filter(
      (finding) => finding.evidenceSufficiency.status === "sufficient",
    );

    if (findingsResult.findings.length === 0 || insufficientFindings.length > 0) {
      const limitation: Limitation = {
        code: "INSUFFICIENT_EVIDENCE",
        message:
          findingsResult.findings.length === 0
            ? "No evidence-backed findings survived validation"
            : `${insufficientFindings.length} of ${findingsResult.findings.length} findings have insufficient evidence for broad or critical claims`,
        stage: "findings",
        params:
          findingsResult.findings.length === 0
            ? undefined
            : { count: insufficientFindings.length, total: findingsResult.findings.length },
      };
      limitations.push(limitation);
      await publisher.publish({ type: "limitation.reported", runId, stage: "findings", data: limitation });
    }

    if (findingsResult.findings.length === 0) {
      await publishArtifact("final-report", 1, { prd: null, report: null, limitations });
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "insufficient-evidence", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
      return;
    }

    if (sufficientFindings.length === 0) {
      const assumptions = findingsResult.findings.map(createAssumptionFromInsufficientFinding);
      const assumptionOnlyPrd: Prd = {
        outputLocale,
        title: goal,
        overview: "Analysis completed with insufficient evidence to support formal product requirements.",
        findings: findingsResult.findings,
        requirements: [],
        versions: [],
        tests: [],
        assumptions,
      };
      if (focusAreas.length > 0) {
        goalCoverageArtifact = computeGoalCoverage(focusAreas, findingsResult.findings, [], false);
        assumptionOnlyPrd.goalCoverage = goalCoverageArtifact;
        await publishArtifact("goal-coverage", 1, goalCoverageArtifact);
      }

      await publishArtifact("version-plan", 1, { versions: [], decisions: [] });
      await publishArtifact("requirement-evidence", 1, {
        verdicts: [],
        summary: { directCount: 0, partialCount: 0, noneCount: 0, totalJudged: 0 },
        warnings: [],
      });
      await publishArtifact("prd", 1, assumptionOnlyPrd);
      await publishArtifact("tests", 1, { tests: [], prd: assumptionOnlyPrd, warnings: [] });

      await startStage("traceability");
      const reviewMap = new Map(analysisReviews.map((r) => [r.reviewId, r]));
      const report = validateTraceability(assumptionOnlyPrd, analysisReviews.map((r) => r.reviewId), reviewMap);
      await publishArtifact("traceability", 1, report);
      await endStage("traceability");

      await publishArtifact("final-report", 1, {
        prd: assumptionOnlyPrd,
        report,
        limitations,
        goalCoverage: goalCoverageArtifact,
      });

      await publisher.publish({
        type: "run.completed",
        runId,
        data: { outcome: "insufficient-evidence", limitations },
      });
      await finalizeManifest(
        runId,
        "completed",
        stages,
        limitations,
        true,
        executionMode,
        manifestArtifacts,
        store,
        goal,
        deps.model,
        createdAt,
        metadata,
      );
      return;
    }

    // Planning with goal-coverage validation. When a goal dimension has
    // sufficient findings but no requirement, exactly one coverage-repair call
    // runs; a non-monotonic repair (losing existing coverage) is rejected.
    await startStage("planning");
    const planning = await runPlanningWithCoverage({ model: deps.model, findings: findingsResult.findings, outputLocale, goal, focusAreas, onProgress: onStageProgress("planning") });
    for (const w of planning.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "planning", data: w });
    await endStage("planning");

    // Requirement evidence: independently judge every (requirement, candidate
    // review) pair so a requirement no longer inherits a finding's whole review
    // set as its formal evidence. sourceReviewIds narrows to direct support;
    // the audit is persisted so the direct/partial/none split is inspectable.
    await startStage("requirement-evidence");
    const requirementEvidence = await runRequirementEvidenceStage({
      model: deps.model,
      requirements: planning.prd.requirements,
      findings: planning.prd.findings,
      reviews: analysisReviews,
      outputLocale,
      onProgress: onStageProgress("requirement-evidence"),
    });
    for (const w of requirementEvidence.report.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "requirement-evidence", data: w });
    planning.prd = { ...planning.prd, requirements: requirementEvidence.requirements };
    await publishArtifact("requirement-evidence", 1, requirementEvidence.report);
    await endStage("requirement-evidence");

    await publishArtifact("version-plan", 1, planning.versionPlan);
    await publishArtifact("prd", 1, planning.prd);
    goalCoverageArtifact = planning.goalCoverage;
    await publishArtifact("goal-coverage", 1, planning.goalCoverage);
    // Goal-coverage limitations: a dimension with sufficient evidence that is
    // still uncovered after the repair becomes a limitation (never a fabricated
    // success); a dimension with no sufficient evidence is unsupported, which
    // is legitimate and recorded as a limitation too.
    for (const item of planning.goalCoverage.items) {
      if (item.status === "uncovered") {
        const limitation: Limitation = {
          code: "GOAL_AREA_UNCOVERED",
          message: `Goal dimension "${item.label}" has sufficient findings but no requirement after repair`,
          stage: "planning",
          params: { area: item.label },
        };
        limitations.push(limitation);
        await publisher.publish({ type: "limitation.reported", runId, stage: "planning", data: limitation });
      } else if (item.status === "unsupported") {
        const limitation: Limitation = {
          code: "GOAL_AREA_UNSUPPORTED",
          message: `Goal dimension "${item.label}" has no findings with sufficient evidence`,
          stage: "planning",
          params: { area: item.label },
        };
        limitations.push(limitation);
        await publisher.publish({ type: "limitation.reported", runId, stage: "planning", data: limitation });
      }
    }

    // Tests
    await startStage("tests");
    const testsResult = await runTestsStage({ model: deps.model, requirements: planning.prd.requirements, outputLocale, prd: planning.prd, reviews: analysisReviews, onProgress: onStageProgress("tests") });
    for (const w of testsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "tests", data: w });
    prd = testsResult.prd;
    await publishArtifact("tests", 1, testsResult);
    await endStage("tests");

    // Traceability
    await startStage("traceability");
    const reviewMap = new Map(analysisReviews.map((r) => [r.reviewId, r]));
    let report = validateTraceability(prd, analysisReviews.map((r) => r.reviewId), reviewMap);
    await publishArtifact("traceability", 1, report);

    if (!report.valid) {
      await publisher.publish({ type: "validation.failed", runId, stage: "traceability", data: { violations: report.violations } });
      revisionNeeded = true;
    }
    await endStage("traceability");

    if (revisionNeeded) {
      await startStage("revision");
      await publisher.publish({ type: "revision.started", runId, stage: "revision", data: { violations: report.violations } });
      const frozenLedger = {
        findings: Object.fromEntries(prd.findings.map((f) => [f.id, f.supportingReviewIds])),
        requirements: Object.fromEntries(prd.requirements.map((r) => [r.id, r.sourceReviewIds])),
      };
      const allowedReviewIds = [...new Set(analysisReviews.map((r) => r.reviewId))];
      const revision = await runRevisionStage({
        model: deps.model,
        violations: report.violations,
        allowedReviewIds,
        frozenLedger,
        current: {
          findings: prd.findings,
          requirements: prd.requirements,
          tests: prd.tests,
          assumptions: prd.assumptions,
        },
        outputLocale,
        onProgress: onStageProgress("revision"),
      });
      // Re-validate the revised bundle. The revision's entities replace the
      // originals wholesale (the constrained revision may delete/fix/downgrade
      // entities and their fields, so keeping old IDs would silently discard
      // the fixes and fail validation again). The revision output is raw model
      // output, so it is normalized through the same deterministic rules as the
      // initial stages: sample counts, confidence, and requirement evidence are
      // always recomputed by code, never trusted from the model.
      const revisedFindingsResult = normalizeFindings(
        { findings: (revision.findings as FindingOutput["findings"]) ?? [] },
        { reviews: analysisReviews, topics: topics.topics, sourceStatus },
      );
      for (const w of revisedFindingsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "revision", data: w });
      const revisedPlanning = normalizePlanningOutput(
        {
          title: prd.title,
          overview: prd.overview,
          versions: prd.versions.map((v) => ({ ...v, rationale: v.rationale ?? v.summary })),
          requirements: (revision.requirements as PlanningOutput["requirements"]) ?? [],
          assumptions: (revision.assumptions as PlanningOutput["assumptions"]) ?? [],
        },
        revisedFindingsResult.findings,
        outputLocale,
        // Preserve the evidence selection already applied by the
        // requirement-evidence stage: the revision may only remove evidence, so
        // re-normalization intersects the findings union with the frozen,
        // already-filtered requirement evidence rather than re-inflating it.
        new Map(
          Object.entries(frozenLedger.requirements).map(([id, rids]) => [id, new Set(rids)]),
        ),
      );
      for (const w of revisedPlanning.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "revision", data: w });
      const revisedTestsResult = normalizeTestsOutput(
        { tests: (revision.tests as TestsOutput["tests"]) ?? [] },
        revisedPlanning.prd.requirements,
        analysisReviews,
        revisedPlanning.prd,
      );
      for (const w of revisedTestsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "revision", data: w });
      const revisedPrd: Prd = revisedTestsResult.prd;
      report = validateTraceability(revisedPrd, analysisReviews.map((r) => r.reviewId), reviewMap);
      prd = revisedPrd;
      // Goal coverage is recomputed against the revised plan. The revision's
      // findings are raw model output that carries no focusAreaIds, so the
      // ids are mapped back from the initial findings by id to keep the
      // coverage ledger consistent.
      if (focusAreas.length > 0) {
        const focusAreaByFinding = new Map<string, string[]>();
        for (const f of findingsResult.findings) {
          if (f.focusAreaIds.length > 0) focusAreaByFinding.set(f.id, f.focusAreaIds);
        }
        const revisedWithFocus = {
          ...revisedFindingsResult,
          findings: revisedFindingsResult.findings.map((f) => ({
            ...f,
            focusAreaIds: f.focusAreaIds.length > 0 ? f.focusAreaIds : (focusAreaByFinding.get(f.id) ?? []),
          })),
        };
        prd = { ...prd, findings: revisedWithFocus.findings };
        goalCoverageArtifact = computeGoalCoverage(focusAreas, prd.findings, prd.requirements, planning.goalCoverage.retried);
      }
      if (goalCoverageArtifact) prd = { ...prd, goalCoverage: goalCoverageArtifact };
      // Publish the revised artifacts as attempt-02 so consumers never see a
      // stale pre-revision PRD/tests/traceability next to a valid run. The
      // evidence-validation audit is re-run against the revised findings; no
      // fake set of stage started/completed events is emitted for it.
      const revisedEvidenceReport = buildEvidenceValidationReport(revisedFindingsResult);
      await publishArtifact("evidence-validation", 2, revisedEvidenceReport);
      await publishArtifact("version-plan", 2, revisedPlanning.versionPlan);
      if (goalCoverageArtifact) await publishArtifact("goal-coverage", 2, goalCoverageArtifact);
      await publishArtifact("prd", 2, prd);
      await publishArtifact("tests", 2, { tests: prd.tests, prd, warnings: [] });
      await publishArtifact("traceability", 2, report);
      await publisher.publish({ type: "revision.completed", runId, stage: "revision", data: { note: revision.note, validAfter: report.valid } });

      if (!report.valid) {
        limitations.push({
          code: "TRACEABILITY_INVALID_AFTER_REVISION",
          message: "Traceability still invalid after one constrained revision",
          stage: "traceability",
        });
      }
      await endStage("revision");
    }

    // Final report artifact.
    // Responsibility: Serves as the raw structured deliverable aggregator + traceability report
    // (combines final PRD, validation report, pipeline limitations, and goal coverage ledger).
    // Note: Human-facing narrative executive summary is synthesized client-side in executive-report.tsx.
    // A run whose traceability is still invalid after one constrained revision is a FAILED run
    // (manifest status failed, terminal run.failed event) — never a "completed" success.
    // goalCoverage is carried both on the prd bundle and at the report top level (optional, old runs lack it).
    await publishArtifact("final-report", 1, { prd, report, limitations, goalCoverage: goalCoverageArtifact });

    if (report.valid) {
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "valid", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, true, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
    } else {
      await publisher.publish({ type: "run.failed", runId, data: { outcome: "invalid-after-revision", limitations } });
      await finalizeManifest(runId, "failed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    limitations.push({ code: "PIPELINE_ERROR", message, stage: "pipeline" });
    await publisher.publish({ type: "run.failed", runId, data: { error: message } });
    await finalizeManifest(runId, "failed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model, createdAt, metadata);
  }
}

type ScopeFilters = { rating: number[]; versions: string[]; languages: string[]; minDate: string | null; maxDate: string | null };

/**
 * Applies the model-interpreted scope to the prepared corpus: excludes exact
 * duplicates (includedInAnalysis=false) and keeps only reviews matching the
 * generic rating/version/language/date filters. Reviews without a date are
 * excluded when a date filter is present, since their in-range status cannot
 * be verified.
 */
function applyScope(reviews: NormalizedReview[], filters: ScopeFilters): NormalizedReview[] {
  const ratings = new Set(filters.rating);
  const versions = new Set(filters.versions.map((v) => v.trim()));
  const languages = new Set(filters.languages);
  const min = filters.minDate ? new Date(filters.minDate).getTime() : null;
  const max = filters.maxDate ? new Date(filters.maxDate).getTime() : null;
  return reviews.filter((r) => {
    if (!r.includedInAnalysis) return false;
    if (ratings.size > 0 && !ratings.has(r.rating)) return false;
    if (versions.size > 0 && (r.version == null || !versions.has(r.version))) return false;
    if (languages.size > 0 && !languages.has(r.language)) return false;
    const t = r.updatedAt ? new Date(r.updatedAt).getTime() : null;
    if (min !== null && (t === null || t < min)) return false;
    if (max !== null && (t === null || t > max)) return false;
    return true;
  });
}

function modelUsageFrom(model: unknown): Record<string, unknown> | undefined {
  if (model && typeof model === "object" && "getUsageLog" in model) {
    const getter = (model as { getUsageLog: () => unknown }).getUsageLog;
    try {
      return getter.call(model) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function finalizeManifest(
  runId: string,
  status: "completed" | "failed",
  stages: Record<string, StageStatus>,
  limitations: Limitation[],
  canReplay: boolean,
  executionMode: "live" | "import",
  artifacts: Record<string, { attempt: number; file: string }>,
  store: RunStore,
  goal: string,
  model?: unknown,
  createdAt?: string,
  metadata?: RunMetadata,
): Promise<void> {
  await store.writeManifest(runId, {
    runId,
    status,
    executionMode,
    goal,
    appName: metadata?.appName,
    appUrl: metadata?.appUrl,
    fileName: metadata?.fileName,
    startRequest: metadata?.startRequest,
    // The run's true start time is captured at executeRun entry; the manifest
    // must never reset it (a stale createdAt makes total run duration wrong).
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages,
    artifacts,
    limitations: limitations.map((l) => ({ code: l.code, message: l.message, ...(l.params ? { params: l.params } : {}) })),
    canReplay,
    modelUsage: modelUsageFrom(model),
    promptVersions: modelUsageFrom(model)?.promptVersions as string[] | undefined,
  });
}
