# Demo and interview walkthrough

## A five-minute demonstration

1. **Explain the problem.** Industrial facilities have telemetry scattered across assets. This application collects readings, highlights unusual conditions and connects findings to a recorded follow-up action. It uses synthetic data and is independent of Ecolab.
2. **Inspect a facility.** Change the selected site and time range. Explain the units, consumption aggregation and healthy-demand comparison. Show that filtering changes the underlying dataset and charts.
3. **Inspect an abnormal reading.** Distinguish an Isolation Forest score from a probability. Show the observed operating values and explanatory drivers. A flagged observation is evidence to inspect, not proof of a leak.
4. **Review the forecast.** Explain Ridge regression, the production/time features and what assumptions stay fixed. Describe the band as an empirical uncertainty illustration if that is how the implementation computes it. It is not a promise of future water demand.
5. **Compare a scenario.** Change the assumptions and explain the equation. Separate hypothetical avoided volume/cost from measured savings.
6. **Complete a workflow.** Acknowledge an incident, add a useful note and resolve it. Reload to demonstrate SQL persistence. Use a separate browser profile to explain workspace isolation.
7. **Show the engineering.** Open validation, a migration, a meaningful test and the training script. Run the documented checks and show actual results.

For the streaming, monitoring, planning and audit features, use [the advanced recruiter demo](ADVANCED.md#a-six-minute-demonstration). Keep the demonstration focused: one changing fault, one constrained plan and one durable mutation are enough to explain the design.

## Step-by-step code reading

1. Start with `server/types.ts` and trace one reading through import, validation, storage and the dashboard.
2. Read the migration files. Identify primary keys, workspace ownership and indexes. Explain how a query stays scoped to a workspace.
3. Read the Worker routes and error handling. Trace a malformed import and a valid request.
4. Follow the exported model from `ml/train.py` to TypeScript inference. Explain which work happens offline and which happens per request.
5. Read the React state flow. Identify how a changed filter triggers a request and how loading/error/empty states work.
6. Read the tests and CI workflow. Describe what is verified and what remains outside test coverage.

## Questions to prepare

**Why this project for Ecolab?** Their public ECOLAB3D material connects Azure, industrial telemetry and AI/ML to water performance. CondenserIQ also describes predictions, alerts and action logs. This project applies related software ideas without claiming to reproduce their products. [Sources and caveats](company-fit.md).

**Why React and TypeScript?** A component-based UI supports reusable filters, charts and detail panels. Types make client/server contracts easier to maintain. Runtime validation is still necessary because TypeScript does not validate incoming JSON or CSV.

**Why SQL?** Readings, facilities, sessions and incident state have structured relationships and need reliable querying. Explain the chosen keys and indexes using the actual migration, not a hypothetical schema.

**Why Workers and D1?** They give this demo a deployed HTTP API and durable SQL without a separate VM. The tradeoffs include runtime constraints, provider-specific interfaces and the need to manage migrations/bindings. An Azure design would require real adaptation; it is documented as a proposal.

**Why export a Python model?** Python is useful for training and evaluation. A small exported artifact avoids a second runtime service for every inference request. The cost is maintaining mathematically equivalent inference, especially feature ordering, scaling, tree traversal and score thresholds. Parity tests should compare the same inputs against Python outputs.

**Why Ridge regression?** It offers a compact, interpretable baseline for healthy-demand estimation. Regularization stabilizes coefficients. Explain the actual features, fitting subset and baseline result from the generated model documentation.

**Why Isolation Forest?** It learns unusual multivariate patterns without requiring a classifier trained on real incident labels. It can flag harmless changes and miss faults that resemble normal data. A threshold and a score are not calibrated failure probabilities.

**How do you avoid leakage?** Split chronological data before fitting transforms/models; train only on the intended training subset. Set thresholds using the documented calibration strategy, not test labels. Reserve final held-out data for evaluation. For injected synthetic anomalies, explain how the generation process differs from real fault behavior. Quote only the split actually implemented by `ml/train.py`.

**What does the forecast assume?** Inspect the implemented feature construction. Future production or operating inputs that are held constant are assumptions, not observations. Changes in schedules, weather or maintenance can invalidate the forecast. Compare against the naive baseline and show the recorded held-out metrics.

**Are the explanations causal?** No. A driver can identify an unusual input or deviation from an expected range. It does not establish the physical root cause. Operational investigation and domain expertise would be needed.

**Why no chatbot?** Ecolab publicly uses generative AI, but this project's core problem has structured telemetry and measurable outputs. A fully working ingestion/ML/workflow system is defensible without an unconfigured LLM. A future assistant should retrieve source material, cite it, separate observations from advice and be evaluated for unsupported claims.

**What happens if two requests update an incident?** The update compares the workspace revision read by the request with the current SQL revision. Only one stale-snapshot contender succeeds. A unique write token gates its audit/receipt inserts inside the same D1 batch; a failed compare-and-swap gets `409` rather than silently replacing another change. Explain why this rejects a conflict instead of merging it.

**What does PSI tell you?** It compares feature distributions against a frozen healthy-training reference. It can reveal a changed input regime, but cannot establish prediction error or diagnose a leak. Explain binning, smoothing, the minimum sample count and why uploaded data does not update the reference.

**Why check stale or stuck telemetry separately?** A model can return a plausible answer for a frozen sensor. Gap, stale and repeated-value checks expose data-quality failures that a distribution score may miss. Explain the reference clock: historical replay must not appear fresh merely because the request arrived now.

**Why SSE?** The server sends progressive, one-way frames over HTTP, which suits a bounded replay without bidirectional commands. Explain event framing, completion, cancellation and the difference between receiving a frame and persisting it. WebSockets would add unnecessary session/protocol work for this interaction.

**Is the recovery plan globally optimal?** It is optimal for the bounded candidate combinations and the objective/constraints implemented by the exact search. It cannot prove that the assumptions are correct or that an unlisted intervention would not be better. Show a tighter budget or crew limit and explain the changed feasible set and selected result.

**Why both idempotency and concurrency control?** They solve different write problems. An idempotency receipt recognizes an already accepted retry. Revision compare-and-swap rejects a competing stale write. The SQL batch keeps workspace, audit event and receipt together; a key reused for a different payload is a conflict.

**Does a SHA-256 audit chain make the database immutable?** No. Recomputing and comparing the chain provides tamper evidence relative to a trusted head. An administrator who can rewrite the entire chain can replace it with another consistent history. External anchoring and stronger storage/access controls would be needed for independent verification.

**Does a trace ID mean distributed tracing is complete?** No. W3C trace context, request IDs and `Server-Timing` establish useful request metadata. A collector, cross-service instrumentation, retention and dashboards would be additional work. Point to the actual response headers and OpenAPI contract.

**Is the anonymous session secure login?** It is a demo workspace boundary using an opaque HttpOnly cookie. It does not verify identity. Production would need authentication, role-based authorization, secure session lifecycle, retention policies, rate limits, observability and a threat model.

**What scales first?** Discuss input volume limits, query filters/indexes, aggregation, pagination, background ingestion and model serving costs using the current implementation. Do not claim a throughput figure without a reproducible load test.

## Resume claims you can defend

- Implemented validated telemetry ingestion and SQL persistence through a typed HTTP API.
- Built an interactive React dashboard with anomaly inspection and incident state transitions.
- Trained and exported Ridge regression and Isolation Forest models and documented their synthetic-data evaluation.
- Added automated checks and a reproducible local setup.

Only claim completed features after verifying them. Add numeric results from actual model/test output with their synthetic-data qualifier. Avoid invented users, industrial deployment, achieved water savings or Ecolab affiliation.

## Extensions in a sensible order

1. Add authenticated users, organization membership and stronger tenant authorization.
2. Validate against consented, licensed real telemetry and domain-reviewed incident labels.
3. Extend bounded batch ingestion into authenticated device ingestion, background processing and paginated time-series storage.
4. Extend the frozen-reference monitoring with reviewed real labels, drift-response procedures, false-alert tracking and independently anchored audit heads.
5. Implement and test the proposed Azure architecture if that becomes a genuine project requirement.
