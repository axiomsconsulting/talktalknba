## Deliverables

Three artifacts written to `/mnt/documents/`:

1. **`TalkTalk_Retention_NBA.pptx`** — 18-slide deck, Midnight Executive palette (`#1E2761`, `#CADCFC`, `#FFFFFF`, `#F96167`).
2. **`TalkTalk_Retention_NBA.pdf`** — same deck rendered to PDF via LibreOffice.
3. **`TalkTalk_Retention_QA.docx`** + **`TalkTalk_Retention_QA.pdf`** — standalone Q&A study doc.

All content derived from the actual model artefacts (`model_metrics.json`, `segment_risk_summary.csv`, `feature_importance.csv`, `nba_roi_params.json`, `top_50_customers.json`) and the in-app modules (Explainability, Net ROI, NBA rules, MotherDuck live data).

---

## Slide flow (10 minutes ≈ 30s/slide)

| # | Slide | Talk track focus |
|---|---|---|
| 1 | **Title** — "Prioritising Retention with a Churn-Risk + NBA engine" | Audience, presenter, date |
| 2 | **The business ask** | UK Telecoms wants to focus retention spend on customers most likely to cease |
| 3 | **TL;DR** (3 big stat cards) | 1.04M high-risk customers · £438M revenue at risk · ROC-AUC 0.868 |
| 4 | **Approach overview** (4-step diagram) | Data → Model → Risk tiers → Next Best Action |
| 5 | **The data** | 3.55M customers, 4 sources (customer_info / calls / cease / usage), DuckDB/MotherDuck pipeline |
| 6 | **Feature engineering** | Tenure, OOC days, DD cancels, speed deficit, loyalty calls, hold time, usage vs package |
| 7 | **Model choice & training** | XGBoost (binary:logistic), 600 trees, depth 6, LR 0.05, 2.66M train / 0.89M test, threshold 0.41 |
| 8 | **Performance** (metrics table) | Accuracy 0.78 · Precision 0.73 · Recall 0.85 · F1 0.79 · **ROC-AUC 0.868** |
| 9 | **ROC curve & confusion matrix** | Visual chart from `roc_curve` data; TP 357k, FP 130k, FN 64k, TN 335k |
| 10 | **Top drivers** (horizontal bar) | tenure_days 0.31, contract_dd_cancels 0.19, dd_cancel_60_day 0.14, ooc_days 0.09, talk/hold time |
| 11 | **Risk segmentation** | High 1.04M (score 0.82) · Medium 1.24M (0.51) · Low 1.26M (0.16) — dominant package Fibre 65 |
| 12 | **From risk → action: the NBA matrix** | 6 treatments (Save desk, Free tech upgrade, Right-size, Competitor match, Nurture, Suppress) mapped to risk × context |
| 13 | **Worked example: one customer** | Score 0.84 → High → OOC 142d + 2 loyalty calls → Loyalty Save Desk, 20% / 24-mo |
| 14 | **ROI model** | Gross retained − discount dilution − cost-to-serve = Net retained; tier-based LTV horizon |
| 15 | **Projected outcome** | Contact only the high-risk 1.04M (vs 3.55M base) → est. saves & net £ from current rule mix |
| 16 | **The product: live decisioning app** | Dashboard, Explainability, NBA Rules, ROI sim, MotherDuck live source, filter presets |
| 17 | **Roadmap & risks** | Drift monitoring, A/B holdout, fairness checks, channel capacity, retraining cadence |
| 18 | **Thank you / Q&A** | Contact + repo links |

Each slide uses the Midnight Executive palette: navy backgrounds for title/closing, light cards on white for content, coral (`#F96167`) reserved for the headline number or active risk tier.

Visual elements: bar/donut/ROC charts rendered with chart libraries, icon callouts, pull-quote stat blocks (no plain bullet decks).

---

## Q&A Document (separate DOCX + PDF)

Two sections, ~4-6 pages total.

**A. Technical Q&A (data science manager / DS team)**
- Why XGBoost over Random Forest / Logistic Regression? (reference earlier RF benchmark in `model_training_stats.json`)
- How was the decision threshold (0.41) chosen?
- How do you handle class imbalance? (subsample 0.8, scale_pos_weight implicit via threshold tuning)
- Feature leakage checks (cease label vs cease-derived features)
- Why tree_method=hist with 600 estimators / depth 6
- Calibration & probability interpretation (Platt / isotonic future work)
- SHAP-style local explanations vs gain-based feature importance
- Segment-level performance: 0-12m precision 0.84/recall 0.99 vs 48m+ precision 0.66/recall 0.65 — implications
- Drift monitoring & retraining cadence
- Edge-runtime constraint that pushed training to local Python + JSON ingest
- Live data path: MotherDuck → introspected schema → `search-motherduck` / `facets-motherduck` endpoints
- ROI math: `gross − dilution − cost`, tier LTV via `12 / annual_churn`

**B. General / business Q&A (CDO, Head of Data & AI, Data Manager)**
- "Why these features and not others (e.g. NPS, complaints)?"
- "How do we know the model isn't biased against long-tenure customers?"
- "What's the contact capacity and how does that constrain the daily list?"
- "Cost of false positives vs false negatives in £"
- "How quickly can we re-train if a campaign changes behaviour?"
- "What governance is in place for the offer rules?" (NBA rules store, audit trail)
- "Privacy / PII handling, RLS on the app"
- "What would it take to extend this to acquisition or cross-sell?"
- "How does this compare to a propensity-only baseline?"
- "Roadmap: holdout A/B, uplift modelling, fairness audit"

Each Q has a concise 3-6 sentence answer with concrete numbers from the artefacts.

---

## Implementation

1. Build the deck with `pptxgenjs` (Node) — embed all images as base64, use the Midnight Executive palette, vary layouts (title / 2-column / stat row / chart-left + text-right / matrix grid).
2. Convert PPTX → PDF with LibreOffice (`run_libreoffice.py --headless --convert-to pdf`).
3. Build DOCX with `docx` (Node) — Arial body, navy headings, two H1 sections, Q in bold + A as paragraph.
4. Convert DOCX → PDF the same way.
5. **Mandatory QA:** render every slide and every PDF page to JPG (`pdftoppm -jpeg -r 150`), inspect each, fix any overflow / overlap / contrast issues, re-render. Report findings.
6. Emit `<lov-artifact>` tags for all four files.

Total expected runtime: ~3-5 minutes including QA cycles.