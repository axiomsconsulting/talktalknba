## Goal

Add a hidden `/analysis` page (no sidebar entry) that gives a frank, evidence-based answer to:
1. Is the current data clean and trustworthy?
2. What's missing for a best-in-class retention/churn system?
3. What's unnecessary?
4. What time windows are needed?
5. Where do real-time vs batch and feedback loops fit?

The page renders charts driven by the actual sample data already in `out/`, plus a downloadable Jupyter notebook (`talktalk_data_quality.ipynb`) that re-runs the same checks on full data.

---

## What the data audit already shows (driven into the page)

From the 50-customer sample (`out/lovable_sample_*.csv`) and offline artefacts:

**Coverage & shape**
- 4 tables: `customer_info` (monthly snapshot, 2022-08 → 2024-09), `usage` (daily Mb), `calls` (event-level, 7 call types), `cease` (terminations).
- 1.04M High-risk + 1.24M Medium + 1.26M Low (3.55M base) per `segment_risk_summary.csv`.

**Cleanliness issues found**
- `line_speed = 0` on 4.8% of rows (56/1157) — used as a feature; needs imputation flag.
- `usage_download_mbs` typed `VARCHAR` in full schema vs `DOUBLE` in sample — type drift between MotherDuck and parquet snapshot.
- 6 calls have `call_type = NULL` (3.1%); 71% of cease reasons are "VagueReason" — limits root-cause learning.
- `cease_completed_date` stored as VARCHAR in full schema (date drift).
- `dd_cancel_60_day` is BIGINT in full schema, INTEGER in sample.

**Missing for best-in-class retention**
- No billing/ARPU table (ARPU is currently inferred from package name → fragile).
- No NPS / CSAT / complaint sentiment.
- No outage / network incident feed (would explain Tech calls).
- No marketing exposure (campaigns, inbound web visits, app opens).
- No competitor pricing signal (Openreach altnet build, Sky/BT promo windows).
- No save-desk outcome history (offer accepted? what discount? retained 90d?) — blocks the feedback loop.
- No payment failures beyond `dd_cancel_60_day` (e.g. retry attempts, balance ageing).
- No household / address-level signals (multi-line, mover flag).

**Unnecessary / low signal (per `feature_importance.json`)**
- `technology`, `sales_channel`, `crm_package_name`, `contract_status` all have importance = 0.0 in the trained XGBoost. Either drop, or one-hot expand and retrain (currently passed as raw strings).
- `avg_upload_mbs` (2.3%) and `avg_download_mbs` (1.9%) are weak vs `tenure_days` (31%) and `contract_dd_cancels` (19%).

**Time windows needed**
- Tenure & contract: snapshot daily (already monthly — too coarse for OOC trigger which has a 30-day decision window).
- Usage: rolling 7/30/90-day deltas (currently averaged, losing the decay signal).
- Calls: 14/30/90-day windows by `call_type` (Tech spike → engineer NBA, Loyalty spike → save offer).
- Cease: 24-month label horizon is fine; for early-warning add 30/60/90-day cease as separate labels.

**Real-time vs batch**
- Real-time (event stream): inbound calls, payment failures, speed test results, support chat sentiment → trigger NBA within minutes.
- Near-real-time (hourly): usage anomalies, OOC threshold crossings.
- Batch (daily): churn re-score, segment refresh.
- Batch (weekly): model drift check, feature importance recompute.

**Feedback loops missing**
- Offer outcome → retained/churned at 30/90/180 days → reinforcement signal back into NBA selection.
- Counterfactual logging (which customers got no contact, control group) → uplift modelling instead of pure churn prob.
- Drift monitor on PSI between training distribution and live MotherDuck pulls.

**Trust assessment**
- Model AUC 0.868 / recall 0.85 looks strong **but** segment metrics show recall collapses to 0.65 for 48m+ tenure (the largest segment, 488K customers) — model is over-trusting tenure. Calibration plot needed.
- 71% vague cease reasons means the "why churn" signal feeding NBA mapping is noisy.

---

## Build plan

### 1. New hidden route `src/routes/analysis.tsx`
- Not added to `AppSidebar` `NAV_ITEMS` → reachable only by URL.
- Auth-gated like other internal routes (uses existing `AuthGate` via `__root.tsx`).
- Layout: PageHeader + 6 sections (Coverage, Cleanliness, Missing data, Unnecessary, Time windows & real-time, Feedback loops & trust).

### 2. Charts (using existing `recharts` already in `package.json`)
- **Null & type drift heatmap** (BarChart): null % per column per table.
- **Date coverage timeline** (BarChart, horizontal): min/max date per table to show snapshot lag.
- **Cease reason distribution** (PieChart): exposes the 71% "VagueReason" problem.
- **Call-type frequency** (BarChart): Tech / CS&B / Loyalty volumes.
- **Feature importance vs information value** (BarChart): reads `out/feature_importance.json`.
- **Segment recall gap** (BarChart): bars per tenure bucket from `model_metrics.json` segment_metrics.
- **Risk-tier base sizing** (BarChart, stacked): from `segment_risk_summary.csv`.

All chart data is committed as a static JSON in `src/data/analysisAudit.json` (pre-computed from the sample CSVs) — no runtime DuckDB needed.

### 3. Downloadable notebook
- Generate `public/talktalk_data_quality.ipynb` that, when run locally against the user's data folder, reproduces every chart and adds:
  - Missingness matrix (`missingno`)
  - Outlier detection on `usage_download_mbs`
  - Stationarity / drift test (PSI) between two date windows
  - Label leakage check (any feature post-dating cease date)
  - Calibration curve for the XGBoost model
- Page exposes a "Download notebook" button that links to `/talktalk_data_quality.ipynb`.

### 4. Narrative cards
Each section has a short verdict ("✅ Trustable / ⚠️ Caveat / ❌ Gap") with the concrete number from the audit, so a non-technical reader can scan it.

---

## Files to create / edit

**Create**
- `src/routes/analysis.tsx` — the hidden page.
- `src/data/analysisAudit.json` — pre-computed audit numbers + chart series.
- `public/talktalk_data_quality.ipynb` — downloadable notebook.
- `src/components/AuditVerdictCard.tsx` — small reusable verdict card.

**Edit**
- None to existing nav (keeps it hidden).

---

## Out of scope (for this plan)

- Building the actual real-time event bus or feedback loop pipelines — this page documents the gap and recommendation; implementation would be follow-up work.
- Re-training the model to drop zero-importance features — flagged on the page as a recommendation.

## Summary
Add hidden `/analysis` page with 7 evidence-based charts (driven by the sample CSVs and model artefacts), a verdict per data-quality dimension, and a downloadable Jupyter notebook for re-running the audit on full data.