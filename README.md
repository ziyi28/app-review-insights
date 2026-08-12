# App Review Planner

Local, model-driven analysis of App Store user reviews into
evidence-grounded product plans. Enter a US App Store URL (or import a review
dataset), pick an analysis goal, and the app collects, cleans, analyzes, plans,
and validates — surfacing the whole workflow and every intermediate artifact.

**One command to run:** `npm run dev` then open http://localhost:3000.

## What it does

1. **Scope** — interprets a free-form goal into generic filters and explicit
   limitations (model + rules).
2. **Collect / Import** — pulls the Apple Customer Reviews RSS for a US
   storefront, or accepts a documented JSON/CSV dataset.
3. **Clean** — NFC normalization, exact dedupe, deterministic stats.
4. **Topics** — dynamic theme discovery (model), no fixed taxonomy.
5. **Findings** — user problems grounded in specific reviews with exact
   excerpts (model + code-verified evidence).
6. **Version plan + PRD** — requirements traceable to findings, split across
   versions (model).
7. **Tests** — test cases linked to requirements and source reviews (model).
8. **Traceability** — deterministic validation of the whole chain, with a
   single constrained revision on failure.

Every run streams its progress as NDJSON events and persists a complete file
snapshot under `data/runs/<runId>/`, which can be replayed offline as a
**Cached Replay**.

## Quick Start

Requirements: Node.js 22+.

```bash
npm ci
npm run dev
# open http://localhost:3000
```

For the live model-driven path you must configure a model (see below). Without
a model you can still:

- run the bundled real **Cached Replay** (offline demo) from the UI's
  **Cached Replay** mode, which lists replayable runs with no model and no
  network; and
- import and clean datasets: collection/import, dedupe, and stats run, then the
  run completes with a `MODEL_NOT_CONFIGURED` limitation (no model call is
  attempted).

## Data Sources and Limitations

- **Live:** Apple Customer Reviews RSS
  (`/us/rss/customerreviews/page={1..10}/id={id}/sortby=mostRecent/json`),
  fetched sequentially, at least 500 ms apart, max 10 pages, no concurrency,
  no hidden retries. Each page's raw response, safe headers, timestamps, and
  SHA-256 are preserved.
- **This is a best-effort window, not the full review history.** Apple provides
  no public SLA for this feed; it typically exposes only roughly the most
  recent pages (≤ ~10 × 50 entries).
- **Empty pages are ambiguous.** A page that returns HTTP 200 with no entries is
  marked `suspect-empty` and never reported as "this app has no reviews".
- **Partial failures** (a page fails after earlier pages succeeded) continue the
  analysis with the collected reviews and propagate the limitation everywhere.
- **Import:** provenance of imported data cannot be verified by this app; you
  are responsible for its authenticity and lawful use.
- **Aggregate ratings** (via iTunes Lookup) are shown only as context; they are
  not review text and never substitute for review collection.

## Model Provider and Configuration

| Env | Meaning |
|---|---|
| `MODEL_BASE_URL` | OpenAI-compatible API root (client appends `/chat/completions`) |
| `MODEL_API_KEY` | bearer token; may be empty for local runtimes |
| `MODEL_NAME` | model identifier |
| `MODEL_JSON_MODE` | `prompt` (default) or `json_object` |

Copy `.env.example` to `.env` (git-ignored) and fill in your values. Keys are
never logged, persisted, or committed. Temperature is fixed at 0.1.

For the bundled demo fixture the analysis used a DeepSeek-compatible endpoint
(`deepseek-v4-flash`); that configuration is documented in
`fixtures/demo-runs/run-workout-for-women-us/provenance.json` and is **not**
required to replay it.

See `docs/model-analysis.md` for per-stage rules-vs-model rationale, prompt
versions, and failure handling.

## Prompt and Hallucination Controls

- Prompts in `src/server/model/prompts/*.v1.ts`, versioned (`scope@1`, …).
- Review text is always treated as **untrusted data**; prompts forbid following
  reviewer instructions.
- Every model result is validated against a Zod schema.
- The model only ever receives the goal, reviews with stable IDs, deterministic
  stats, and previously-allowed IDs.
- Evidence excerpts must be exact substrings of the cited review; sample counts
  and confidence are computed by code, never taken from the model.
- Findings with no valid support are deleted; unsupported ideas become separate
  `assumptions`, never requirements.
