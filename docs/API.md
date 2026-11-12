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
| `workspaces.last_write_id` | Unique token joining a successful compare-and-swap to its conditional audit/receipt inserts |
| `audit_events` | Workspace-scoped event sequence and event JSON, including previous/current hashes computed from canonical JSON |
| `request_receipts` | Workspace/key-scoped request hash and saved response for an accepted idempotent write |

The first workspace-backed request seeds deterministic synthetic telemetry. Writes update the snapshot only when the stored revision still matches the loaded revision. A D1 batch atomically updates the snapshot, conditionally appends its audit event and stores an optional idempotency receipt. The conditional inserts use the unique write token, so a failed compare-and-swap cannot append an event. A competing update receives `409`; reload and repeat the intended action. This prevents silent lost updates, but does not merge concurrent edits. The demo permits at most 1,000 audited writes per workspace.

Snapshot storage is a deliberate small-demo choice: it keeps import/reset and incident state consistent in one bounded record. It rewrites the snapshot per mutation and does not offer efficient SQL time-series aggregation. A larger deployment should normalize telemetry, partition/index queries and process ingestion separately.

## Endpoints

| Method | Path | Request / response |
|---|---|---|
| GET | `/api/health` | `{ok, service, version, modelVersion, database}`. Checks the workspace, audit and receipt tables; returns 503 when binding/schema is unavailable. Does not seed data. |
| GET | `/api/openapi.json` | OpenAPI 3.1 description. Available without a database binding. |
| GET | `/api/model` | Frozen model metrics, version, source and limitations. Requires a database binding. |
| GET | `/api/dashboard?siteId=all&hours=24` | Sites, filtered readings with analyses, incidents, dataset metadata, summary and 24-hour forecasts. |
| GET | `/api/export?siteId=all&hours=24` | CSV download for the same selected reading window. |
| GET | `/api/assurance?siteId=all&hours=168` | Frozen-reference PSI features, completeness/gap/stale/stuck checks and interpretation. |
| POST | `/api/planner` | Planner parameters described below; returns candidates, selected IDs, summary, Pareto frontier, algorithm counts and assumptions. Does not mutate the workspace. |
| GET | `/api/replay?siteId=all&scenario=leak&steps=24` | SSE preview with `reading` events followed by `complete`. Does not mutate the workspace. |
| POST | `/api/replay/commit` | `{"readings":[...],"scenario":"leak"}` plus required `Idempotency-Key`; replaces readings, regenerates incidents and records a replay audit event. |
| GET | `/api/audit` | Workspace events in sequence, chain integrity result and legacy-history note. |
| POST | `/api/ingest` | `{"readings":[...]}`. Replaces this workspace's readings and regenerates incidents. Returns `{"accepted":N}`. |
| POST | `/api/incidents/:id` | `{"status":"acknowledged","note":"Inspect flow meter"}` or status `resolved`. Returns the updated incident. |
| POST | `/api/reset` | Send `{}` as JSON. Restores synthetic readings/incidents, preserves audit history and adds a reset event. Returns `{"ok":true}`. |

For dashboard/export, `siteId` is a configured site ID or `all`; `hours` is `24` or `168`. The window is relative to the selected dataset's latest timestamp, not the wall clock. “All sites” uses the latest selected timestamp as a common cutoff. Missing site data is not synthesized by the API.

All POST requests require `Content-Type: application/json` and a JSON object. Cross-origin/cross-site writes are rejected when the request's origin/fetch metadata identifies them. Request bodies larger than 2,000,000 bytes are rejected before JSON parsing. JSON/CSV ingestion is a bounded batch operation, not a live device-streaming integration.

## Advanced requests

`POST /api/planner` accepts:

```json
{"budgetInr":15000,"crewHours":8,"tariffInrM3":65,"horizonDays":30,"siteId":"all"}
```

