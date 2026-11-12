# AquaPulse model card

## Intended use

An educational SDE portfolio demonstration for exploring industrial-water telemetry. It estimates healthy water demand, ranks unusual sensor observations, and supports human investigation. It does not control pumps, chemical dosing, water safety, or production equipment. The synthetic sensor envelopes are demonstration assumptions and are not drinking-water, environmental-compliance, or Ecolab specifications.

No Ecolab code, proprietary data, customer records, or claimed Ecolab model is used. AquaPulse is independent of Ecolab.

## Reproduce

Use Python 3.11+ with `python -m pip install -r ml/requirements.txt`, then run `python ml/train.py` from the repository root. The generator and estimator seeds are `2027`. The pinned NumPy and scikit-learn versions are recorded in `requirements.txt`. `npm test` checks exported TypeScript inference against numerical fixtures produced by Python.

The training script writes these tracked artifacts:

- `model.json`: fitted Ridge coefficients, feature names, Isolation Forest tree structures, and calibrated threshold.
- `metrics.json`: synthetic held-out evaluation and split dates.
- `parity-fixtures.json`: Python reference outputs for seven normal/fault observations.
- `demo-readings.json`: deterministic seven-day dashboard data, ending 12 November 2026 at 18:00 UTC.

The Worker uses these frozen exports. It does not retrain on uploads or call a remote ML provider. No API key is required.

## Data and split

The generator creates 35 days of hourly telemetry for three invented sites (2,520 rows). It models production-dependent flow, daily thermal cycles, ordinary sensor noise, and injected excess-flow and conductivity/pH faults. Data generation is deliberately simple and does not establish industrial validity.

| Split | Rows | Time range (UTC) | Use |
| --- | ---: | --- | --- |
| Training | 1,512 | 8 Oct 2026 19:00–29 Oct 2026 18:00 | Fit both estimators on healthy data |
| Calibration | 504 | 29 Oct 2026 19:00–5 Nov 2026 18:00 | Choose threshold using labeled calibration faults; estimate residual band using normal rows |
| Test | 504 | 5 Nov 2026 19:00–12 Nov 2026 18:00 | Report evaluation |

The split is chronological. Feature extraction and estimator fitting use no future test target values. The Isolation Forest is unsupervised in fitting; its threshold uses the labeled calibration set to maximize calibration F1. This label-assisted calibration is explicit, and cannot be assumed available for real customer deployments. The synthetic generator, fault definitions, and demonstration model were selected together; the reported test is a reproducible benchmark, not an independent assessment of generalization.

## Healthy-demand regression

A scikit-learn Ridge regressor (`alpha=0.1`) predicts hourly flow from baseline flow, baseline × production index, baseline × sine/cosine of UTC hour, and baseline × temperature offset from 28 °C. This is an exogenous regression, not an autoregressive or deep-learning model. Healthy-demand expectations intentionally exclude observed flow so fault flow is not copied into the prediction.

On 471 **normal** test rows, with observed production and temperature:

- MAE: **0.4416 m³/h**.
- RMSE: **0.5641 m³/h**.
- Calibration absolute-residual radius: **1.0044 m³/h**.
- Held-out coverage of that band: **91.72%**, below its nominal 95% calibration quantile.

These numbers evaluate healthy-demand regression with known exogenous inputs. They are **not** results of a rolling 24-hour forecasting backtest. The dashboard projects future demand with the latest historical observation for each UTC hour of day. Missing hours fall back to the latest observation. Future production changes, temperature errors, shutdowns, and operational changes can materially worsen performance. The fixed residual band excludes uncertainty in those future assumptions, is not a guaranteed future confidence interval, and has no tested 24-hour coverage guarantee.

## Anomaly detector

A scikit-learn Isolation Forest has 48 trees, 128 maximum samples per tree, and seed 2027. Its features are normalized flow residual, conductivity, and pH. The regression residual uses the frozen fitted Ridge model. Larger isolation scores indicate less typical observations. A score is **not a probability of failure**.

The threshold is **0.608971**. On 504 synthetic test rows, including 33 injected faults:

- Precision: **70.21%**.
- Recall: **100.00%**.
- F1: **0.8250**.
- True positives: **33**; false positives: **14**; false negatives: **0**.

These faults are conspicuous by construction. A perfect recall here does not imply detection of real leaks, corrosion, contamination, or other failure modes. The false positives illustrate the need for operator review. Unknown faults, drift, noisy telemetry, intermittent faults, sensor calibration changes, and malicious inputs have not been independently evaluated.

TypeScript traverses the exported sklearn trees using float32 inputs and sklearn's average path-length approximation. Parity fixtures verify numeric agreement to 12 decimal places for the sampled records. This is export validation rather than a general proof across all possible inputs.

## Drivers, severity and scenarios

The displayed drivers use readable domain heuristics: excess flow over the healthy estimate, conductivity above 1,500 µS/cm, and pH outside 6.8–8.0. Severity uses excess-flow ratio and more extreme chemistry values. These are synthetic operating envelopes, not feature attributions, SHAP explanations, regulatory thresholds, or diagnostic findings.

What-if savings are arithmetic estimates based on a user-specified reduction and unit tariff. They are neither measured savings nor ML-optimized control recommendations. Operators must validate actions and site constraints before applying them.

