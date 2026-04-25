## Goal

Add a new Jupyter notebook `code/app_replica.ipynb` that reproduces, in pure Python, every visual, statistic, and customer-level output the TalkTalk NBA app shows — including a customer-lookup cell that takes a `unique_customer_identifier` and prints the same profile / SHAP / NBA / financial breakdown that the in-app drawer displays.

It sits alongside `train.ipynb`, `score_top50.ipynb`, `score_offline_offers.ipynb` and reads the same local artefacts (`model_metrics.json`, `feature_importance.csv`, `nba_roi_params.json`, `top_50_customers.json`, `model_artefact.pkl`, `lovable_sample_*.csv`, `segment_risk_summary.csv`).

## Notebook structure

The notebook is organised page-by-page so a reader can map a section back to the corresponding screen in the app.

```text
0. Setup & data loading
1. ROI & Exec Summary    (mirrors / )
2. Strategy & Pipeline   (mirrors /strategy)
3. Model Evaluation      (mirrors /model)
4. Explainability        (mirrors /explainability)
5. NBA Rules             (mirrors /nba-rules)
6. Customer Lookup       (drawer-equivalent for any customer_id)
7. Top-50 most impacted  (mirrors the live table)
```

### 0. Setup
- Import `pandas`, `numpy`, `matplotlib`, `seaborn`, `json`, `pickle`, `pathlib`.
- Load all artefacts from `./` (same folder as the other notebooks).
- Helper `fmt_gbp`, `fmt_pct`, `fmt_int` matching the app's formatting.
- Re-implement the scoring functions from `src/data/scoring.ts` in Python (`score_customer`, `tier_from_score`, `derive_nba_trigger`, `normalise_contract`) so customer lookup produces byte-identical SHAP contributions, risk tier and NBA trigger.

### 1. ROI & Exec Summary
- KPI table: total customer base, high-risk volume, baseline conversion, average ARPU, revenue-at-risk, projected saved revenue at default 18% success rate (formulas from `src/routes/index.tsx` and `nba_roi_params.json`).
- Pie chart: risk-tier mix (High / Medium / Low) from `segment_risk_summary.csv`.
- Bar chart: net ROI per NBA trigger using rule contact-cost × saves × LTV (mirrors `RoiSimulator` + `PerTriggerSensitivityPanel`).
- Line chart: net ROI sensitivity to success-rate sweep (10% → 35%).
- Stacked bar: Net ROI segment drilldown by contract status, tenure bucket, and risk tier (mirrors `NetRoiSegmentDrilldown`).

### 2. Strategy & Pipeline
- Markdown rendering of the 5 pipeline stages and an ASCII pipeline diagram.
- Treatment matrix table: Risk × Contract status → NBA trigger, channel, offer (from `treatmentMatrix` in `src/data/nba.ts`).

### 3. Model Evaluation
- Hyperparameter table + dataset split.
- Performance metrics bar chart (Accuracy / Precision / Recall / F1 / ROC-AUC) with the 0.41 threshold annotation.
- Confusion matrix heatmap (TP/FP/FN/TN) with row %.
- ROC curve from `model_metrics.json["roc_curve"]` with operating-point dot at threshold 0.41.
- Per-segment precision/recall bars from `segment_metrics`.

### 4. Explainability
- Global feature importance bar chart from `feature_importance.csv`.
- Distribution plots: tenure_days, ooc_days, contract_dd_cancels coloured by risk tier (sample data).
- "Local explanation" cell: pick the first customer from `top_50_customers.json`, render a horizontal bar chart of their top SHAP contributions and the narrative (`why_this_customer`, `why_this_nba`).

### 5. NBA Rules
- Rendered table of NBA triggers from `src/data/customers.ts` (label, channel, offer, contact cost, success rate, expected save).
- Bar chart: expected save GBP per trigger.

### 6. Customer Lookup (the drawer in Python)
A single parameterised cell:

```python
CUSTOMER_ID = "abc-123"   # ← edit and re-run
profile = lookup_customer(CUSTOMER_ID)
render_customer_profile(profile)
```

`lookup_customer` searches `lovable_sample_customer_info.csv` (and joins `calls`, `usage`, `cease`) for the id, builds the `ScoringInput`, runs the Python `score_customer`, and returns the same shape the in-app drawer renders.

`render_customer_profile` prints/plots:
- Header: ID, package, tenure, contract status, region.
- KPI strip: risk score, risk tier, expected save (GBP), recommended NBA, channel, offer.
- SHAP horizontal bar chart of top 6 contributions with sign-coloured bars and the `detail` text alongside.
- Behavioural signals table (loyalty calls 90d, hold seconds, talk seconds, monthly download/upload, sold vs line speed, OOC days).
- "Why this customer" + "Why this NBA" narrative blocks.
- Recent calls and usage timeline plots if data exists for that id.

If the id is not in the local sample, the cell falls back to `top_50_customers.json` so the cell still demonstrates the format end-to-end.

### 7. Top-50 most impacted
- Table view of `top_50_customers.json` (rank, id, churn_prob, recommended_nba, expected_save_gbp).
- Bar chart of expected save by trigger, summed across the 50.
- Histogram of churn probabilities.

## Technical details

- Pure Python, no app or Lovable Cloud calls — runs offline like the existing notebooks.
- Charts use matplotlib only (no extra installs) so the kernel works with the existing `pip install pandas pyarrow scikit-learn xgboost numpy [shap]` from `code/README tt.md`.
- The Python re-implementation of `scoreCustomer` lives in a single notebook cell (clearly commented as the mirror of `src/data/scoring.ts`); risk-tier thresholds, base score 0.5, all impact weights and the NBA trigger rules are copied 1:1.
- `lovable_sample_customer_info.csv` may not contain enrichments (loyalty calls, usage, cease insight) — the lookup uses `0` defaults exactly like `scoreCustomer` does so output stays consistent with the app.
- Dataset volumes for the ROI charts come from `nba_roi_params.json` so the Python figures match the dashboard at the same scenario inputs.
- README block at the top of the notebook lists every artefact it reads and which app screen each section reproduces.

## Files

- create `code/app_replica.ipynb`
