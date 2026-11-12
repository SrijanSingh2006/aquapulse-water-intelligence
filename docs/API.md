# API and data reference

The React app and Worker share an origin. JSON responses use `Cache-Control: no-store`. The service stores an isolated demonstration workspace, not a shared fleet database. The root implementation is in `server/service.ts`; runtime validation is in `server/validation.ts`.

## Workspace identity and persistence

In the supported hosted environment, a trusted `oai-authenticated-user-id` header selects a hashed user workspace when present. Otherwise the API creates an opaque UUID session in an `aquapulse_workspace` cookie. The cookie is HttpOnly, SameSite=Strict, scoped to `/`, expires after 30 days and receives the Secure flag on HTTPS.

This is demonstration identity, not a complete authentication system. An independent host must remove untrusted inbound identity headers before injecting its own verified identity. Without the hosted identity layer, the opaque cookie is the workspace credential. Clearing it or using another browser creates another workspace.

SQLite schema:

| Table / column | Meaning |
|---|---|
| `workspaces.id` | Primary key: hashed hosted identity or random anonymous session UUID |
| `workspaces.payload` | JSON snapshot containing readings, incidents and source label |
| `workspaces.revision` | Optimistic-concurrency counter |
| `workspaces.updated_at` | Last successful write timestamp |

The first request seeds a workspace with deterministic synthetic telemetry. Writes update the snapshot only when the stored revision still matches the loaded revision. A competing update receives `409`; reload and repeat the intended action. This prevents silent lost updates, but does not merge concurrent edits.

Snapshot storage is a deliberate small-demo choice: it keeps import/reset and incident state consistent in one bounded record. It rewrites the snapshot per mutation and does not offer efficient SQL time-series aggregation. A larger deployment should normalize telemetry, partition/index queries and process ingestion separately.

## Endpoints

| Method | Path | Request / response |
|---|---|---|
| GET | `/api/health` | `{ok, service, modelVersion}`. Does not initialize or validate the database. |
| GET | `/api/model` | Frozen model metrics, version, source and limitations. Requires a database binding. |
| GET | `/api/dashboard?siteId=all&hours=24` | Sites, filtered readings with analyses, incidents, dataset metadata, summary and 24-hour forecasts. |
| GET | `/api/export?siteId=all&hours=24` | CSV download for the same selected reading window. |
| POST | `/api/ingest` | `{"readings":[...]}`. Replaces this workspace's readings and regenerates incidents. Returns `{"accepted":N}`. |
| POST | `/api/incidents/:id` | `{"status":"acknowledged","note":"Inspect flow meter"}` or status `resolved`. Returns the updated incident. |
| POST | `/api/reset` | Send `{}` as JSON. Replaces workspace data and incidents with a new synthetic seed. Returns `{"ok":true}`. |

For dashboard/export, `siteId` is a configured site ID or `all`; `hours` is `24` or `168`. The window is relative to the selected dataset's latest timestamp, not the wall clock. “All sites” uses the latest selected timestamp as a common cutoff. Missing site data is not synthesized by the API.

All POST requests require `Content-Type: application/json`. Cross-origin/cross-site writes are rejected when the request's origin/fetch metadata identifies them. Request bodies larger than 2,000,000 bytes are rejected before JSON parsing. JSON/CSV ingestion is a bounded batch operation, not a live device-streaming integration.

## Reading schema and CSV

Use this exact column order for a portable CSV:

```csv
timestamp,siteId,assetId,flowM3h,conductivityUsCm,temperatureC,ph,productionIndex
```

| Field | Type / unit | Accepted range or rule |
|---|---|---|
| `timestamp` | ISO 8601 UTC hour | For example `2026-11-12T18:00:00Z` or `.000Z`; real calendar date, minute/second zero |
| `siteId` | String | Must match a configured site returned by `/api/dashboard` |
| `assetId` | String | Must be that site's configured asset ID |
| `flowM3h` | Number, m³/h | 0–250 inclusive |
| `conductivityUsCm` | Number, µS/cm | 10–15,000 inclusive |
| `temperatureC` | Number, °C | 0–80 inclusive |
| `ph` | Number, dimensionless | 0–14 inclusive |
| `productionIndex` | Number, relative operating index | 0–2 inclusive |

The API accepts 1–5,000 readings. Values must be finite numbers. Duplicate site/timestamp pairs are rejected. Each included site's readings must form consecutive hourly samples without gaps. Sites may be omitted, but a site cannot be relabeled with another asset. Input rows are sorted chronologically after validation.

Each flow reading represents average flow over `[timestamp, timestamp + 1 hour)`. Summing hourly flow values therefore gives an estimated volume in m³ for that complete hourly sequence. Do not treat instantaneous or irregularly sampled flow as equivalent input.

The simplest valid import is an exported CSV edited within these constraints. The browser converts CSV rows to the JSON reading schema before sending `/api/ingest`. Import **replaces** the workspace dataset; it does not append or deduplicate against previous data. Reset restores synthetic data, not the prior upload.

## Dashboard response

- `sites`: configured facility metadata and asset/baseline information.
- `readings`: selected rows with `analysis` containing score, anomaly flag, expected/excess flow, readable drivers and severity.
- `incidents`: site-scoped incidents, including resolved items. They represent grouped abnormal readings from each site's latest 24 samples when seeded/imported.
- `dataset.source`: `synthetic` or `uploaded`; `count` is the full workspace reading count, not the filtered result count.
- `summary.totalWaterM3`: sum of selected hourly flow values.
- `summary.expectedWaterM3`: sum of fitted healthy-demand estimates.
- `summary.excessWaterM3`: sum of positive observed-minus-expected deviations. This is not proved leakage or recoverable savings.
- `summary.activeAlerts`: incidents whose status is not resolved.
- `summary.healthPercent`: percentage of selected readings not flagged by the model. This is a model statistic, not a water-safety/compliance certificate.
- `summary.waterCostInr`: selected volume multiplied by the demo tariff of ₹65/m³.
- `forecasts`: per-site healthy-demand projections with empirical residual bands. Read [the model card](../ml/MODEL_CARD.md) before interpreting them.

An anomaly score is not a failure probability. Driver text and severity use transparent demo heuristics; they are not causal attributions or regulatory limits.

## Incident lifecycle

Supported transitions are `open → acknowledged`, `open → resolved` and `acknowledged → resolved`. Acknowledged items can receive an updated acknowledged note. Resolved incidents are immutable through this API. Every mutation needs an operator note containing 3–1,000 characters; leading/trailing whitespace is trimmed. Only the most recent note is stored, so this is incident follow-up state rather than an append-only audit trail.

## Errors

Errors are JSON: `{"error":"human-readable explanation"}`.

| Status | Meaning |
|---|---|
| 400 | Invalid JSON, query, reading, status or note |
| 403 | Cross-origin/cross-site write rejected |
| 404 | Unknown endpoint or incident |
| 405 | Unsupported HTTP method |
| 409 | Concurrent workspace change or mutation of a resolved incident |
| 413 | Request body exceeds 2 MB |
| 415 | POST body is not `application/json` |
| 500 | Unhandled service failure; internal details are not returned |
| 503 | Database binding missing or workspace initialization unavailable |

Health returning `ok` confirms only that the service handler responds; use a dashboard request to verify the database-backed application path.