## Deployment and limitations

The model fits known site baselines and unit conventions. The API validates configured site/asset identity. Supporting a new site requires a justified baseline, compatible units, representative historical data, validation, and model calibration. All sites share one synthetic model; there is no tenant-specific training. Predictions do not include water-quality compliance, equipment health certification, or autonomous decisions.

No LLM is part of this implementation. Predictive ML is used because the primary task is numeric telemetry analysis. This choice avoids an ungrounded chatbot and provides an inspectable, reproducible model suitable for interview discussion.

## Version 2: frozen-reference monitoring

`ml/reference.json` adds monitoring metadata without changing the fitted model, its predictions, its evaluation, or the original four JSON artifacts. `python ml/train.py` deterministically exports it from the **healthy training split only**. It contains the SHA-256 fingerprint of the exact `ml/model.json` bytes, model version, synthetic-data provenance, training period, and fixed global/per-site feature histograms. The model fingerprint is provenance evidence for the loaded artifact; it is not a signature, security attestation, or an independent approval of the model.

The five monitored features are:

1. `(observed flow − frozen Ridge expected flow) / configured site baseline flow`.
2. Conductivity in µS/cm.
3. pH.
4. Production index.
5. Temperature in °C.

Each histogram uses training decile boundaries, with open-ended first/last bins. The global reference has 1,512 healthy training rows; each configured site's reference has 504. Single-site views use their corresponding site reference, while the all-site view uses the combined reference. Changes in site composition can affect combined-population comparisons.

The Population Stability Index (PSI) is calculated from the reference and current marginal proportions:

```text
pᵢ = (reference proportionᵢ + ε) / (1 + ε × number of bins)
qᵢ = (current proportionᵢ + ε) / (1 + ε × number of bins)
PSI = Σ (qᵢ − pᵢ) × ln(qᵢ / pᵢ)
ε = 0.0001
```

At least **30 distinct, usable observations per feature** are required. Below that minimum, the feature has a `null` PSI and `insufficient_data` status. An empty or short dataset cannot be called stable. At or above that minimum, the descriptive thresholds are PSI `<0.10` stable, `<0.25` watch, and otherwise shifted. The overall status is insufficient if any feature lacks enough data; otherwise it is the most severe feature status.

These thresholds and the sample minimum are **heuristics**, not statistical significance tests or confidence levels. Thirty observations can still produce unstable histograms. PSI measures marginal input-distribution differences; it does not measure model accuracy, conditional drift, root cause, or a probability of equipment failure. Stable marginals can conceal joint-distribution shifts. Real production schedules, seasons, changes in site mix, and steady operation can cause distribution differences. Uploaded telemetry is never used to update this reference or fit the model. Fault labels, including test labels, are not used in monitoring.

## Version 2: telemetry quality rules

The quality report evaluates actual input observations within `(dataset clock − requested hours, dataset clock]`, for the configured sites in scope. The service supplies the latest timestamp from the complete workspace as the dataset clock, so a selected site can lag other sites. Historical replay is not compared with today's wall clock, and dataset freshness does not establish a live-sensor connection.

- **Completeness:** expected observations are one sample per UTC hour per configured site. A 24-hour all-site scope therefore expects 72 site-hour observations. `missingHours` counts missing **site-hours**, including missing sites. The report enumerates actual missing slots and longest gaps per site. It never fills gaps or marks unobserved intervals healthy.
- **Duplicates:** additional rows at the same configured site and normalized timestamp are counted and excluded from drift/completeness calculations. Duplicates cannot satisfy the 30-observation minimum.
- **Invalid and off-grid observations:** malformed timestamps, unknown site/asset combinations, non-finite sensor values, and samples that do not align with an exact UTC hour are counted and excluded. The public ingestion API also applies its ordinary validation rules before storing data.
- **Staleness:** a site is flagged if no usable observation exists in the window or its latest observation is more than one hour behind the supplied dataset clock.
- **Possible stuck signals:** each sensor is checked separately within each site. A run requires at least **six elapsed hours**, meaning seven consecutive hourly samples. The full run's maximum-minus-minimum sensor range must stay within its tolerance; overlapping candidate windows are retained. Tolerances are 0.01 m³/h flow, 1 µS/cm conductivity, 0.01 °C temperature, 0.001 pH, and 0.001 production index. Missing hours break the run. A flag requests investigation; a legitimate steady operating condition can also produce constant readings.

The displayed quality score is an explicit operational heuristic:

```text
clamp(completeness percentage
      − percentage of duplicate/invalid/off-grid scoped input rows
      − 20 × (flagged sensor/site combinations / expected sensor/site combinations),
      0, 100)
```

It is not a calibrated probability, certification, or measurement of every possible data-quality dimension. It does not assess sensor calibration accuracy or process safety. Completeness and quality are shown separately from drift so users can inspect the cause rather than relying on a single score.

`tests/insights.test.ts` verifies matching versus shifted distributions, model fingerprint integrity, minimum-sample handling, missing hourly observations, duplicates, staleness relative to the dataset clock, stuck runs that break at gaps, off-grid/non-finite exclusions, scope boundaries, and absence of mutation. These are deterministic software checks; they do not validate industrial performance.
