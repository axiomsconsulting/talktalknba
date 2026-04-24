// Notebook source for the offline VS Code training + scoring workflow.
// We ship .ipynb (JSON) files so the user can open them directly in
// VS Code / Jupyter. Schema is bound to the TalkTalk data model:
//
//   customer_info(unique_customer_identifier, datevalue, contract_status,
//                 contract_dd_cancels, dd_cancel_60_day, ooc_days, technology,
//                 speed, line_speed, sales_channel, crm_package_name, tenure_days)
//   usage(unique_customer_identifier, calendar_date,
//         usage_download_mbs, usage_upload_mbs)
//   calls(unique_customer_identifier, event_date, call_type, call_type_key,
//         talk_time_seconds, hold_time_seconds)
//   cease(unique_customer_identifier, cease_placed_date, cease_completed_date,
//         reason_description, reason_description_insight)
//
// No attribute outside this schema is referenced.

type NbCell =
  | { cell_type: "markdown"; metadata: Record<string, unknown>; source: string[] }
  | {
      cell_type: "code";
      metadata: Record<string, unknown>;
      execution_count: null;
      outputs: unknown[];
      source: string[];
    };

function md(...lines: string[]): NbCell {
  return {
    cell_type: "markdown",
    metadata: {},
    source: lines.map((l, i) => (i === lines.length - 1 ? l : l + "\n")),
  };
}

function code(...lines: string[]): NbCell {
  return {
    cell_type: "code",
    metadata: {},
    execution_count: null,
    outputs: [],
    source: lines.map((l, i) => (i === lines.length - 1 ? l : l + "\n")),
  };
}

