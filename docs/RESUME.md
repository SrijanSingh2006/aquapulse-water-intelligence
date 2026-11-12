# AquaPulse resume section

**AquaPulse — Industrial Water Intelligence**  
React · TypeScript · Cloudflare Workers · D1/SQLite · Python · scikit-learn  
[Live demo](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site) · [Source ZIP](https://aquapulse-water-intelligence.blondebiscuit2.chatgpt.site/aquapulse-source.zip)

Add the GitHub link after publication; repository creation is currently blocked by the connected integration's permissions. The GitHub Actions workflow is configured in the source, but no hosted CI run has been verified yet.

- Built and deployed a responsive React/TypeScript dashboard with REST APIs on Cloudflare Workers and D1/SQLite persistence for validated CSV ingestion, telemetry analysis and incident management.
- Trained Ridge regression and Isolation Forest models in Python/scikit-learn, exported them for TypeScript inference, and verified Python–TypeScript numerical parity on synthetic industrial-water telemetry.
- Implemented Population Stability Index (PSI) drift monitoring, sensor-data quality checks and Server-Sent Events (SSE) fault replay with explicit, idempotent dataset commits.
- Developed an exact constrained optimization engine that evaluates budget, crew hours and mutually exclusive interventions, maximizing modeled net value and exposing a cost–water Pareto frontier.
- Engineered atomic SQL transactions with optimistic concurrency control, idempotency receipts and SHA-256-linked audit events, including chain verification against the workspace head.
- Documented OpenAPI 3.1 APIs, added W3C trace context and Server-Timing, and configured GitHub Actions CI to run 66 Vitest tests, TypeScript checks, reproducible ML artifact validation and builds.

## Curated CSE/SDE keywords

**Software engineering:** React, TypeScript, REST API, Cloudflare Workers, D1, SQLite, SQL transactions, input validation, optimistic concurrency, idempotency, OpenAPI 3.1, Git, GitHub Actions, continuous integration (CI), Vitest, automated testing.

**AI/ML and algorithms:** Python, scikit-learn, Ridge regression, Isolation Forest, model inference, numerical parity, anomaly detection, Population Stability Index, data drift, data quality, exact constrained optimization, subset enumeration, Pareto frontier.

**Streaming and observability:** Server-Sent Events, SSE, Web Crypto API, SHA-256, audit-chain verification, W3C trace context, Server-Timing.

Use the keywords you can explain in an interview. The data and evaluation are synthetic, the intervention values are modeled assumptions, and audit verification is relative to the stored workspace head. The project is independent of Ecolab; Azure is a proposed extension, not the deployed host.
