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
| `updatedAt` | yes (JSON) | ISO 8601 | in CSV this column is required too |
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
- Invalid rating or unparseable date → row-level error.
- Exact-content duplicates are deduplicated deterministically.
- Same `id` with conflicting body/rating → both rows are kept and flagged as
  `identity-conflict`.
- No fuzzy/embedding similarity is used anywhere.

## Import evidence

Every import persists the original file (name, MIME type, byte length,
SHA-256), the parse report, and row-level warnings/errors alongside the run
snapshot under `data/runs/<runId>/sources/import/`.