`budgetInr` is 0–1,000,000; `crewHours` is 0–100; `tariffInrM3` is 0–10,000; `horizonDays` is an integer 1–365. All are finite numbers. `siteId` defaults to `all` and can be a configured site ID. The exact search maximizes modeled horizon water value minus intervention cost under the budget, crew and one-action-per-site constraints. See [planning assumptions](ADVANCED.md#constrained-recovery-planning) before interpreting the output.

Replay `scenario` is `healthy`, `leak` or `sensor_drift`; `steps` is an integer 1–48, default 24. Every step creates one future hourly reading per selected site. The service sends one frame about every 100 ms, so streaming time is compressed relative to modeled time. The selected sites must all have source readings. Missing operating-profile hours fall back to the latest available record.

```text
id: 1
event: reading
data: {"sequence":1,"reading":{...},"analysis":{...}}

event: complete
data: {"count":72,"scenario":"leak"}
```

The example count of 72 means 24 steps for all three sites. A stopped/disconnected stream is a preview, not a partial database write. No resumable event history or `Last-Event-ID` replay is implemented. Committing sends the chosen reading array and scenario explicitly; it replaces the workspace dataset, rather than appending the streamed frames.

`GET /api/assurance` accepts the same `siteId` and `hours` values as dashboard/export. It evaluates the requested scope against the **global dataset clock**, preserving site-lag visibility. A single-site 24-hour window is below the 30-observation PSI minimum. Missing observations are not filled.

## Idempotency and audit

`Idempotency-Key` is required on replay commits and optional on `/api/ingest`. Use 8–100 letters, digits, colons, underscores or hyphens, for example `replay-leak-20261113-01`. It is not supported as a retry contract on incident updates or reset.

The receipt key is scoped to the workspace. Its request hash includes the endpoint path and canonical JSON body, so object-key order does not create a different request. A repeated accepted request returns its saved response with status `200` and `Idempotency-Replayed: true`, without another mutation/audit event. Reusing that key for a different path or body returns `409`. Simultaneous identical retries can recover the first accepted receipt after the revision conflict.

Audit history is separate from the incident's current note. Events include ID, sequence, timestamp, type, entity ID, note, metadata, preceding hash and current hash. `/api/audit` recomputes every hash and checks ordering/count/head against the workspace snapshot. Only actions after the operations upgrade are recorded. Reset preserves history; it does not erase or restart the chain.

The application appends events; it does not expose an update/delete-audit route. Hash-chain verification is tamper evidence relative to a trusted workspace head, not a guarantee against an administrator rewriting the database and head together. See [write integrity](ADVANCED.md#atomic-writes-and-audit-integrity).

## Request observability

API responses include `X-Request-Id`, a W3C version-00 `traceparent` and `Server-Timing: app;dur=...`. A valid lowercase incoming trace ID is retained while a new span ID is generated; invalid or all-zero context causes a new trace. Timings measure handler/setup duration. For SSE, they do not include the duration of the entire response stream.

Request logs contain request/trace IDs, method, path, response status and duration, without intentionally logging telemetry, notes, identities or request bodies. These fields support correlation; a distributed trace collector/dashboard is not deployed by this repository.

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
- `dataset.source`: `synthetic`, `uploaded` or `replay`; `count` is the full workspace reading count, not the filtered result count.
- `summary.totalWaterM3`: sum of selected hourly flow values.
- `summary.expectedWaterM3`: sum of fitted healthy-demand estimates.
- `summary.excessWaterM3`: sum of positive observed-minus-expected deviations. This is not proved leakage or recoverable savings.
- `summary.activeAlerts`: incidents whose status is not resolved.
- `summary.healthPercent`: percentage of selected readings not flagged by the model. This is a model statistic, not a water-safety/compliance certificate.
- `summary.waterCostInr`: selected volume multiplied by the demo tariff of ₹65/m³.
- `forecasts`: per-site healthy-demand projections with empirical residual bands. Read [the model card](../ml/MODEL_CARD.md) before interpreting them.

An anomaly score is not a failure probability. Driver text and severity use transparent demo heuristics; they are not causal attributions or regulatory limits.

## Incident lifecycle

Supported transitions are `open → acknowledged`, `open → resolved` and `acknowledged → resolved`. Acknowledged items can receive an updated acknowledged note. Resolved incidents are immutable through this API. Every mutation needs an operator note containing 3–1,000 characters; leading/trailing whitespace is trimmed. The incident stores the most recent note. The separate `audit_events` history records accepted changes through the application's append-only write path.

## Errors

Errors are JSON: `{"error":"human-readable explanation"}`.

| Status | Meaning |
|---|---|
| 400 | Invalid JSON, query, reading, status or note |
| 403 | Cross-origin/cross-site write rejected |
| 404 | Unknown endpoint or incident |
| 405 | Unsupported HTTP method |
| 409 | Concurrent workspace change, resolved-incident mutation, conflicting idempotency key or audited-write limit reached |
| 413 | Request body exceeds 2 MB |
| 415 | POST body is not `application/json` |
| 500 | Unhandled service failure; internal details are not returned |
| 503 | Database binding missing or workspace initialization unavailable |

Health checks database binding/schema readiness without seeding a workspace. Use a dashboard request to verify the complete data and inference path.
