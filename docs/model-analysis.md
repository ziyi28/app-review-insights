# Model-Driven Analysis

The core semantic analysis is performed at runtime by a large language model
via an OpenAI-compatible chat completions endpoint. Deterministic rules are
used where they are the right tool; the model is used where semantic
understanding is required.

## Why rules, why the model, per stage

| Stage | Approach | Why |
|---|---|---|
| Collect (Apple RSS / import) | deterministic | parsing, pagination, HTTP semantics, evidence capture |
| Clean / dedupe / stats | deterministic | exact dedupe, NFC normalization, aggregates |
| Scope interpretation | model | maps a free-form goal onto generic filters + limitations |
| Topic discovery / consolidation | model | dynamic themes, no fixed taxonomy |
| Findings | model + deterministic | model grounds user problems in specific reviews with excerpts; code computes sample counts, confidence, and the Evidence Sufficiency verdict |
| Evidence Validation | deterministic | code audits every surviving finding's support/corpus/ratio/conflict counts and lists rejected (UNSUPPORTED_FINDING) findings |
| Version Planning / PRD | model + deterministic | model supplies semantic factors (Severity, User Impact, Implementation Scope, Dependencies, rationale); code recomputes Evidence Strength, Confidence and Frequency, caps Priority, and validates dependency ordering |
| Traceability validation | deterministic | full invariant set over the review→finding→requirement→test chain (including direct Finding/Priority checks on tests) |
| One-shot revision | model | constrained repair of validation violations; output is re-normalized through the same deterministic rules, and the revised artifacts are published as attempt 2 (Draft/Final) |
| Test cases | model + deterministic | model links tests to requirements and source reviews; code derives each test's direct Finding IDs and Priority from the requirement graph |

A purely keyword/taxonomy pipeline cannot generalize to unseen apps and
reviews; a purely generative pipeline cannot be audited. The hybrid is the
point of this project.

## Configuration

| Env | Meaning |
|---|---|
| `MODEL_BASE_URL` | OpenAI-compatible API root (the client appends `/chat/completions`) |
| `MODEL_API_KEY` | bearer token; empty is allowed for local runtimes |
| `MODEL_NAME` | model identifier |
| `MODEL_JSON_MODE` | `prompt` (default, JSON via prompt) or `json_object` (declared response format) |
| `MODEL_REASONING_EFFORT` | `low`, `medium` (default), `high`, or `max` reasoning effort |

Secrets come from the environment (`.env` / `.env.local`) or the settings
panel, which persists to the git-ignored `data/config.local.json`. Either way
they never enter run snapshots, API responses, or logs. `.env.example`
documents the env shape.

### Model Performance & Benchmark Notes

- **`gpt5.6luna` (Fast & High Quality)**: In benchmark runs, `gpt5.6luna` completes the full multi-stage analysis pipeline in approximately **2 minutes** while producing high-quality semantic insights and adhering strictly to structured JSON requirements.
- **`deepseek-v4-flash` (Baseline)**: The benchmark and test suite baseline is verified against `deepseek-v4-flash`, taking around **20 minutes** for the complete pipeline.

## Prompt discipline

- Prompts live in `src/server/model/prompts/*.ts` (one file per version) with
  fixed versions
  (`scope@2`, `topics.discovery@3`, `findings@4`, …) and a stable hash
  recorded per call.
- Review text is always labeled **untrusted data**; prompts forbid following
  reviewer instructions.
- Each prompt returns a single JSON object validated by a Zod schema. No tool
  calls, no external facts.
- Output language is fixed by the run's `outputLocale`; switching the UI
  language never re-translates stored artifacts.

## Hallucination and grounding controls

- The model only receives: the user goal, reviews with stable IDs, deterministic
  stats, and the previous stage's *allowed* IDs.
- Every evidence excerpt must be an exact substring of the cited review's
  normalized body; the excerpt receives the same NFC + whitespace fold before
  comparison (letter case and whitespace may differ); fabricated excerpts are
  dropped by code.
- `supportingSampleCount`, confidence, and the **Evidence Sufficiency** verdict
  are **computed by code**, never trusted from the model. Sufficiency is a
  deterministic v1 policy over support count (≥3), corpus ratio (≥1%),
  source completeness, and conflict ratio (conflicts < support). An
  `insufficient` finding survives as a limited fact but can never drive a
  P0/P1 requirement or a target version.
- Support is counted in **distinct content groups** (the normalized body's
  stable hash), not raw review ids — a re-synced or adversarial copy of the same
  review collapses to one group instead of inflating the sample. Confidence is
  a deterministic v2 policy that additionally downgrades `high` for a negligible
  corpus share, uniformly short supporting bodies, or a homogeneous rating, and
  records every downgrade in `reasons`.
- Test cases' direct `findingIds` and `priority` are derived by code from the
  requirement graph and validated the same way; the tests prompt output
  contract does not carry them.
- Findings without any valid supporting review are deleted; ideas without a
  finding become separate `assumptions`, never requirements.
- The traceability validator is deterministic and never invents citations.
  On first failure a single constrained revision may delete/fix/downgrade but
  may not add new citation pairs. A second failure terminates explicitly
  (`TRACEABILITY_INVALID_AFTER_REVISION`) rather than fabricating success.

## Failure handling

- Network / HTTP / timeout / non-JSON / schema violations are distinct error
  codes, surfaced as `run.failed` events with the stage and error preserved.
- Model calls are retried a bounded number of times: at most **3 attempts** (an
  initial attempt plus up to 2 retries) with 1s/2s backoff. Only transient
  failures retry — 5xx, network errors, per-call timeouts, and non-JSON/
  truncated responses. 4xx, schema violations, and client disconnects fail
  immediately. Each retry emits a `stage.progress` message (`model retry 2/3
  in 1s (MODEL_HTTP_ERROR)`) and is recorded in the manifest's `modelUsage` as
  `attempts`, `retries`, and `retryReasons` (never the provider response body
  or the API key).
- Without `MODEL_BASE_URL` + `MODEL_NAME`, the deterministic stages (collect/
  import, clean, dedupe, stats) still run and the run completes gracefully with
  a `MODEL_NOT_CONFIGURED` limitation instead of failing; catalog and cached
  replay are unaffected.

## Input normalization

- A **China App Store** page (`https://apps.apple.com/cn/...`) is accepted but
  only used to parse the app id; the collector always requests the fixed US
  RSS URL, so review data always comes from the US storefront. Other hosts,
  protocols and storefronts are rejected with a 422.

## Runtime metadata

Each model call records: prompt version + hash, redacted request, raw response,
HTTP status, duration, model, temperature (fixed 0.1), finish reason, and token
usage (null when the provider does not return it — never estimated). The run
manifest's `modelUsage` additionally aggregates `calls` (successful logical
calls), `attempts` (HTTP attempts), `retries` and `retryReasons` — without ever
including the response body or the API key.

## UI and artifacts

Artifacts are published in stage order and visible as tabs:

```text
stats → topic-candidates → topics → findings → evidence-validation
→ version-plan → prd → tests → traceability → final-report
```

After a revision, `evidence-validation`, `version-plan`, `prd`, `tests` and
`traceability` are published as attempt 2; the UI shows Draft/Final selectors
for the revised artifacts and "Final · no revision required" for unrevised
runs. Cached runs that predate these artifacts show a clear fallback.