function notebook(cells: NbCell[]): string {
  const nb = {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.11" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return JSON.stringify(nb, null, 1);
}

// ============================================================
// train.ipynb
// ============================================================
export const TRAIN_IPYNB = notebook([
  md(
    "# TalkTalk NBA — Offline training",
    "",
    "Trains **RandomForest** and **XGBoost** churn classifiers on the four TalkTalk tables pulled into Lovable, picks the better ROC AUC, and writes:",
    "",
    "- `model_metrics.json` — upload via *Import results* in Lovable",
    "- `model_artefact.pkl` — kept locally, consumed by `score_top50.ipynb`",
    "- `feature_importance.csv` — audit trail",
    "",
    "## Schema this notebook expects",
    "",
    "| Table | Columns used |",
    "|---|---|",
    "| `customer_info` | `unique_customer_identifier`, `contract_status`, `contract_dd_cancels`, `dd_cancel_60_day`, `ooc_days`, `technology`, `speed`, `line_speed`, `sales_channel`, `crm_package_name`, `tenure_days` |",
    "| `calls`         | `unique_customer_identifier`, `event_date`, `call_type_key`, `talk_time_seconds`, `hold_time_seconds` |",
    "| `usage`         | `unique_customer_identifier`, `calendar_date`, `usage_download_mbs`, `usage_upload_mbs` |",
    "| `cease`         | `unique_customer_identifier`, `cease_placed_date` (used to label churn) |"
  ),
  md(
    "## 1 · One-time setup",
    "",
    "```bash",
    "pip install pandas numpy scikit-learn pyarrow fastparquet xgboost",
    "# macOS only — XGBoost needs OpenMP at runtime:",
    "brew install libomp",
    "```",
    "",
    "All four data files should sit **next to this notebook** (the default `DATA = '.'`)."
  ),
  code(
    "from __future__ import annotations",
    "import json, pickle",
    "from datetime import datetime, timezone",
    "from pathlib import Path",
    "",
    "import numpy as np",
    "import pandas as pd",
    "from sklearn.ensemble import RandomForestClassifier",
    "from sklearn.metrics import (",
    "    roc_auc_score, accuracy_score, precision_score, recall_score,",
    "    f1_score, confusion_matrix, roc_curve,",
    ")",
    "from sklearn.model_selection import train_test_split",
    "",
    "try:",
    "    from xgboost import XGBClassifier",
    "    HAS_XGB = True",
    "except ImportError:",
    "    HAS_XGB = False",
    "    print('xgboost not installed — RandomForest only')",
    "",
    "DATA = Path('.')   # all input files are next to this notebook",
    "OUT  = Path('.')   # outputs land here too",
    "ID   = 'unique_customer_identifier'"
  ),
  md(
    "## 2 · Load the four tables",
    "",
    "Parquet is preferred; falls back to CSV automatically. `fastparquet` or `pyarrow` will satisfy the parquet engine."
  ),
  code(
    "def load(name: str) -> pd.DataFrame:",
    "    pq = DATA / f'{name}.parquet'",
    "    csv = DATA / f'{name}.csv'",
    "    if pq.exists():",
    "        return pd.read_parquet(pq)",
    "    if csv.exists():",
    "        return pd.read_csv(csv)",
    "    raise FileNotFoundError(f'Neither {pq} nor {csv} found')",
    "",
    "customer_info = load('customer_info')",
    "calls         = load('calls')",
    "usage         = load('usage')",
    "cease         = load('cease')",
    "",
    "for name, df in [('customer_info', customer_info), ('calls', calls), ('usage', usage), ('cease', cease)]:",
    "    print(f'{name:14s} rows={len(df):>10,}  cols={len(df.columns)}')"
  ),
  md(
    "## 3 · Build the churn label",
    "",
    "A customer is labelled `churned = 1` if they appear in `cease` with a `cease_placed_date`."
  ),
  code(
    "cease['cease_placed_date'] = pd.to_datetime(cease['cease_placed_date'], errors='coerce')",
    "churners = set(cease.loc[cease['cease_placed_date'].notna(), ID].astype(str).unique())",
    "print(f'Churn events: {len(churners):,}')"
  ),
  md(
    "## 4 · Feature engineering",
    "",
    "Only columns that exist in the schema are used. Engineered features:",
    "",
    "- **`loyalty_calls_90d`** — number of `calls` rows in the last 90 days of data",
    "- **`avg_hold_seconds`** — mean `hold_time_seconds` per customer",
    "- **`avg_talk_seconds`** — mean `talk_time_seconds` per customer",
    "- **`avg_download_mbs`** — mean `usage_download_mbs` per customer",
    "- **`avg_upload_mbs`** — mean `usage_upload_mbs` per customer",
    "- Customer-level: `ooc_days`, `tenure_days`, `speed`, `line_speed`, `contract_dd_cancels`, `dd_cancel_60_day`, plus encoded `technology`, `sales_channel`, `crm_package_name`, `contract_status`."
  ),
  code(
    "# Calls features",
    "calls['event_date'] = pd.to_datetime(calls['event_date'], errors='coerce')",
    "max_call = calls['event_date'].max()",
    "recent_calls = calls[calls['event_date'] >= (max_call - pd.Timedelta(days=90))]",
    "loyalty_90d   = recent_calls.groupby(ID).size().rename('loyalty_calls_90d')",
    "avg_hold      = calls.groupby(ID)['hold_time_seconds'].mean().rename('avg_hold_seconds')",
    "avg_talk      = calls.groupby(ID)['talk_time_seconds'].mean().rename('avg_talk_seconds')",
    "",
    "# Usage features",
    "avg_download  = usage.groupby(ID)['usage_download_mbs'].mean().rename('avg_download_mbs')",
    "avg_upload    = usage.groupby(ID)['usage_upload_mbs'].mean().rename('avg_upload_mbs')",
    "",
    "df = (customer_info",
    "      .merge(loyalty_90d,  on=ID, how='left')",
    "      .merge(avg_hold,     on=ID, how='left')",
    "      .merge(avg_talk,     on=ID, how='left')",
    "      .merge(avg_download, on=ID, how='left')",
    "      .merge(avg_upload,   on=ID, how='left'))",
    "",
    "df['churned'] = df[ID].astype(str).isin(churners).astype(int)",
    "print(f'Customers: {len(df):,}  churn rate: {df[\"churned\"].mean():.2%}')"
  ),
  code(
    "NUMERIC_FEATURES = [",
    "    'ooc_days', 'tenure_days', 'speed', 'line_speed',",
    "    'contract_dd_cancels', 'dd_cancel_60_day',",
    "    'loyalty_calls_90d', 'avg_hold_seconds', 'avg_talk_seconds',",
    "    'avg_download_mbs', 'avg_upload_mbs',",
    "]",
    "CATEGORICAL_FEATURES = ['technology', 'sales_channel', 'crm_package_name', 'contract_status']",
    "",
    "FEATURES = [c for c in NUMERIC_FEATURES + CATEGORICAL_FEATURES if c in df.columns]",
    "print('Features used:', FEATURES)",
    "",
    "X = df[FEATURES].copy()",
    "for c in X.columns:",
    "    if X[c].dtype == object:",
    "        X[c] = X[c].astype('category').cat.codes",
    "X = X.apply(pd.to_numeric, errors='coerce').fillna(0)",
    "y = df['churned'].astype(int)"
  ),
  md("## 5 · Train / test split"),
  code(
    "X_train, X_test, y_train, y_test = train_test_split(",
    "    X, y, test_size=0.25, stratify=y, random_state=42",
    ")",
    "print(f'Train: {len(X_train):,}   Test: {len(X_test):,}')"
  ),
  md("## 6 · RandomForest"),
  code(
    "rf = RandomForestClassifier(",
    "    n_estimators=400, max_depth=12, min_samples_leaf=20,",
    "    n_jobs=-1, random_state=42,",
    ")",
    "rf.fit(X_train, y_train)",
    "rf_proba = rf.predict_proba(X_test)[:, 1]",
    "rf_auc = roc_auc_score(y_test, rf_proba)",
    "print(f'RandomForest AUC = {rf_auc:.4f}')"
  ),
  md(
    "## 7 · XGBoost",
    "",
    "If you see `XGBoostError: Library not loaded: libomp.dylib`, install OpenMP via Homebrew on macOS: `brew install libomp`."
  ),
  code(
    "best_name, best_model, best_proba, best_auc = 'RandomForest', rf, rf_proba, rf_auc",
    "",
    "if HAS_XGB:",
    "    xgb = XGBClassifier(",
    "        n_estimators=600, max_depth=6, learning_rate=0.05,",
    "        subsample=0.8, colsample_bytree=0.8, eval_metric='auc',",
    "        tree_method='hist', random_state=42,",
    "    )",
    "    xgb.fit(X_train, y_train)",
    "    xgb_proba = xgb.predict_proba(X_test)[:, 1]",
    "    xgb_auc = roc_auc_score(y_test, xgb_proba)",
    "    print(f'XGBoost AUC = {xgb_auc:.4f}')",
    "    if xgb_auc > best_auc:",
    "        best_name, best_model, best_proba, best_auc = 'XGBoost', xgb, xgb_proba, xgb_auc",
    "",
    "print(f'\\n→ Selected: {best_name} (AUC={best_auc:.4f})')"
  ),
  md("## 8 · Pick decision threshold (max F1)"),
  code(
    "thresholds = np.linspace(0.05, 0.95, 91)",
    "best_thresh, best_f1 = 0.5, 0.0",
    "for t in thresholds:",
    "    preds = (best_proba >= t).astype(int)",
    "    f1 = f1_score(y_test, preds, zero_division=0)",
    "    if f1 > best_f1:",
    "        best_f1, best_thresh = f1, float(t)",
    "",
    "y_pred = (best_proba >= best_thresh).astype(int)",
    "cm = confusion_matrix(y_test, y_pred)",
    "print(f'Threshold={best_thresh:.2f}  F1={best_f1:.4f}')",
    "print('Confusion matrix:\\n', cm)"
  ),
  md("## 9 · Per-segment metrics (by tenure bucket)"),
  code(
    "seg_metrics = []",
    "if 'tenure_days' in df.columns:",
    "    test_idx = X_test.index",
    "    seg_df = df.loc[test_idx, ['tenure_days']].copy()",
    "    seg_df['pred']   = y_pred",
    "    seg_df['actual'] = y_test.values",
    "    bins = [(0,365,'0-12m'),(365,730,'12-24m'),(730,1460,'24-48m'),(1460,99999,'48m+')]",
    "    for lo, hi, lab in bins:",
    "        m = (seg_df['tenure_days'] >= lo) & (seg_df['tenure_days'] < hi)",
    "        if m.sum() < 10:",
    "            continue",
    "        seg_metrics.append({",
    "            'segment': lab,",
    "            'precision': float(precision_score(seg_df.loc[m,'actual'], seg_df.loc[m,'pred'], zero_division=0)),",
    "            'recall':    float(recall_score(seg_df.loc[m,'actual'], seg_df.loc[m,'pred'], zero_division=0)),",
    "            'n':         int(m.sum()),",
    "        })",
    "seg_metrics"
  ),
  md("## 10 · Feature importance & ROC curve"),
  code(
    "fi_arr = best_model.feature_importances_",
    "feature_importance = sorted(",
    "    [{'feature': f, 'importance': float(v)} for f, v in zip(FEATURES, fi_arr)],",
    "    key=lambda d: d['importance'], reverse=True,",
    ")",
    "",
    "fpr, tpr, roc_t = roc_curve(y_test, best_proba)",
    "step = max(1, len(fpr) // 50)",
    "roc_points = [",
    "    {'fpr': float(f), 'tpr': float(p), 'threshold': float(th)}",
    "    for f, p, th in zip(fpr[::step], tpr[::step], roc_t[::step])",
    "]",
    "feature_importance[:8]"
  ),
  md(
    "## 11 · Write outputs",
    "",
    "Files land alongside this notebook. Upload `model_metrics.json` via *Lovable → Model → Import results*."
  ),
  code(
    "import math",
    "",
    "def _clean(obj):",
    "    \"\"\"Recursively replace NaN/Inf with None so the JSON is valid (NaN is not legal JSON).\"\"\"",
    "    if isinstance(obj, dict):",
    "        return {k: _clean(v) for k, v in obj.items()}",
    "    if isinstance(obj, (list, tuple)):",
    "        return [_clean(v) for v in obj]",
    "    if isinstance(obj, float):",
    "        return None if (math.isnan(obj) or math.isinf(obj)) else obj",
    "    if isinstance(obj, (np.floating,)):",
    "        f = float(obj)",
    "        return None if (math.isnan(f) or math.isinf(f)) else f",
    "    if isinstance(obj, (np.integer,)):",
    "        return int(obj)",
    "    if isinstance(obj, (np.bool_,)):",
    "        return bool(obj)",
    "    return obj",
    "",
    "metrics = {",
    "    'model_type': best_name,",
    "    'trained_at': datetime.now(timezone.utc).isoformat(),",
    "    'hyperparameters': best_model.get_params(),",
    "    'performance_metrics': {",
    "        'accuracy':           float(accuracy_score(y_test, y_pred)),",
    "        'precision':          float(precision_score(y_test, y_pred, zero_division=0)),",
    "        'recall':             float(recall_score(y_test, y_pred, zero_division=0)),",
    "        'f1_score':           float(best_f1),",
    "        'roc_auc':            float(best_auc),",
    "        'decision_threshold': float(best_thresh),",
    "    },",
    "    'confusion_matrix': {",
    "        'true_negatives': int(cm[0,0]), 'false_positives': int(cm[0,1]),",
    "        'false_negatives': int(cm[1,0]), 'true_positives':  int(cm[1,1]),",
    "    },",
    "    'dataset_split': {'train_size': int(len(X_train)), 'test_size': int(len(X_test))},",
    "    'roc_curve': roc_points,",
    "    'segment_metrics': seg_metrics,",
    "    'feature_importance': feature_importance,",
    "}",
    "",
    "with open(OUT / 'model_metrics.json', 'w') as f:",
    "    json.dump(_clean(metrics), f, indent=2, default=str, allow_nan=False)",
    "",
    "with open(OUT / 'model_artefact.pkl', 'wb') as f:",
    "    pickle.dump({",
    "        'model': best_model,",
    "        'features': FEATURES,",
    "        'threshold': best_thresh,",
    "        'model_type': best_name,",
    "    }, f)",
    "",
    "pd.DataFrame(feature_importance).to_csv(OUT / 'feature_importance.csv', index=False)",
    "print('✓ model_metrics.json')",
    "print('✓ model_artefact.pkl')",
    "print('✓ feature_importance.csv')",
    "print('\\nNext: open score_top50.ipynb to produce the top-50 customers.')"
  ),
]);

// ============================================================
// score_top50.ipynb
// ============================================================
export const SCORE_IPYNB = notebook([
  md(
    "# TalkTalk NBA — Top-50 most-impacted customers",
    "",
    "Loads the artefact produced by `train.ipynb`, scores every customer, ranks by churn probability, attaches the strongest reason codes (SHAP if available, otherwise a fast feature-importance × normalised feature-value fallback), recommends an NBA, and writes:",
    "",
    "- `top_50_customers.json` — upload via *Lovable → Model → Import results*",
    "",
    "All input files (`customer_info`, `calls`, `usage`) sit next to this notebook (`DATA = '.'`)."
  ),
  md(
    "## 1 · Setup",
    "",
    "```bash",
    "pip install pandas numpy scikit-learn pyarrow fastparquet xgboost",
    "# optional, for SHAP-quality reason codes:",
    "pip install shap",
    "```"
  ),
  code(
    "from __future__ import annotations",
    "import json, pickle, math",
    "from pathlib import Path",
    "",
    "import numpy as np",
    "import pandas as pd",
    "",
    "try:",
    "    import shap",
    "    HAS_SHAP = True",
    "except ImportError:",
    "    HAS_SHAP = False",
    "    print('shap not installed — using feature-importance fallback for reasons')",
    "",
    "DATA = Path('.')",
    "OUT  = Path('.')",
    "ID   = 'unique_customer_identifier'",
    "",
    "ART = OUT / 'model_artefact.pkl'",
    "if not ART.exists():",
    "    raise SystemExit(f'Missing {ART} — run train.ipynb first')",
    "",
    "with open(ART, 'rb') as f:",
    "    bundle = pickle.load(f)",
    "model      = bundle['model']",
    "features   = bundle['features']",
    "threshold  = bundle['threshold']",
    "model_type = bundle['model_type']",
    "print(f'Loaded {model_type} with {len(features)} features (threshold={threshold:.2f})')"
  ),
  md("## 2 · Rebuild the same features used in training"),
  code(
    "def load(name: str) -> pd.DataFrame:",
    "    pq, csv = DATA / f'{name}.parquet', DATA / f'{name}.csv'",
    "    if pq.exists():  return pd.read_parquet(pq)",
    "    if csv.exists(): return pd.read_csv(csv)",
    "    raise FileNotFoundError(name)",
    "",
    "customer_info = load('customer_info')",
    "calls         = load('calls')",
    "usage         = load('usage')",
    "",
    "calls['event_date'] = pd.to_datetime(calls['event_date'], errors='coerce')",
    "max_call = calls['event_date'].max()",
    "recent   = calls[calls['event_date'] >= (max_call - pd.Timedelta(days=90))]",
    "",
    "# Coerce numeric-looking columns that may have been read as strings",
    "for col in ('hold_time_seconds', 'talk_time_seconds'):",
    "    if col in calls.columns:",
    "        calls[col] = pd.to_numeric(calls[col], errors='coerce')",
    "for col in ('usage_download_mbs', 'usage_upload_mbs'):",
    "    if col in usage.columns:",
    "        usage[col] = pd.to_numeric(usage[col], errors='coerce')",
    "",
    "loyalty_90d  = recent.groupby(ID).size().rename('loyalty_calls_90d')",
    "avg_hold     = calls.groupby(ID)['hold_time_seconds'].mean().rename('avg_hold_seconds')",
    "avg_talk     = calls.groupby(ID)['talk_time_seconds'].mean().rename('avg_talk_seconds')",
    "avg_download = usage.groupby(ID)['usage_download_mbs'].mean().rename('avg_download_mbs')",
    "avg_upload   = usage.groupby(ID)['usage_upload_mbs'].mean().rename('avg_upload_mbs')",
    "",
    "df = (customer_info",
    "      .merge(loyalty_90d,  on=ID, how='left')",
    "      .merge(avg_hold,     on=ID, how='left')",
    "      .merge(avg_talk,     on=ID, how='left')",
    "      .merge(avg_download, on=ID, how='left')",
    "      .merge(avg_upload,   on=ID, how='left'))",
    "",
    "X = df.reindex(columns=features).copy()",
    "for c in X.columns:",
    "    if X[c].dtype == object:",
    "        X[c] = X[c].astype('category').cat.codes",
    "X = X.apply(pd.to_numeric, errors='coerce').fillna(0)",
    "print(f'Scoring {len(X):,} customers…')"
  ),
  md("## 3 · Score everyone"),
  code(
    "probs = model.predict_proba(X)[:, 1]",
    "df['churn_prob'] = probs",
    "df['churn_prob'].describe()"
  ),
  md(
    "## 4 · Reason codes",
    "",
    "If SHAP is available we compute true Shapley values for the top 50; otherwise we approximate with `feature_importance × min-max-normalised feature value`."
  ),
  code(
    "def reason_codes_fallback(row_x: pd.Series) -> list:",
    "    fi = getattr(model, 'feature_importances_', None)",
    "    if fi is None: return []",
    "    rng = (X.max() - X.min()).replace(0, 1)",
    "    norm = (row_x - X.min()) / rng",
    "    contribs = [{'feature': f, 'impact': float(w * n)} for f, w, n in zip(features, fi, norm)]",
    "    contribs.sort(key=lambda d: d['impact'], reverse=True)",
    "    return contribs[:3]",
    "",
    "reasons_by_idx = {}",
    "top_idx = df['churn_prob'].nlargest(50).index",
    "",
    "if HAS_SHAP:",
    "    print('Computing SHAP values for top 50…')",
    "    explainer = shap.TreeExplainer(model)",
    "    shap_vals = explainer.shap_values(X.loc[top_idx])",
    "    if isinstance(shap_vals, list):",
    "        shap_vals = shap_vals[1]",
    "    for i, idx in enumerate(top_idx):",
    "        ranked = sorted(zip(features, shap_vals[i]), key=lambda t: abs(t[1]), reverse=True)[:3]",
    "        reasons_by_idx[idx] = [{'feature': f, 'impact': float(v)} for f, v in ranked]",
    "print(f'Reason codes ready for {len(reasons_by_idx) or 50} customers')"
  ),
  md(
    "## 5 · NBA rule book",
    "",
    "Tiny mapping from the dominant reason to the recommended next-best-action. Edit freely — these are mirrored in Lovable's NBA rules page."
  ),
  code(
    "NBA_RULES = {",
    "    'loyalty_calls_90d':   'Retention call · 15% off 12 mo',",
    "    'avg_hold_seconds':    'Priority care queue + £20 credit',",
    "    'avg_talk_seconds':    'Care follow-up + service review',",
    "    'ooc_days':            'Loyalty re-contract · 24 mo £5/mo off',",
    "    'tenure_days':         'Tenure reward · service credit',",
    "    'speed':               'Free fibre upgrade audit',",
    "    'line_speed':          'Free line speed audit',",
    "    'avg_download_mbs':    'Unlimited data add-on',",
    "    'avg_upload_mbs':      'Upload boost add-on',",
    "    'contract_dd_cancels': 'Billing welfare check + payment plan',",
    "    'dd_cancel_60_day':    'Urgent save call · payment hold',",
    "    'crm_package_name':    'Right-size package recommendation',",
    "    'technology':          'Tech migration offer (FTTC → FTTP)',",
    "    'sales_channel':       'Channel-aware retention offer',",
    "    'contract_status':     'Standard retention offer',",
    "}"
  ),
  md(
    "## 6 · Build the top-50 records",
    "",
    "Categorical features (e.g. `technology = 'FTTP'`, `crm_package_name`) are kept as **strings** in the exported `features` payload — they are only encoded to integer codes for the model itself. `expected_save_gbp` is a placeholder estimate (`prob × £25 ARPU × 12 months × 50% success`); the schema does not carry ARPU so we use a flat assumption."
  ),
  code(
    "top = df.nlargest(50, 'churn_prob')[[ID, 'churn_prob'] + features].reset_index()",
    "ASSUMED_ARPU = 25.0",
    "SUCCESS_RATE = 0.5",
    "",
    "def _jsonable(v):",
    "    \"\"\"Return a JSON-safe value: numbers stay numeric, strings (e.g. 'FTTP') stay strings, NaN→None.\"\"\"",
    "    if v is None:",
    "        return None",
    "    try:",
    "        if pd.isna(v):",
    "            return None",
    "    except (TypeError, ValueError):",
    "        pass",
    "    if isinstance(v, (bool, np.bool_)):",
    "        return bool(v)",
    "    if isinstance(v, (int, float, np.integer, np.floating)):",
    "        return float(v)",
    "    return str(v)",
    "",
    "# Use the original (untransformed) customer_info row so categorical features",
    "# like technology='FTTP' come through as strings rather than category codes.",
    "raw_lookup = customer_info.drop_duplicates(ID).set_index(ID)",
    "",
    "records = []",
    "for i, row in top.iterrows():",
    "    orig_idx = row['index']",
    "    rs = reasons_by_idx.get(orig_idx) or reason_codes_fallback(X.loc[orig_idx])",
    "    dominant = rs[0]['feature'] if rs else 'tenure_days'",
    "    nba = NBA_RULES.get(dominant, 'Standard retention offer')",
    "    expected_save = float(row['churn_prob']) * ASSUMED_ARPU * 12 * SUCCESS_RATE",
    "    cust_id = str(row[ID])",
    "    raw_row = raw_lookup.loc[cust_id] if cust_id in raw_lookup.index else None",
    "    feature_payload = {}",
    "    for f in features:",
    "        if raw_row is not None and f in raw_row.index:",
    "            val = raw_row[f]",
    "        else:",
    "            val = row[f]",
    "        feature_payload[f] = _jsonable(val)",
    "    cp = float(row['churn_prob'])",
    "    if math.isnan(cp) or math.isinf(cp):",
    "        continue  # skip rows with no valid score",
    "    es = round(expected_save, 2)",
    "    if math.isnan(es) or math.isinf(es):",
    "        es = None",
    "    records.append({",
    "        'customer_id':       cust_id,",
    "        'rank':              int(i + 1),",
    "        'churn_prob':        cp,",
    "        'reason_codes':      rs,",
    "        'recommended_nba':   nba,",
    "        'expected_save_gbp': es,",
    "        'features':          feature_payload,",
    "    })",
    "",
    "records[:3]"
  ),
  md("## 7 · Write `top_50_customers.json`"),
  code(
    "def _clean(obj):",
    "    \"\"\"Recursively replace NaN/Inf with None — NaN is not valid JSON.\"\"\"",
    "    if isinstance(obj, dict):",
    "        return {k: _clean(v) for k, v in obj.items()}",
    "    if isinstance(obj, (list, tuple)):",
    "        return [_clean(v) for v in obj]",
    "    if isinstance(obj, float):",
    "        return None if (math.isnan(obj) or math.isinf(obj)) else obj",
    "    if isinstance(obj, (np.floating,)):",
    "        f = float(obj)",
    "        return None if (math.isnan(f) or math.isinf(f)) else f",
    "    if isinstance(obj, (np.integer,)):",
    "        return int(obj)",
    "    if isinstance(obj, (np.bool_,)):",
    "        return bool(obj)",
    "    return obj",
    "",
    "payload = {",
    "    'model_type': model_type,",
    "    'threshold':  threshold,",
    "    'scored_n':   int(len(df)),",
    "    'customers':  records,",
    "}",
    "with open(OUT / 'top_50_customers.json', 'w') as f:",
    "    json.dump(_clean(payload), f, indent=2, default=str, allow_nan=False)",
    "",
    "print(f'✓ Scored {len(df):,} customers, picked top {len(records)}.')",
    "print('✓ top_50_customers.json written — upload via Lovable → Model → Import results.')"
  ),
]);

// ============================================================
// score_offline_offers.ipynb
// ------------------------------------------------------------
// Mirrors the in-app heuristic algorithm so the offline CSV
// matches what the Lovable app would compute for the same
// customer. Specifically:
//   - computeRiskScore()       (src/data/customerMapping.ts)
//   - enrichment SHAP bumps    (calls / cease / usage)
//   - tierFromScore()
//   - deriveNbaTrigger()       (src/data/customers.ts)
//   - eligibility filtering    (public.nba_rules from Lovable Cloud)
// Output: offline_offers.csv  (one row per customer with the
// recommended NBA, eligibility flag, expected save, etc.)
// ============================================================
export const OFFER_IPYNB = notebook([
  md(
    "# TalkTalk NBA — Offline offer generator",
    "",
    "Reproduces the **exact same** scoring + NBA decision the Lovable app makes, then applies",
    "the configurable eligibility / discount rules from `public.nba_rules` to produce a",
    "**full offer CSV** for every customer in `customer_info`.",
    "",
    "Mirrors:",
    "- `computeRiskScore()` — `src/data/customerMapping.ts`",
    "- enrichment bumps for calls / cease / usage — `src/data/customerMapping.ts`",
    "- `tierFromScore()` — `src/data/customerMapping.ts`",
    "- `deriveNbaTrigger()` — `src/data/customers.ts`",
    "- eligibility filtering against `nba_rules`",
    "",
    "**No model artefact is required** — this notebook intentionally uses the same heuristic",
    "the live UI uses, so results are byte-comparable to the in-app Explainability page.",
    "",
    "## Inputs (next to this notebook)",
    "",
    "| File | Source |",
    "|---|---|",
    "| `customer_info.parquet` or `.csv` | Lovable → Data → Pull |",
    "| `calls.csv` | Lovable → Data → Pull |",
    "| `cease.csv` | Lovable → Data → Pull |",
    "| `usage.parquet` or `.csv` | Lovable → Data → Pull |",
    "",
    "## Output",
    "",
    "- `offline_offers.csv` — full per-customer offer list (open in Excel)"
  ),
  md(
    "## 1 · Setup",
    "",
    "```bash",
    "pip install pandas numpy pyarrow fastparquet requests",
    "```"
  ),
  code(
    "from __future__ import annotations",
    "import json, math, os",
    "from pathlib import Path",
    "from datetime import datetime, timedelta",
    "",
    "import numpy as np",
    "import pandas as pd",
    "import requests",
    "",
    "DATA = Path('.')",
    "OUT  = Path('.')",
    "ID   = 'unique_customer_identifier'",
    "",
    "# Lovable Cloud REST endpoint — used to fetch the *live* NBA rule book so",
    "# the offline file uses the same eligibility thresholds operators set in",
    "# the app. These are the project's anon credentials, safe to embed.",
    "SUPABASE_URL  = 'https://qkshfiqgjwqlteqvbhps.supabase.co'",
    "SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc2hmaXFnandxbHRlcXZiaHBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMjY2MTMsImV4cCI6MjA5MjYwMjYxM30.5ijd6s4K1ra-UTbB5LGa5nsH4ERHAFpz18x_hMpX0jk'"
  ),
  md(
    "## 2 · Load the four tables",
    "",
    "Parquet preferred, CSV fallback. Same loader as `score_top50.ipynb`."
  ),
  code(
    "def load(name: str) -> pd.DataFrame:",
    "    pq, csv = DATA / f'{name}.parquet', DATA / f'{name}.csv'",
    "    if pq.exists():  return pd.read_parquet(pq)",
    "    if csv.exists(): return pd.read_csv(csv)",
    "    raise FileNotFoundError(f'Neither {pq} nor {csv} found')",
    "",
    "customer_info = load('customer_info')",
    "calls         = load('calls')",
    "cease         = load('cease')",
    "usage         = load('usage')",
    "",
    "for name, df in [('customer_info', customer_info), ('calls', calls),",
    "                 ('cease', cease), ('usage', usage)]:",
    "    print(f'{name:14s} rows={len(df):>10,}  cols={len(df.columns)}')"
  ),
  md(
    "## 3 · De-duplicate to one (latest) row per customer",
    "",
    "Same rule the app uses (`mapCustomers` in `customerMapping.ts`):",
    "keep the row with the most recent `datevalue` per `unique_customer_identifier`."
  ),
  code(
    "ci = customer_info.copy()",
    "ci[ID] = ci[ID].astype(str)",
    "if 'datevalue' in ci.columns:",
    "    ci['datevalue'] = ci['datevalue'].astype(str)",
    "    ci = ci.sort_values('datevalue').drop_duplicates(ID, keep='last')",
    "else:",
    "    ci = ci.drop_duplicates(ID, keep='last')",
    "",
    "for col in ('tenure_days','ooc_days','dd_cancel_60_day',",
    "            'contract_dd_cancels','speed','line_speed'):",
    "    if col in ci.columns:",
    "        ci[col] = pd.to_numeric(ci[col], errors='coerce').fillna(0)",
    "",
    "for col in ('contract_status','crm_package_name','technology'):",
    "    if col in ci.columns:",
    "        ci[col] = ci[col].astype(str).fillna('')",
    "",
    "print(f'Unique customers: {len(ci):,}')"
  ),
  md(
    "## 4 · Build call / cease / usage enrichments",
    "",
    "Mirrors `aggregateCalls`, `aggregateCease`, `aggregateUsage`."
  ),
  code(
    "# --- calls -----------------------------------------------------------",
    "calls = calls.copy()",
    "calls[ID] = calls[ID].astype(str)",
    "for col in ('hold_time_seconds','talk_time_seconds'):",
    "    if col in calls.columns:",
    "        calls[col] = pd.to_numeric(calls[col], errors='coerce').fillna(0)",
    "calls['event_date'] = pd.to_datetime(calls.get('event_date'), errors='coerce')",
    "max_call = calls['event_date'].max()",
    "cutoff = (max_call - pd.Timedelta(days=90)) if pd.notna(max_call) else None",
    "",
    "call_type_col = 'call_type_key' if 'call_type_key' in calls.columns else 'call_type'",
    "is_loyalty = calls[call_type_col].astype(str).str.lower().str.contains('loyalty', na=False)",
    "is_recent  = (calls['event_date'] >= cutoff) if cutoff is not None else True",
    "loyalty_90d = calls[is_loyalty & is_recent].groupby(ID).size().rename('loyalty_calls_90d')",
    "",
    "totals = calls.groupby(ID).agg(",
    "    total_hold_seconds=('hold_time_seconds','sum'),",
    "    total_talk_seconds=('talk_time_seconds','sum'),",
    ")",
    "calls_enrich = totals.join(loyalty_90d, how='left').fillna(0)",
    "",
    "# --- cease -----------------------------------------------------------",
    "cease = cease.copy()",
    "cease[ID] = cease[ID].astype(str)",
    "ins_col = 'reason_description_insight' if 'reason_description_insight' in cease.columns else None",
    "if ins_col:",
    "    cease_enrich = cease.dropna(subset=[ins_col]).drop_duplicates(ID, keep='last')\\",
    "                        .set_index(ID)[ins_col].rename('cease_insight').to_frame()",
    "else:",
    "    cease_enrich = pd.DataFrame(columns=['cease_insight'])",
    "",
    "# --- usage -----------------------------------------------------------",
    "usage = usage.copy()",
    "usage[ID] = usage[ID].astype(str)",
    "for col in ('usage_download_mbs','usage_upload_mbs'):",
    "    if col in usage.columns:",
    "        usage[col] = pd.to_numeric(usage[col], errors='coerce').fillna(0)",
    "ug = usage.groupby(ID).agg(",
    "    dl_sum=('usage_download_mbs','sum'),",
    "    ul_sum=('usage_upload_mbs','sum'),",
    "    n=('usage_download_mbs','size'),",
    ")",
    "# mbs is per-day reading; sum/n × 30 ≈ monthly average. Convert to GB (÷ 1024).",
    "ug['monthly_download_gb'] = (ug['dl_sum'] / ug['n'].clip(lower=1)) * 30 / 1024",
    "ug['monthly_upload_gb']   = (ug['ul_sum'] / ug['n'].clip(lower=1)) * 30 / 1024",
    "ug['monthly_download_gb'] = ug['monthly_download_gb'].round().astype(int)",
    "ug['monthly_upload_gb']   = ug['monthly_upload_gb'].round().astype(int)",
    "usage_enrich = ug[['monthly_download_gb','monthly_upload_gb']]",
    "",
    "# --- merge -----------------------------------------------------------",
    "df = (ci.set_index(ID)",
    "        .join(calls_enrich, how='left')",
    "        .join(cease_enrich, how='left')",
    "        .join(usage_enrich, how='left')",
    "        .reset_index())",
    "for col in ('loyalty_calls_90d','total_hold_seconds','total_talk_seconds',",
    "            'monthly_download_gb','monthly_upload_gb'):",
    "    if col in df.columns:",
    "        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)",
    "df['cease_insight'] = df.get('cease_insight', pd.Series(dtype=object)).fillna('')",
    "print(f'Enriched customers: {len(df):,}')"
  ),
  md(
    "## 5 · `compute_risk_score` — mirrors `computeRiskScore` in the app",
    "",
    "Identical maths, same caps and clamps, so the offline score for a customer",
    "matches what Lovable shows on the Explainability page."
  ),
  code(
    "def compute_risk_score(row) -> tuple[float, list[dict]]:",
    "    base = 0.5",
    "    contribs: list[dict] = []",
    "",
    "    # ooc_days: saturating curve to +0.30 (and floor at -0.05)",
    "    ooc = float(row.get('ooc_days', 0) or 0)",
    "    ooc_impact = min(0.30, max(-0.05, (ooc / 600.0) * 0.30))",
    "    contribs.append({'feature':'ooc_days', 'impact': round(ooc_impact, 3)})",
    "",
    "    # dd_cancel_60_day: binary +0.18",
    "    dd60 = float(row.get('dd_cancel_60_day', 0) or 0)",
    "    contribs.append({'feature':'dd_cancel_60_day',",
    "                     'impact': 0.18 if dd60 > 0 else -0.02})",
    "",
    "    # contract_dd_cancels: up to +0.12",
    "    ddl = float(row.get('contract_dd_cancels', 0) or 0)",
    "    contribs.append({'feature':'contract_dd_cancels',",
    "                     'impact': round(min(0.12, ddl * 0.04), 3)})",
    "",
    "    # tenure_days: strong negative pull, up to -0.32",
    "    ten = float(row.get('tenure_days', 0) or 0)",
    "    tenure_impact = -min(0.32, (ten / 4000.0) * 0.32)",
    "    contribs.append({'feature':'tenure_days', 'impact': round(tenure_impact, 3)})",
    "",
    "    # speed deficit",
    "    speed      = float(row.get('speed', 0) or 0)",
    "    line_speed = float(row.get('line_speed', 0) or 0)",
    "    if speed > 0 and line_speed >= 0:",
    "        deficit = (speed - line_speed) / speed",
    "        if deficit > 0.1:",
    "            contribs.append({'feature':'speed_deficit',",
    "                             'impact': round(min(0.16, deficit * 0.2), 3)})",
    "",
    "    # enrichment bumps (kept identical to mapCustomers in the app)",
    "    loyalty = float(row.get('loyalty_calls_90d', 0) or 0)",
    "    if loyalty > 0:",
    "        contribs.append({'feature':'loyalty_calls',",
    "                         'impact': round(min(0.22, loyalty * 0.07), 3)})",
    "    hold = float(row.get('total_hold_seconds', 0) or 0)",
    "    if hold > 600:",
    "        contribs.append({'feature':'total_hold_time',",
    "                         'impact': round(min(0.12, (hold / 3600.0) * 0.08), 3)})",
    "    if str(row.get('cease_insight','')) == 'CompetitorDeals':",
    "        contribs.append({'feature':'cease_competitor', 'impact': 0.15})",
    "    pkg = str(row.get('crm_package_name',''))",
    "    dl  = float(row.get('monthly_download_gb', 0) or 0)",
    "    is_basic = bool(np.array([t in pkg for t in ['Fibre 35','Fibre 65','ADSL','Essentials']]).any())",
    "    if dl > 800 and is_basic:",
    "        contribs.append({'feature':'usage_overflow', 'impact': 0.08})",
    "",
    "    score = max(0.02, min(0.98, base + sum(c['impact'] for c in contribs)))",
    "    contribs.sort(key=lambda c: abs(c['impact']), reverse=True)",
    "    return float(score), contribs",
    "",
    "def tier_from_score(s: float) -> str:",
    "    if s >= 0.65: return 'High'",
    "    if s >= 0.35: return 'Medium'",
    "    return 'Low'",
    "",
    "def normalise_contract(raw: str) -> str:",
    "    s = (raw or '').lower()",
    "    if 'ooc' in s:     return 'Out of contract'",
    "    if 'rolling' in s: return 'Rolling'",
    "    return 'In contract'"
  ),
  md(
    "## 6 · `derive_nba_trigger` — mirrors `deriveNbaTrigger` in the app",
    "",
    "Same priority order:",
    "1. `Low` tier → `suppress`",
    "2. `cease_insight == CompetitorDeals` → `competitor_match`",
    "3. `loyalty_calls_90d ≥ 2` OR `total_hold_seconds > 1800` → `loyalty_save_desk`",
    "4. `speed_deficit > 0.25` OR ADSL/Fibre 35 package → `free_tech_upgrade`",
    "5. heavy user on basic package → `rightsize_email`",
    "6. `High` + `Out of contract` → `loyalty_save_desk`",
    "7. else → `nurture`"
  ),
  code(
    "def derive_nba_trigger(row, tier: str, contract: str) -> str:",
    "    pkg     = str(row.get('crm_package_name',''))",
    "    speed   = float(row.get('speed', 0) or 0)",
    "    line    = float(row.get('line_speed', 0) or 0)",
    "    deficit = (speed - line) / speed if speed > 0 else 0.0",
    "    dl      = float(row.get('monthly_download_gb', 0) or 0)",
    "    heavy   = dl > 800 and any(t in pkg for t in ['Fibre 35','Fibre 65','ADSL','Essentials'])",
    "    loyalty = float(row.get('loyalty_calls_90d', 0) or 0)",
    "    hold    = float(row.get('total_hold_seconds', 0) or 0)",
    "    insight = str(row.get('cease_insight',''))",
    "",
    "    if tier == 'Low':                                   return 'suppress'",
    "    if insight == 'CompetitorDeals':                    return 'competitor_match'",
    "    if loyalty >= 2 or hold > 1800:                     return 'loyalty_save_desk'",
    "    if deficit > 0.25 or any(t in pkg for t in ['ADSL','Fibre 35']): return 'free_tech_upgrade'",
    "    if heavy:                                            return 'rightsize_email'",
    "    if tier == 'High' and contract == 'Out of contract': return 'loyalty_save_desk'",
    "    return 'nurture'"
  ),
  md(
    "## 7 · Score every customer",
    "",
    "Vectorised per-row apply — fast enough for millions of rows on a laptop."
  ),
  code(
    "scored = df.apply(",
    "    lambda r: pd.Series(compute_risk_score(r), index=['risk_score','contribs']),",
    "    axis=1)",
    "df['risk_score']      = scored['risk_score']",
    "df['risk_contribs']   = scored['contribs']",
    "df['risk_tier']       = df['risk_score'].apply(tier_from_score)",
    "df['contract_clean']  = df.get('contract_status', pd.Series('', index=df.index)).apply(normalise_contract)",
    "df['nba_trigger']     = df.apply(",
    "    lambda r: derive_nba_trigger(r, r['risk_tier'], r['contract_clean']), axis=1)",
    "",
    "print(df['risk_tier'].value_counts())",
    "print(df['nba_trigger'].value_counts())"
  ),
  md(
    "## 8 · Pull the live NBA rule book from Lovable Cloud",
    "",
    "Same rows operators edit on the **NBA rules** page. Each rule carries:",
    "eligible packages, channel, discount %, contract length, cost per contact, and",
    "thresholds (`min_loyalty_calls_90d`, `min_hold_seconds`, `min_ooc_days`,",
    "`min_speed_deficit_pct`, `min_monthly_download_gb`)."
  ),
  code(
    "def fetch_nba_rules() -> pd.DataFrame:",
    "    url = f'{SUPABASE_URL}/rest/v1/nba_rules?select=*&is_active=eq.true&order=display_order.asc'",
    "    r = requests.get(url, headers={",
    "        'apikey':        SUPABASE_ANON,",
    "        'Authorization': f'Bearer {SUPABASE_ANON}',",
    "    }, timeout=30)",
    "    r.raise_for_status()",
    "    rules = pd.DataFrame(r.json())",
    "    if rules.empty:",
    "        print('⚠ no active NBA rules found — falling back to label/channel from the trigger only')",
    "    return rules",
    "",
    "rules = fetch_nba_rules()",
    "rules.head()"
  ),
  md(
    "## 9 · Match each customer to its rule + apply eligibility",
    "",
    "A customer is **eligible** when the rule for their `nba_trigger` exists,",
    "their package is in `eligible_packages` (empty list = all), and every",
    "non-null threshold is met. `customer_risk_threshold` lets you cap the",
    "offer roster — set it to `0.0` to keep everyone."
  ),
  code(
    "# Configurable risk floor — only customers at or above this churn score get",
    "# an outbound offer. Set to 0.0 to score the entire base.",
    "CUSTOMER_RISK_THRESHOLD = 0.50",
    "ASSUMED_SUCCESS_RATE    = 0.50  # fraction of contacted customers retained",
    "MONTHS_FORWARD          = 12",
    "",
    "rules_by_trigger = {r['trigger_key']: r for _, r in rules.iterrows()} if not rules.empty else {}",
    "",
    "PACKAGE_ARPU = [",
    "    (r'full fibre 9|g\\\\.?fast', 50),",
    "    (r'fibre 500',               47),",
    "    (r'fibre 150|fttp',          42),",
    "    (r'fibre 65|faster fibre',   35),",
    "    (r'fibre 35',                30),",
    "    (r'fast broadband|essentials|adsl', 25),",
    "]",
    "import re",
    "def package_arpu(pkg: str) -> float:",
    "    p = pkg or ''",
    "    for pat, v in PACKAGE_ARPU:",
    "        if re.search(pat, p, flags=re.IGNORECASE): return float(v)",
    "    return 32.0",
    "",
    "def is_eligible(row, rule) -> tuple[bool, str]:",
    "    if rule is None:",
    "        return False, 'no_rule_for_trigger'",
    "    pkgs = rule.get('eligible_packages') or []",
    "    pkg  = str(row.get('crm_package_name','')) or ''",
    "    if pkgs and not any(p.lower() in pkg.lower() or pkg.lower() in p.lower() for p in pkgs):",
    "        return False, 'package_not_eligible'",
    "",
    "    thr = [",
    "        ('min_loyalty_calls_90d',   float(row.get('loyalty_calls_90d', 0) or 0)),",
    "        ('min_hold_seconds',        float(row.get('total_hold_seconds', 0) or 0)),",
    "        ('min_ooc_days',            float(row.get('ooc_days', 0) or 0)),",
    "        ('min_monthly_download_gb', float(row.get('monthly_download_gb', 0) or 0)),",
    "    ]",
    "    for key, observed in thr:",
    "        v = rule.get(key)",
    "        if v is not None and not (pd.isna(v)) and observed < float(v):",
    "            return False, f'below_{key}'",
    "",
    "    sd_min = rule.get('min_speed_deficit_pct')",
    "    if sd_min is not None and not pd.isna(sd_min):",
    "        speed = float(row.get('speed', 0) or 0)",
    "        line  = float(row.get('line_speed', 0) or 0)",
    "        deficit = (speed - line) / speed if speed > 0 else 0.0",
    "        if deficit < float(sd_min):",
    "            return False, 'below_min_speed_deficit_pct'",
    "    return True, ''",
    "",
    "def top_reason(contribs: list[dict]) -> str:",
    "    return contribs[0]['feature'] if contribs else ''",
    "",
    "rows_out = []",
    "for _, r in df.iterrows():",
    "    if r['risk_score'] < CUSTOMER_RISK_THRESHOLD:",
    "        continue",
    "    rule = rules_by_trigger.get(r['nba_trigger'])",
    "    elig, reason = is_eligible(r, rule) if rule is not None else (False, 'no_rule_for_trigger')",
    "",
    "    arpu       = package_arpu(str(r.get('crm_package_name','')))",
    "    discount   = float(rule.get('discount_pct', 0)) if rule is not None else 0.0",
    "    cost       = float(rule.get('cost_per_contact_gbp', 0)) if rule is not None else 0.0",
    "    months     = int(rule.get('contract_months', MONTHS_FORWARD)) if rule is not None else MONTHS_FORWARD",
    "    expected   = r['risk_score'] * ASSUMED_SUCCESS_RATE * arpu * months",
    "    expected  -= cost",
    "",
    "    rows_out.append({",
    "        'customer_id':         r[ID],",
    "        'package':             r.get('crm_package_name',''),",
    "        'tenure_days':         int(r.get('tenure_days', 0) or 0),",
    "        'contract_status':     r.get('contract_clean',''),",
    "        'ooc_days':            int(r.get('ooc_days', 0) or 0),",
    "        'risk_score':          round(float(r['risk_score']), 4),",
    "        'risk_tier':           r['risk_tier'],",
    "        'top_reason':          top_reason(r['risk_contribs']),",
    "        'nba_trigger':         r['nba_trigger'],",
    "        'nba_label':           rule['label']    if rule is not None else r['nba_trigger'],",
    "        'channel':             rule['channel']  if rule is not None else '',",
    "        'discount_pct':        discount,",
    "        'contract_months':     months,",
    "        'cost_per_contact_gbp':cost,",
    "        'monthly_arpu_gbp':    round(arpu, 2),",
    "        'expected_save_gbp':   round(float(expected), 2),",
    "        'eligible':            bool(elig),",
    "        'ineligibility_reason':reason,",
    "    })",
    "",
    "offers = pd.DataFrame(rows_out).sort_values('risk_score', ascending=False).reset_index(drop=True)",
    "print(f'Customers above risk threshold {CUSTOMER_RISK_THRESHOLD}: {len(offers):,}')",
    "print(f'  · eligible:   {int(offers[\"eligible\"].sum()):,}')",
    "print(f'  · ineligible: {int((~offers[\"eligible\"]).sum()):,}')",
    "offers.head(10)"
  ),
  md("## 10 · Write `offline_offers.csv`"),
  code(
    "out_path = OUT / 'offline_offers.csv'",
    "offers.to_csv(out_path, index=False)",
    "",
    "print(f'✓ Wrote {len(offers):,} offers → {out_path.resolve()}')",
    "print('Columns:', list(offers.columns))",
    "",
    "# Quick sanity: NBA distribution among eligible customers",
    "if len(offers):",
    "    print()",
    "    print('Eligible NBA mix:')",
    "    print(offers[offers['eligible']]['nba_label'].value_counts())"
  ),
]);

// ============================================================
// README
// ============================================================
export const README_MD = `# TalkTalk NBA — Offline training kit

Two Jupyter notebooks that run on your laptop in VS Code. Lovable provides the
data and accepts the results back.

## One-time setup

\`\`\`bash
pip install pandas numpy scikit-learn pyarrow fastparquet xgboost
# optional, for SHAP-quality reason codes:
pip install shap

# macOS only — XGBoost needs OpenMP at runtime:
brew install libomp
\`\`\`

## Workflow

1. **Get the data.** In Lovable → Model page → External training kit, click each
   signed download link. Save the four files **into the same folder as the
   notebooks** (default \`DATA = '.'\`):
   - \`customer_info.parquet\` (or \`.csv\`)
   - \`calls.csv\`
   - \`cease.csv\`
   - \`usage.parquet\` (or \`.csv\`)

2. **Train.** Open \`train.ipynb\` in VS Code and run all cells. Produces
   \`model_metrics.json\`, \`model_artefact.pkl\`, \`feature_importance.csv\`.

3. **Score top 50.** Open \`score_top50.ipynb\` and run all cells. Produces
   \`top_50_customers.json\`.

4. **Import.** Back in Lovable → Model page → Import results, drop in
   \`model_metrics.json\` and \`top_50_customers.json\`. Dashboard model metrics
   and the Explainability "Top 50 most impacted customers" section light up
   immediately.

## Schema

Strictly the TalkTalk model:

| Table | Columns used |
|---|---|
| \`customer_info\` | \`unique_customer_identifier\`, \`contract_status\`, \`contract_dd_cancels\`, \`dd_cancel_60_day\`, \`ooc_days\`, \`technology\`, \`speed\`, \`line_speed\`, \`sales_channel\`, \`crm_package_name\`, \`tenure_days\` |
| \`calls\`         | \`unique_customer_identifier\`, \`event_date\`, \`call_type_key\`, \`talk_time_seconds\`, \`hold_time_seconds\` |
| \`usage\`         | \`unique_customer_identifier\`, \`calendar_date\`, \`usage_download_mbs\`, \`usage_upload_mbs\` |
| \`cease\`         | \`unique_customer_identifier\`, \`cease_placed_date\`, \`cease_completed_date\`, \`reason_description\`, \`reason_description_insight\` |

No attributes outside this schema are used.

## Why offline?

The dashboard runs on Lovable Cloud, whose edge runtime cannot execute
scikit-learn or XGBoost (no native binaries, hard CPU cap). Doing training on
your laptop gives you the full Python ecosystem and removes any size or time
pressure on Lovable storage.
`;
