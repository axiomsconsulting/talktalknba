# TalkTalk NBA — Offline training kit

Two scripts that run on your laptop in VS Code. Lovable provides the data
and accepts the results back.

## One-time setup

```
pip install pandas pyarrow scikit-learn xgboost numpy
# optional, for richer reason codes:
pip install shap
```

## Workflow

1. **Get the data.** In Lovable → Model page → External training kit, click each
   signed download link. Save the four files into `./data/`:
   - `customer_info.parquet` (or `.csv`)
   - `calls.csv`
   - `cease.csv`
   - `usage.parquet` (or `.csv`)

2. **Train.** `python train.py` — produces `./out/model_metrics.json`,
   `./out/model_artefact.pkl`, `./out/feature_importance.csv`.

3. **Score top 50.** `python score_top50.py` — produces
   `./out/top_50_customers.json`.

4. **Import.** Back in Lovable → Model page → Import results, drop in
   `model_metrics.json` and `top_50_customers.json`. The dashboard model
   metrics and the Explainability "Top 50 most impacted customers" section
   light up immediately.

## Why offline?

The dashboard runs on Lovable Cloud, which uses an edge runtime that
cannot execute scikit-learn or XGBoost (no native binaries, hard CPU cap).
Doing the training on your laptop gives you the full Python ecosystem and
removes any size/time pressure on Lovable storage.
