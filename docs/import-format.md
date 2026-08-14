# Review Import Format

The app accepts App Store review data in a documented JSON or CSV format.
Imported reviews are analyzed exactly like live-collected ones; their
provenance is labeled `Imported` in the UI.

> Imported provenance cannot be verified by the application. You are
> responsible for the authenticity and legal right to use the data you import.

## Limits

| Limit | Value |
|---|---|
| File size | ≤ 2,000,000 bytes |
| Review count | ≤ 1,000 |
| Single body length | ≤ 20,000 characters |
| Rating | integer 1–5 |

## JSON v1

```json
{
  "schemaVersion": "1",
  "app": { "id": "839285684", "name": "Workout for Women", "storefront": "us" },
  "reviews": [
    {
      "id": "review-1",
      "title": "Great workout",
      "body": "I love the variety of exercises.",
      "rating": 5,
      "version": "8.4.26",
      "updatedAt": "2026-07-01T10:00:00Z",
      "language": "en"
    }
  ]
}
```

### Fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | stable unique source id |
| `body` | yes | string | review text |
| `rating` | yes | integer 1–5 | |
| `updatedAt` | yes (JSON) | ISO 8601 / RFC 3339 datetime | must include a `Z` or `±HH:MM` timezone; in CSV this column is required too |
| `title` | no | string | |
| `version` | no | string | app version the review was filed against |
| `language` | no | string | display hint only; the app re-labels deterministically |

## CSV v1

Columns (header row required):

```csv
id,title,body,rating,version,updatedAt,language
review-1,Great workout,I love the variety of exercises.,5,8.4.26,2026-07-01T10:00:00Z,en
```

Required columns: `id`, `body`, `rating`, `updatedAt`. Unknown extra columns
are kept as warnings (never silently reinterpreted).

## Validation behavior

- Missing required column → error with the row/column identified.
- Invalid rating or unparseable date → row-level error; the offending row is
  excluded but valid rows in the same file are still analyzed.
- `updatedAt` is **required and must be a timezone-qualified ISO 8601 / RFC
  3339 datetime**: a blank value is a `missing updatedAt` row error, and
  anything that is not a full datetime with a `Z` or `±HH:MM` offset is an
  `invalid updatedAt` row error. Neither is silently treated as "no date" or
  silently "fixed" into a valid date.
  - Valid: `2026-07-01T10:00:00Z`, `2026-07-01T18:00:00+08:00` (the latter is
    normalized to UTC `2026-07-01T10:00:00.000Z`).
  - Invalid: `2026-02-30T10:00:00Z` (nonexistent calendar date), `01/02/2026`
    (localized date), `2026-07-01` (date-only), `2026-07-01T10:00:00` (no
    timezone).
  - An invalid row is excluded; valid rows in the same file are still analyzed.
- Unknown CSV columns are tolerated: each is warned exactly once
  (`CSV unknown column ignored: <name>`), never once per row, and its value
  never reaches the normalized review.
- Exact-content duplicates are deduplicated deterministically.
- Same `id` with conflicting body/rating → both rows are kept and flagged as
  `identity-conflict`.
- No fuzzy/embedding similarity is used anywhere.

## Import evidence

Every import persists the original file **byte-for-byte** at a fixed, safe
run-local path — `data/runs/<runId>/sources/import/input.json` for JSON and
`input.csv` for CSV — never a user-supplied filename. The user's original
filename appears only as evidence metadata. `rawRefs` in the `raw-reviews`
artifact point into that archived file (e.g. `sources/import/input.json#row-2`),
so the exact row that produced each review can always be re-read from the run
directory. The `source-evidence` artifact carries the full parse evidence:
original filename, MIME type, UTF-8 byte length, SHA-256 of the original file,
schema version, row-level errors/warnings, and duplicate/conflict indices. The
raw bodies are never exposed over the browser API.
