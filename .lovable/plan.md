# Plan

Four independent fixes on the **Explainability** page and supporting data layer.

---

## 1. Accurate per-customer expected-save calculation

**Problem.** Two places use bad assumptions:
- `code/2 score_top50.ipynb` (and the bundled copy in `src/data/trainingScripts.ts`) computes `expected_save = churn_prob × £25 ARPU × 12 × 0.5`. The 50% success rate is a **portfolio** assumption, not an individual one, and £25 is a flat ARPU.
- `src/routes/explainability.tsx` `CustomerDetail` does `ltv − dilution − costToServe`, which doesn't even multiply by churn probability and ignores flat credits / engineer dispatch costs.

**Fix — new helper `computeCustomerExpectedSave()` in `src/data/financials.ts`:**

For an individual customer:
```
arpuMonthly      = nearestArpuFromLineSpeed(customer)         // see §1a
horizonMonths    = matchedRule.contractMonths || 24
churnProb        = customer.riskScore
discountPct      = matchedRule.discountPct
flatCreditGbp    = matchedRule.flatCreditGbp ?? 0             // NEW field
costPerContact   = matchedRule.costPerContactGbp
engineerCostGbp  = matchedRule.engineerCostGbp ?? 0           // NEW field

grossRetained    = churnProb × arpuMonthly × horizonMonths
discountDilution = churnProb × arpuMonthly × horizonMonths × (discountPct/100)
flatCredit       = churnProb × flatCreditGbp                  // one-off, weighted
costToServe      = costPerContact + engineerCostGbp           // per individual
expectedSaveGbp  = grossRetained − discountDilution − flatCredit − costToServe
```

Key change vs today: **NO 50% success-rate factor at the individual level** — that's a campaign-level conversion rate, not a per-customer probability.

### 1a. ARPU from line speed via TalkTalk catalogue

New helper `arpuFromLineSpeed(speedMbps, products)` in `src/data/products.ts`:
- Only consider active Broadband + TalkTalk U products.
- Return `monthlyPriceGbp` of the product whose `speedMbps` is closest to the customer's `signals.lineSpeedMbps` (fallback to current `customer.monthlyArpu` if no signal).

### 1b. Schema additions for rules

Migration on `nba_rules`:
```sql
ALTER TABLE public.nba_rules
  ADD COLUMN flat_credit_gbp numeric NOT NULL DEFAULT 0,
  ADD COLUMN engineer_cost_gbp numeric NOT NULL DEFAULT 0;
```
Surface both fields in `nbaRulesStore.ts` and the `/nba-rules` editor so an operator can model the **£15 service credit** and the **engineer dispatch cost** the treatment matrix already references.

### 1c. Wire it in

- **`CustomerDetail`** (Explainability inline + drawer): replace the current `ltv/dilution/cost` pills with the new breakdown — Gross retained, Discount dilution, Flat credit, Cost-to-serve, **Expected save (£)**.
- **`TopImpactedCustomers`**: recompute `expected_save_gbp` on the fly using the same helper (rather than the stored placeholder), so the table is consistent with the customer drawer.

---

## 2. Top-50 profile drawer

In `src/components/TopImpactedCustomers.tsx`:
- Add a "View profile" trigger on each row.
- Open the same right-side `<Sheet>` used by the search list, rendering `CustomerDetail`.
- Need to convert the `top_customers` row → `Customer` shape: lift the existing mapping logic out of `liveCustomerHydrator` into a small `topCustomerToCustomer()` helper, or fetch the live row from MotherDuck on demand using `/api/admin/connections/customer-detail-motherduck` (already exists) when MotherDuck is enabled, otherwise fall back to the persisted `features` JSON.

The drawer state and `CustomerDetail` are already exported in `explainability.tsx`; export `CustomerDetail` from there or move it to its own file (`src/components/CustomerDetail.tsx`) so both consumers share it.

---

## 3. Customer search reliability

### 3a. Loading indicator while results stale
- Currently `liveBusy` only colours the Search button. Add a full overlay (semi-opaque + spinner) on the results list when `liveBusy && visibleCustomers.length>0` so the analyst clearly sees the previous results are out-of-date.
- Disable row clicks while `liveBusy`.

