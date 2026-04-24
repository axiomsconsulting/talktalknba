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
    "    json.dump(metrics, f, indent=2, default=str)",
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
    "import json, pickle",
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
    "`expected_save_gbp` is a placeholder estimate (`prob × £25 ARPU × 12 months × 50% success`); the schema does not carry ARPU so we use a flat assumption."
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
    "    records.append({",
    "        'customer_id':       cust_id,",
    "        'rank':              int(i + 1),",
    "        'churn_prob':        float(row['churn_prob']),",
    "        'reason_codes':      rs,",
    "        'recommended_nba':   nba,",
    "        'expected_save_gbp': round(expected_save, 2),",
    "        'features':          feature_payload,",
    "    })",
    "",
    "records[:3]"
  ),
  md("## 7 · Write `top_50_customers.json`"),
  code(
    "payload = {",
    "    'model_type': model_type,",
    "    'threshold':  threshold,",
    "    'scored_n':   int(len(df)),",
    "    'customers':  records,",
    "}",
    "with open(OUT / 'top_50_customers.json', 'w') as f:",
    "    json.dump(payload, f, indent=2, default=str)",
    "",
    "print(f'✓ Scored {len(df):,} customers, picked top {len(records)}.')",
    "print('✓ top_50_customers.json written — upload via Lovable → Model → Import results.')"
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
