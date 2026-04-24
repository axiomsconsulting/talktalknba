// Python source for the offline VS Code training + scoring scripts.
// Kept as plain strings so the Model page can offer them as text downloads.
// Do NOT import any Python tooling — this file only ships strings to the browser.

export const TRAIN_PY = `"""
TalkTalk NBA — Offline training script
======================================

Trains both RandomForest and XGBoost on the customer/calls/cease/usage data
pulled into Lovable (signed download links available in the Model page),
picks the better AUC, and writes:

  ./out/model_metrics.json     <-- upload via "Import results" in Lovable
  ./out/model_artefact.pkl     <-- keep locally, used by score_top50.py
  ./out/feature_importance.csv <-- audit trail

Usage
-----
1. Put the four files into ./data/ (use the signed download links).
2. pip install pandas pyarrow scikit-learn xgboost numpy
3. python train.py
4. Upload ./out/model_metrics.json in the Lovable Model page.
"""
from __future__ import annotations
import json
import os
import pickle
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    roc_auc_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    roc_curve,
)
from sklearn.model_selection import train_test_split

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except ImportError:
    HAS_XGB = False
    print("xgboost not installed — falling back to RandomForest only")

DATA = Path("./data")
OUT = Path("./out")
OUT.mkdir(exist_ok=True)

print("Loading data...")
customers = pd.read_parquet(DATA / "customer_info.parquet") if (DATA / "customer_info.parquet").exists() else pd.read_csv(DATA / "customer_info.csv")
calls = pd.read_csv(DATA / "calls.csv")
cease = pd.read_csv(DATA / "cease.csv")
usage = pd.read_parquet(DATA / "usage.parquet") if (DATA / "usage.parquet").exists() else pd.read_csv(DATA / "usage.csv")

# Normalise the customer id column across files
def find_id_col(df: pd.DataFrame) -> str:
    for c in ("customer_id", "Customer_ID", "id", "account_id", "ACCOUNT_ID"):
        if c in df.columns:
            return c
    raise ValueError(f"No customer id column in {df.columns.tolist()}")

cid = find_id_col(customers)
customers = customers.rename(columns={cid: "customer_id"})
calls = calls.rename(columns={find_id_col(calls): "customer_id"})
usage = usage.rename(columns={find_id_col(usage): "customer_id"})
cease = cease.rename(columns={find_id_col(cease): "customer_id"})

# Build features
print("Engineering features...")

# Loyalty calls in last 90 days
calls["call_date"] = pd.to_datetime(calls.get("call_date", calls.get("date")), errors="coerce")
recent = calls[calls["call_date"] >= (calls["call_date"].max() - pd.Timedelta(days=90))]
loyalty_90d = recent.groupby("customer_id").size().rename("loyalty_calls_90d")

# Average hold seconds
hold_col = "hold_seconds" if "hold_seconds" in calls.columns else None
hold = calls.groupby("customer_id")[hold_col].mean().rename("avg_hold_seconds") if hold_col else None

# Monthly download GB (from usage)
gb_col = next((c for c in ("download_gb", "monthly_download_gb", "downloaded_gb") if c in usage.columns), None)
gb = usage.groupby("customer_id")[gb_col].mean().rename("monthly_download_gb") if gb_col else None

# Out-of-contract days
ooc = customers["ooc_days"] if "ooc_days" in customers.columns else customers.get("days_out_of_contract")
if ooc is not None:
    customers["ooc_days"] = pd.to_numeric(ooc, errors="coerce").fillna(0)
else:
    customers["ooc_days"] = 0

# Speed deficit %
if "speed_deficit_pct" in customers.columns:
    customers["speed_deficit_pct"] = pd.to_numeric(customers["speed_deficit_pct"], errors="coerce").fillna(0)
else:
    customers["speed_deficit_pct"] = 0

# Churn label = appeared in cease file
churners = set(cease["customer_id"].astype(str).unique())
customers["churned"] = customers["customer_id"].astype(str).isin(churners).astype(int)

df = customers.merge(loyalty_90d, on="customer_id", how="left")
if hold is not None:
    df = df.merge(hold, on="customer_id", how="left")
if gb is not None:
    df = df.merge(gb, on="customer_id", how="left")

df = df.fillna(0)

# Features used by the Lovable dashboard
FEATURES = [c for c in [
    "loyalty_calls_90d",
    "avg_hold_seconds",
    "ooc_days",
    "speed_deficit_pct",
    "monthly_download_gb",
    "tenure_months",
    "monthly_arpu",
    "package_tier",
    "n_devices",
] if c in df.columns]

print(f"Using features: {FEATURES}")

X = df[FEATURES].copy()
# Encode any object columns (e.g. package_tier)
for c in X.columns:
    if X[c].dtype == object:
        X[c] = X[c].astype("category").cat.codes
y = df["churned"].astype(int)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, stratify=y, random_state=42)

# Train RF
print("Training RandomForest...")
rf = RandomForestClassifier(n_estimators=400, max_depth=12, min_samples_leaf=20, n_jobs=-1, random_state=42)
rf.fit(X_train, y_train)
rf_proba = rf.predict_proba(X_test)[:, 1]
rf_auc = roc_auc_score(y_test, rf_proba)
print(f"  RF AUC = {rf_auc:.4f}")

best_name, best_model, best_proba, best_auc = "RandomForest", rf, rf_proba, rf_auc

if HAS_XGB:
    print("Training XGBoost...")
    xgb = XGBClassifier(
        n_estimators=600, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8, eval_metric="auc",
        tree_method="hist", random_state=42,
    )
    xgb.fit(X_train, y_train)
    xgb_proba = xgb.predict_proba(X_test)[:, 1]
    xgb_auc = roc_auc_score(y_test, xgb_proba)
    print(f"  XGB AUC = {xgb_auc:.4f}")
    if xgb_auc > best_auc:
        best_name, best_model, best_proba, best_auc = "XGBoost", xgb, xgb_proba, xgb_auc

print(f"Picked: {best_name} (AUC={best_auc:.4f})")

# Threshold = max-F1 on test
thresholds = np.linspace(0.05, 0.95, 91)
best_thresh, best_f1 = 0.5, 0.0
for t in thresholds:
    preds = (best_proba >= t).astype(int)
    f1 = f1_score(y_test, preds, zero_division=0)
    if f1 > best_f1:
        best_f1, best_thresh = f1, float(t)

y_pred = (best_proba >= best_thresh).astype(int)
cm = confusion_matrix(y_test, y_pred)
fpr, tpr, roc_t = roc_curve(y_test, best_proba)
roc_points = [{"fpr": float(f), "tpr": float(p), "threshold": float(th)} for f, p, th in zip(fpr, tpr, roc_t)][::max(1, len(fpr)//50)]

# Per-segment metrics by tenure bucket
seg_metrics = []
if "tenure_months" in df.columns:
    test_idx = X_test.index
    seg_df = df.loc[test_idx, ["tenure_months"]].copy()
    seg_df["pred"] = y_pred
    seg_df["actual"] = y_test.values
    bins = [(0,12,"0-12m"),(12,24,"12-24m"),(24,48,"24-48m"),(48,999,"48m+")]
    for lo, hi, lab in bins:
        m = (seg_df["tenure_months"] >= lo) & (seg_df["tenure_months"] < hi)
        if m.sum() < 10: continue
        seg_metrics.append({
            "segment": lab,
            "precision": float(precision_score(seg_df.loc[m,"actual"], seg_df.loc[m,"pred"], zero_division=0)),
            "recall": float(recall_score(seg_df.loc[m,"actual"], seg_df.loc[m,"pred"], zero_division=0)),
            "n": int(m.sum()),
        })

# Feature importance
fi_arr = best_model.feature_importances_
feature_importance = sorted(
    [{"feature": f, "importance": float(v)} for f, v in zip(FEATURES, fi_arr)],
    key=lambda d: d["importance"], reverse=True,
)

metrics = {
    "model_type": best_name,
    "trained_at": datetime.now(timezone.utc).isoformat(),
    "hyperparameters": best_model.get_params(),
    "performance_metrics": {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1_score": float(best_f1),
        "roc_auc": float(best_auc),
        "decision_threshold": float(best_thresh),
    },
    "confusion_matrix": {
        "true_negatives": int(cm[0,0]), "false_positives": int(cm[0,1]),
        "false_negatives": int(cm[1,0]), "true_positives": int(cm[1,1]),
    },
    "dataset_split": {"train_size": int(len(X_train)), "test_size": int(len(X_test))},
    "roc_curve": roc_points,
    "segment_metrics": seg_metrics,
    "feature_importance": feature_importance,
}

with open(OUT / "model_metrics.json", "w") as f:
    json.dump(metrics, f, indent=2, default=str)

with open(OUT / "model_artefact.pkl", "wb") as f:
    pickle.dump({"model": best_model, "features": FEATURES, "threshold": best_thresh, "model_type": best_name}, f)

pd.DataFrame(feature_importance).to_csv(OUT / "feature_importance.csv", index=False)

print(f"\\n✓ Wrote {OUT/'model_metrics.json'}")
print(f"✓ Wrote {OUT/'model_artefact.pkl'}")
print(f"✓ Wrote {OUT/'feature_importance.csv'}")
print(f"\\nNext: run \\\`python score_top50.py\\\` to score everyone and produce the top 50.")
`;