### 3b. Filter on churn probability & risk tier
- `riskTiers` filter UI already exists in `CustomerFiltersBar` — but it's not wired into MotherDuck (server endpoint ignores `riskTiers`). Add a `churnProbability { min, max }` (0–1) filter to `CustomerFilters` + UI slider.
- Server `search-motherduck`: derive risk tier and churn probability live using the same scoring formula used elsewhere (or, if the table has a `risk_score`/`churn_prob` column, pick it via the same `pick(...)` helper). Add `addRange(churnProbCol, f.churnProbability)` and a tier WHERE clause that maps tiers → score bands (High ≥0.7, Medium 0.4–0.7, Low <0.4).

### 3c. Exact-ID lookup fallback to MotherDuck

Today, in non-MotherDuck mode the search is only the in-memory store; in MotherDuck mode it hits the live table but the analyst gets nothing if the ID isn't found.
- When the local search returns 0 rows and the input *looks like* a customer ID (UUID/long alphanumeric), call the existing `/api/admin/connections/customer-detail-motherduck` endpoint as a fallback.
- If found: prepend the result with a yellow "Live lookup · data limited (no behavioural enrichment)" badge.
- If not found: call a new `/api/admin/connections/search-motherduck` request with `q=input` (already supports ILIKE) and surface the top 5 closest matches under a "Did you mean…" header.
- All while showing the spinner (§3a).

---

## 4. Correct feature importance

The shipped `out/feature_importance.csv` (XGBoost gain) doesn't match the hard-coded list in `src/data/nba.ts`. The screenshot the user sent matches the CSV exactly.

Replace `featureImportance` and add labels in `src/data/nba.ts`:
```ts
export const featureImportance = [
  { feature: "tenure_days",         importance: 0.314 },
  { feature: "contract_dd_cancels", importance: 0.195 },
  { feature: "dd_cancel_60_day",    importance: 0.136 },
  { feature: "ooc_days",            importance: 0.086 },
  { feature: "avg_talk_seconds",    importance: 0.078 },
  { feature: "avg_hold_seconds",    importance: 0.066 },
  { feature: "speed",               importance: 0.040 },
  { feature: "line_speed",          importance: 0.030 },
  { feature: "avg_upload_mbs",      importance: 0.023 },
  { feature: "avg_download_mbs",    importance: 0.019 },
  { feature: "loyalty_calls_90d",   importance: 0.014 },
  // The four zero-importance categoricals are intentionally omitted from the chart.
];
```
Update `featureLabels` to add `avg_talk_seconds`, `avg_hold_seconds`, `speed`, `line_speed`, `avg_upload_mbs`, `loyalty_calls_90d`. Update the section subtitle ("9 features" → "11 active features · 4 zero-gain") and AUC chip (keep 0.85 from `model_training_stats.json` — currently shows 0.87).

---

## Files touched

- `src/data/nba.ts` — corrected feature importance + labels.
- `src/data/financials.ts` — `computeCustomerExpectedSave()`, accepts new rule fields.
- `src/data/products.ts` — `arpuFromLineSpeed()` helper.
- `src/data/nbaRulesStore.ts` — load/save `flatCreditGbp`, `engineerCostGbp`.
- `src/routes/nba-rules.tsx` — editor inputs for the two new fields.
- DB migration adding the two columns to `nba_rules`.
- `src/components/CustomerDetail.tsx` (extracted) — new shared component using the helper.
- `src/routes/explainability.tsx` — uses extracted component, adds search loading overlay, churn-prob filter, MotherDuck ID fallback.
- `src/components/CustomerFiltersBar.tsx` — add churn-probability slider, ensure risk-tier filter applies.
- `src/routes/api.admin.connections.search-motherduck.ts` — handle `riskTiers` and `churnProbability` filters.
- `src/components/TopImpactedCustomers.tsx` — profile drawer + recompute expected save with shared helper.

No changes to the Python notebooks themselves — the fix lives in the app, where the live data is. The notebook-side placeholder remains documented as such.