- Traceability is validated deterministically; a single constrained revision
  may delete/fix/downgrade but may not add citations or new excerpts. A second
  failure is explicit: the run ends with `run.failed` and a failed manifest
  carrying `TRACEABILITY_INVALID_AFTER_REVISION` — never a fabricated success.
  Revised artifacts are published as attempt-02 so the UI never shows stale
  pre-revision output.

## Import Format

`docs/import-format.md` documents the JSON v1 and CSV v1 schemas, required
fields, limits, and validation behavior. Same-origin dedupe is exact only.

## Traceability Rules

`review → finding → requirement → test`:

- A `finding` cites ≥1 review, **each** backed by an exact excerpt; its sample
  count and confidence are code-derived. A support review without an exact
  excerpt is dropped rather than inflating the sample.
- The user's analysis goal is interpreted into generic scope filters
  (rating/version/language/date) that are actually applied: later stages only
  analyze reviews matching the scope.
- A `requirement` references ≥1 finding; its source reviews are the union of
  those findings' evidence.
- A `test` references ≥1 requirement and only reviews inside the union of the
  cited requirements' evidence; every requirement must be covered.
- Assumptions are never requirements and never generate tests.
- See `src/domain/traceability/validate.ts` for the full invariant list.

## Cached Replay and Data Authenticity

- Every run can be replayed offline from its snapshot with no network and no
  model; the UI's **Cached Replay** mode lists replayable runs and re-materializes
  all artifacts under a fresh run id, labeled **Cached Replay**, and it never
  calls Apple or the model.
- `fixtures/demo-runs/run-workout-for-women-us/` is a **real** capture from the
  US App Store (App ID 839285684, "Workout for Women: Home Gym") analyzed by a
  real model, privacy-minimized, with full provenance:
  - review id / rating / title / body / version / timestamp retained;
  - reviewer nickname, author URI, and sensitive headers removed;
  - `provenance.json` records capture time, source URL pattern, storefront,
    snapshot SHA-256, model, temperature, and prompt versions.
- Real snapshots are marked as such. The app never pretends a mock, a rule
  fallback, or a static text is a live model result.

## Failure Handling

- Distinct error codes for network / HTTP / timeout / non-JSON / schema
  violations, surfaced as `run.failed` events with stage and error preserved.
- No automatic retries; the operator re-runs.
- Without a model, import/live analysis still runs the deterministic stages
  (collect/import, clean, dedupe, stats) and completes with a
  `MODEL_NOT_CONFIGURED` limitation; catalog and cached replay always work.

## Testing

```bash
npm run lint
npm run typecheck
npm run test:unit          # domain, server, model, components
npm run test:integration   # pipeline, import, revision, replay, real fixture
npm run build
npm run test:e2e           # live (stubbed upstream), import, cached-replay
npm run verify             # lint + typecheck + coverage + build
```

Coverage thresholds (lines/statements/functions/branches ≥ 80%) apply to
`src/domain/**` and `src/server/**`.

## Project Structure

```text
src/domain/contracts/    Zod schemas (reviews, analysis, events, runs)
src/domain/reviews/      normalize, dedupe, language, stats
src/domain/analysis/     evidence, confidence
src/domain/traceability/ deterministic validator
src/server/sources/      App Store URL, Apple RSS collector/parser, import
src/server/model/        OpenAI-compatible client, scripted client, prompts
src/server/runs/         run store, catalog, replay
src/server/pipeline/     stages + orchestrator
src/app/api/             config / runs / manifest / artifact routes
src/components/          bilingual workbench UI
src/i18n/                en / zh-CN dictionaries
scripts/                 capture + demo build + docs check
fixtures/demo-runs/      real, replayable snapshot
```

## Privacy and Security

- `.env*`, `data/runs/`, coverage and test artifacts are git-ignored.
- Review text is sent to your configured model endpoint; use one you trust.
- Run snapshots never contain the API key; model usage metadata records only
  provider/model/temperature/version/duration/tokens.
- Reviewer identity fields are not stored; the bundled fixture is
  privacy-minimized.
- This is a local, single-user app. Do not expose it directly to the public
  internet.

## Non-goals

No accounts, collaboration, cloud deployment, background queues, databases, or
App Store Connect private API. Fuzzy/embedding dedupe and multi-round model
retries are intentionally out of scope.