export const SCORE_PY = `"""
TalkTalk NBA — Top-50 most-impacted customers
=============================================

Loads ./out/model_artefact.pkl produced by train.py, scores every customer
in ./data/, ranks by churn probability, attaches the strongest reason codes
(via SHAP if available, else feature_importance × normalised feature value),
recommends an NBA from a small rule book and writes:

  ./out/top_50_customers.json   <-- upload via "Import results" in Lovable

Usage
-----
1. Run train.py first.
2. python score_top50.py
3. Upload ./out/top_50_customers.json in the Lovable Model page.
"""
from __future__ import annotations
import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False
    print("shap not installed — using fast feature-importance fallback for reasons")

DATA = Path("./data")
OUT = Path("./out")
ART = OUT / "model_artefact.pkl"
if not ART.exists():
    raise SystemExit(f"Missing {ART} — run train.py first")

with open(ART, "rb") as f:
    bundle = pickle.load(f)
model = bundle["model"]
features = bundle["features"]
threshold = bundle["threshold"]
model_type = bundle["model_type"]

# Load customers (same logic as train.py)
customers = pd.read_parquet(DATA / "customer_info.parquet") if (DATA / "customer_info.parquet").exists() else pd.read_csv(DATA / "customer_info.csv")
calls = pd.read_csv(DATA / "calls.csv")
usage = pd.read_parquet(DATA / "usage.parquet") if (DATA / "usage.parquet").exists() else pd.read_csv(DATA / "usage.csv")

def find_id_col(df):
    for c in ("customer_id", "Customer_ID", "id", "account_id", "ACCOUNT_ID"):
        if c in df.columns: return c
    raise ValueError("no id col")

customers = customers.rename(columns={find_id_col(customers): "customer_id"})
calls = calls.rename(columns={find_id_col(calls): "customer_id"})
usage = usage.rename(columns={find_id_col(usage): "customer_id"})

calls["call_date"] = pd.to_datetime(calls.get("call_date", calls.get("date")), errors="coerce")
recent = calls[calls["call_date"] >= (calls["call_date"].max() - pd.Timedelta(days=90))]
loyalty_90d = recent.groupby("customer_id").size().rename("loyalty_calls_90d")
hold_col = "hold_seconds" if "hold_seconds" in calls.columns else None
hold = calls.groupby("customer_id")[hold_col].mean().rename("avg_hold_seconds") if hold_col else None
gb_col = next((c for c in ("download_gb","monthly_download_gb","downloaded_gb") if c in usage.columns), None)
gb = usage.groupby("customer_id")[gb_col].mean().rename("monthly_download_gb") if gb_col else None

df = customers.merge(loyalty_90d, on="customer_id", how="left")
if hold is not None: df = df.merge(hold, on="customer_id", how="left")
if gb is not None: df = df.merge(gb, on="customer_id", how="left")
for c in ("ooc_days","speed_deficit_pct"):
    if c not in df.columns: df[c] = 0
df = df.fillna(0)

X = df[features].copy()
for c in X.columns:
    if X[c].dtype == object:
        X[c] = X[c].astype("category").cat.codes

probs = model.predict_proba(X)[:, 1]
df["churn_prob"] = probs

# Reason codes
def reason_codes_fallback(row_x: pd.Series) -> list:
    fi = getattr(model, "feature_importances_", None)
    if fi is None: return []
    contribs = []
    norm = (row_x - X.min()) / (X.max() - X.min() + 1e-9)
    for f, w, n in zip(features, fi, norm):
        contribs.append({"feature": f, "impact": float(w * n)})
    contribs.sort(key=lambda d: d["impact"], reverse=True)
    return contribs[:3]

if HAS_SHAP:
    print("Computing SHAP values for top customers...")
    top_idx = df["churn_prob"].nlargest(50).index
    explainer = shap.TreeExplainer(model)
    shap_vals = explainer.shap_values(X.loc[top_idx])
    if isinstance(shap_vals, list):
        shap_vals = shap_vals[1]  # positive class
    reasons_by_idx = {}
    for i, idx in enumerate(top_idx):
        sv = shap_vals[i]
        ranked = sorted(zip(features, sv), key=lambda t: abs(t[1]), reverse=True)[:3]
        reasons_by_idx[idx] = [{"feature": f, "impact": float(v)} for f, v in ranked]
else:
    reasons_by_idx = {}

# NBA rule book — kept tiny; keyed by dominant reason
NBA_RULES = {
    "loyalty_calls_90d": "Retention call · 15% off 12 mo",
    "avg_hold_seconds":  "Priority care queue + £20 credit",
    "ooc_days":          "Loyalty re-contract · 24 mo £5/mo off",
    "speed_deficit_pct": "Free fibre upgrade audit",
    "monthly_download_gb": "Unlimited data add-on",
    "tenure_months":     "Tenure reward · service credit",
    "monthly_arpu":      "Bill-shock pre-emptive call",
}

top = df.nlargest(50, "churn_prob")[["customer_id", "churn_prob"] + features].reset_index(drop=True)

records = []
for i, row in top.iterrows():
    idx = top.index[i]
    if idx in reasons_by_idx:
        rs = reasons_by_idx[idx]
    else:
        rs = reason_codes_fallback(X.loc[df.index[df["customer_id"] == row["customer_id"]][0]])
    dominant = rs[0]["feature"] if rs else "tenure_months"
    nba = NBA_RULES.get(dominant, "Standard retention offer")
    # Expected save = churn_prob * arpu * 12 * 0.5 (success rate)
    arpu = float(row.get("monthly_arpu", 25.0)) if "monthly_arpu" in row.index else 25.0
    expected_save = float(row["churn_prob"]) * arpu * 12 * 0.5
    records.append({
        "customer_id": str(row["customer_id"]),
        "rank": int(i + 1),
        "churn_prob": float(row["churn_prob"]),
        "reason_codes": rs,
        "recommended_nba": nba,
        "expected_save_gbp": round(expected_save, 2),
        "features": {f: float(row[f]) if pd.notna(row[f]) else None for f in features},
    })

OUT.mkdir(exist_ok=True)
with open(OUT / "top_50_customers.json", "w") as f:
    json.dump({
        "model_type": model_type,
        "threshold": threshold,
        "scored_n": int(len(df)),
        "customers": records,
    }, f, indent=2, default=str)

print(f"\\n✓ Scored {len(df):,} customers, picked top 50.")
print(f"✓ Wrote ./out/top_50_customers.json — upload it in the Lovable Model page.")
`;

