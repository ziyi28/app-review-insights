import type { NormalizedReview, RawReview } from "@/domain/contracts/review";
import type { Prd } from "@/domain/contracts/analysis";
import type { Limitation } from "@/server/sources/apple-rss-collector";
import { prepareReviews } from "@/domain/reviews/prepare";
import { validateTraceability } from "@/domain/traceability/validate";
import { buildEvidenceValidationReport } from "@/domain/analysis/evidence-validation";
import { runScopeStage } from "./stages/scope";
import { runTopicsStage } from "./stages/topics";
import { runFindingsStage, normalizeFindings } from "./stages/findings";
import { runPlanningStage, normalizePlanningOutput } from "./stages/planning";
import { runTestsStage, normalizeTestsOutput } from "./stages/tests";
import { runRevisionStage } from "./stages/revision";
import type { FindingOutput, PlanningOutput, TestsOutput } from "@/server/model/prompts/prompts";
import type { EventPublisher } from "@/server/streaming/event-publisher";
import type { ArtifactName, RunStore } from "@/server/runs/run-store";
import type { ScriptedModelClient } from "@/server/model/scripted-client";
import type { StageModelClient } from "./dependencies";

export type ImportParseShape = {
  reviews: RawReview[];
  rawRefs: string[];
  errors: string[];
  warnings: string[];
  duplicateIndices: number[];
  conflictIndices: number[];
  evidence: { fileName: string; mediaType: "application/json" | "text/csv"; byteLength: number; sha256: string; schemaVersion: string | null };
};

