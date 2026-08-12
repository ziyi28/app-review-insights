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
| Findings | model | grounds user problems in specific reviews with excerpts |
| Version plan / PRD | model | turns findings into requirements, priorities, versions |
| Test cases | model | links tests to requirements and source reviews |
| Traceability validation | deterministic | 14 invariants over the review→finding→requirement→test chain |
| One-shot revision | model | constrained repair of validation violations |

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

Secrets are read only from the environment and never written to logs,
snapshots, or git. `.env.example` documents the shape.

## Prompt discipline

- Prompts live in `src/server/model/prompts/*.v1.ts` with fixed versions
  (`scope@1`, `topics.discovery@1`, …) and a stable hash recorded per call.
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
  normalized body; fabricated excerpts are dropped by code.
- `supportingSampleCount` and confidence are **computed by code**, never trusted
  from the model.
- Findings without any valid supporting review are deleted; ideas without a
  finding become separate `assumptions`, never requirements.
- The traceability validator is deterministic and never invents citations.
  On first failure a single constrained revision may delete/fix/downgrade but
  may not add new citation pairs. A second failure terminates explicitly
  (`TRACEABILITY_INVALID_AFTER_REVISION`) rather than fabricating success.

## Failure handling

- Network / HTTP / timeout / non-JSON / schema violations are distinct error
  codes, surfaced as `run.failed` events with the stage and error preserved.
- No automatic retries; the operator may re-run.
- Without `MODEL_BASE_URL` + `MODEL_NAME`, live/import analysis fails clearly at
  the first model stage; catalog and cached replay are unaffected.

## Runtime metadata

Each model call records: prompt version + hash, redacted request, raw response,
HTTP status, duration, model, temperature (fixed 0.1), finish reason, and token
usage (null when the provider does not return it — never estimated).