export const README_MD = `# TalkTalk NBA — Offline training kit

Two scripts that run on your laptop in VS Code. Lovable provides the data
and accepts the results back.

## One-time setup

\`\`\`
pip install pandas pyarrow scikit-learn xgboost numpy
# optional, for richer reason codes:
pip install shap
\`\`\`

## Workflow

1. **Get the data.** In Lovable → Model page → External training kit, click each
   signed download link. Save the four files into \`./data/\`:
   - \`customer_info.parquet\` (or \`.csv\`)
   - \`calls.csv\`
   - \`cease.csv\`
   - \`usage.parquet\` (or \`.csv\`)

2. **Train.** \`python train.py\` — produces \`./out/model_metrics.json\`,
   \`./out/model_artefact.pkl\`, \`./out/feature_importance.csv\`.

3. **Score top 50.** \`python score_top50.py\` — produces
   \`./out/top_50_customers.json\`.

4. **Import.** Back in Lovable → Model page → Import results, drop in
   \`model_metrics.json\` and \`top_50_customers.json\`. The dashboard model
   metrics and the Explainability "Top 50 most impacted customers" section
   light up immediately.

## Why offline?

The dashboard runs on Lovable Cloud, which uses an edge runtime that
cannot execute scikit-learn or XGBoost (no native binaries, hard CPU cap).
Doing the training on your laptop gives you the full Python ecosystem and
removes any size/time pressure on Lovable storage.
`;