/** Provider-aware source summary persisted as the `source-evidence` artifact. */
export type AppStoreReviewSourceSummary = {
  kind: "app-store-reviews";
  provider: "socialcrawl" | "apple-rss";
  appId: string;
  storefront: "US";
  status: "complete" | "suspect-empty" | "partial" | "failed";
  selection: "live" | "stable";
  liveCount: number;
  stableCount: number;
  reviewCount: number;
  collectedAt: string;
  forcedRefresh: boolean;
  providerCached: boolean | null;
  requestCount: number;
  requestId: string | null;
  creditsUsed: number | null;
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
}> {
  if (source.kind === "preview") {
    const data = source.data;
    return {
      status: data.sourceSummary.status,
      rawReviews: data.reviews,
      rawRefs: data.rawRefs,
      limitations: data.limitations,
      sourceSummary: data.sourceSummary,
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
      sourceSummary: { kind: "apple-rss", appId: source.appId, status: result.status, pages: result.pages.length, reviewCount: result.reviews.length },
    };
  }
  const parse = source.parse as ImportParseShape;
  const limitations: Limitation[] = parse.errors.map((e) => ({ code: "IMPORT_ERROR", message: e, stage: "source" }));
  return {
    status: parse.errors.length > 0 ? "partial" : "complete",
    rawReviews: parse.reviews,
    rawRefs: parse.rawRefs,
    limitations,
    sourceSummary: { kind: "import", reviewCount: parse.reviews.length, warnings: parse.warnings },
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
    stages[stage] = { ...stages[stage], status: "completed", finishedAt: new Date().toISOString() };
    await publisher.publish({ type: "stage.completed", runId, stage: stage as never, data: { stage } });
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
    await publisher.publish({ type: "stage.progress", runId, stage: "source", data: { message: `collected ${source.rawReviews.length} reviews` } });
    limitations.push(...source.limitations);
    for (const l of source.limitations) {
      await publisher.publish({ type: "limitation.reported", runId, stage: "source", data: l });
    }
    // Persist the exact reviews that entered this run so downstream rawRefs and
    // Cached Replay reference run-local immutable artifacts, never the source
    // cache or a live re-collection.
    await publishArtifact("raw-reviews", 1, { reviews: source.rawReviews, rawRefs: source.rawRefs });
    await publishArtifact("source-evidence", 1, source.sourceSummary);
    await endStage("source");

    if (source.status === "failed") {
      limitations.push({ code: "SOURCE_FAILED", message: "Source collection failed; no reviews could be analyzed", stage: "source" });
      await publisher.publish({ type: "run.failed", runId, data: { error: "source collection failed" } });
      await finalizeManifest(runId, "failed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
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
    await publisher.publish({ type: "stage.progress", runId, stage: "prepare", data: { message: `prepared ${reviews.length} reviews for analysis` } });
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
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
      return;
    }

    // The analysis corpus: exact duplicates are excluded and the full prepared
    // list is kept for the Raw/Cleaned tabs. The corpus is what the model
    // stages see and what traceability validates against.
    const corpus = reviews.filter((r) => r.includedInAnalysis);
    if (corpus.length === 0) {
      // Suspect-empty / no analyzable reviews: do not enter model stages.
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "insufficient-data", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
      return;
    }

    // Scope
    await startStage("scope");
    const scope = await runScopeStage({
      model: deps.model,
      goal,
      stats: prepared.stats,
      sourceLimitations: prepared.limitations,
      outputLocale,
      onProgress: onStageProgress("scope"),
    });
    for (const l of scope.explicitLimitations) {
      limitations.push({ code: "SCOPE_LIMITATION", message: l, stage: "scope" });
    }
    // Apply the model-interpreted scope so later stages only analyze the
    // reviews the user's goal asked for.
    const scoped = applyScope(corpus, scope.filters);
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
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
      return;
    }

    // Topics
    await startStage("topics");
    const topics = await runTopicsStage({
      model: deps.model,
      reviews: scoped,
      outputLocale,
      goal,
      sourceStatus: sourceStatusOf(limitations),
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
      reviews: scoped,
      topics: topics.topics,
      outputLocale,
      goal,
      sourceStatus: sourceStatusOf(limitations),
      onProgress: onStageProgress("findings"),
    });
    for (const w of findingsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "findings", data: w });
    await publishArtifact("findings", 1, findingsResult);
    await endStage("findings");

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
    // replayed as a complete analysis. A run that has findings (even if all
    // are insufficient) still proceeds; the planning stage pins their
    // requirements to P2 with no target version.
    const insufficientFindings = findingsResult.findings.filter(
      (finding) => finding.evidenceSufficiency.status === "insufficient",
    );
    if (findingsResult.findings.length === 0 || insufficientFindings.length > 0) {
      const limitation: Limitation = {
        code: "INSUFFICIENT_EVIDENCE",
        message:
          findingsResult.findings.length === 0
            ? "No evidence-backed findings survived validation"
            : `${insufficientFindings.length} of ${findingsResult.findings.length} findings have insufficient evidence for broad or critical claims`,
        stage: "findings",
      };
      limitations.push(limitation);
      await publisher.publish({ type: "limitation.reported", runId, stage: "findings", data: limitation });
    }

    if (findingsResult.findings.length === 0) {
      await publishArtifact("final-report", 1, { prd: null, report: null, limitations });
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "insufficient-evidence", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
      return;
    }

    // Planning
    await startStage("planning");
    const planning = await runPlanningStage({ model: deps.model, findings: findingsResult.findings, outputLocale, goal, onProgress: onStageProgress("planning") });
    for (const w of planning.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "planning", data: w });
    await publishArtifact("version-plan", 1, planning.versionPlan);
    await publishArtifact("prd", 1, planning.prd);
    await endStage("planning");

    // Tests
    await startStage("tests");
    const testsResult = await runTestsStage({ model: deps.model, requirements: planning.prd.requirements, outputLocale, prd: planning.prd, reviews: scoped, onProgress: onStageProgress("tests") });
    for (const w of testsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "tests", data: w });
    prd = testsResult.prd;
    await publishArtifact("tests", 1, testsResult);
    await endStage("tests");

    // Traceability
    await startStage("traceability");
    const reviewMap = new Map(scoped.map((r) => [r.reviewId, r]));
    let report = validateTraceability(prd, scoped.map((r) => r.reviewId), reviewMap);
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
      const allowedReviewIds = [...new Set(scoped.map((r) => r.reviewId))];
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
        { reviews: scoped, topics: topics.topics, sourceStatus: sourceStatusOf(limitations) },
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
      );
      for (const w of revisedPlanning.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "revision", data: w });
      const revisedTestsResult = normalizeTestsOutput(
        { tests: (revision.tests as TestsOutput["tests"]) ?? [] },
        revisedPlanning.prd.requirements,
        scoped,
        revisedPlanning.prd,
      );
      for (const w of revisedTestsResult.warnings) await publisher.publish({ type: "stage.progress", runId, stage: "revision", data: w });
      const revisedPrd: Prd = revisedTestsResult.prd;
      report = validateTraceability(revisedPrd, scoped.map((r) => r.reviewId), reviewMap);
      prd = revisedPrd;
      // Publish the revised artifacts as attempt-02 so consumers never see a
      // stale pre-revision PRD/tests/traceability next to a valid run. The
      // evidence-validation audit is re-run against the revised findings; no
      // fake set of stage started/completed events is emitted for it.
      const revisedEvidenceReport = buildEvidenceValidationReport(revisedFindingsResult);
      await publishArtifact("evidence-validation", 2, revisedEvidenceReport);
      await publishArtifact("version-plan", 2, revisedPlanning.versionPlan);
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

    // Final report. A run whose traceability is still invalid after one
    // constrained revision is a FAILED run (manifest status failed, terminal
    // run.failed event) — never a "completed" success.
    await publishArtifact("final-report", 1, { prd, report, limitations });
    if (report.valid) {
      await publisher.publish({ type: "run.completed", runId, data: { outcome: "valid", limitations } });
      await finalizeManifest(runId, "completed", stages, limitations, true, executionMode, manifestArtifacts, store, goal, deps.model);
    } else {
      await publisher.publish({ type: "run.failed", runId, data: { outcome: "invalid-after-revision", limitations } });
      await finalizeManifest(runId, "failed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    limitations.push({ code: "PIPELINE_ERROR", message, stage: "pipeline" });
    await publisher.publish({ type: "run.failed", runId, data: { error: message } });
    await finalizeManifest(runId, "failed", stages, limitations, false, executionMode, manifestArtifacts, store, goal, deps.model);
  }
}

function sourceStatusOf(limitations: Limitation[]): "complete" | "partial" | "suspect-empty" | "failed" {
  if (limitations.some((l) => l.code === "RSS_SUSPECT_EMPTY")) return "suspect-empty";
  if (limitations.some((l) => l.code === "RSS_PARTIAL" || l.code === "RSS_UNSTABLE_PAGINATION" || l.code === "IMPORT_ERROR")) return "partial";
  if (limitations.some((l) => l.code === "RSS_FETCH_FAILED")) return "failed";
  return "complete";
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
): Promise<void> {
  await store.writeManifest(runId, {
    runId,
    status,
    executionMode,
    goal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages,
    artifacts,
    limitations: limitations.map((l) => ({ code: l.code, message: l.message })),
    canReplay,
    modelUsage: modelUsageFrom(model),
    promptVersions: modelUsageFrom(model)?.promptVersions as string[] | undefined,
  });
}
