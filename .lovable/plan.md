## Why the count is 945, not 3,545,538

The MotherDuck connection genuinely sees the full **3.5M** customer base — that's what the facets endpoint reports. The drop to **945** happens entirely in the browser-side hydrator that powers the dashboards:

1. On every page load, `src/data/liveCustomerHydrator.ts` calls `POST /api/admin/connections/snapshot-motherduck` with a hardcoded `rowLimit: 5_000` (line 139).
2. The server endpoint `api.admin.connections.snapshot-motherduck.ts` itself caps `rowLimit` at **20,000** (line 41: `Math.min(20_000, …)`).
3. The 5,000 raw `customer_info` rows are then run through `mapCustomers` in `customerMapping.ts`, which dedupes by `unique_customer_identifier` and drops rows missing required fields — that filter is what produces the **945** unique customers actually loaded into the in-memory store.
4. Every drilldown (Explainability, Net ROI, Top Impacted, etc.) reads from this in-memory store, so they all inherit the 945-customer ceiling.

In short: the "live" badge is honest about the connection but dishonest about the scope. The analysis is **not** running on the full base — it's running on a 5,000-row uniform sample that collapses to ~945 usable customers.

## Why we cannot just load all 3.5M

The dashboards (charts, sortable tables, SHAP drilldowns, ROI sims) hold every customer in browser memory and re-score them client-side on every filter change. 3.5M rows × ~40 fields would be ~1–2 GB of JSON over the wire and would lock up the tab. The right fix is **server-side aggregation for KPIs/charts** plus a **larger working sample for drilldown**, not "ship everything to the browser."

## Plan

### 1. Raise the working-sample ceiling (fast win)
- Bump the snapshot hardcap in `api.admin.connections.snapshot-motherduck.ts` from 20,000 → **250,000**.
- Bump the hydrator's request from `5_000` → **100,000** (configurable, see step 3).
- Switch `customer_info` selection from `ORDER BY unique_customer_identifier LIMIT N` to `USING SAMPLE N ROWS` so the loaded set is a uniform random sample of the full base, not the alphabetically-first slice.
- Stream the response (NDJSON) instead of buffering the full JSON array, and parse incrementally in the hydrator to keep peak memory bounded.

This alone takes drilldown from 945 → ~50–80k unique customers, statistically representative of all 3.5M.

### 2. True full-population KPIs (correctness win)
Add a new endpoint `POST /api/admin/connections/aggregate-motherduck` that runs the headline statistics **inside MotherDuck** against the full table — no row transfer:
- Total customers, churn-tier distribution, revenue-at-risk, ARPU bands, region/package/contract breakdowns, tenure histogram, NBA-eligible counts.
- Returns a small JSON aggregate (~tens of KB) regardless of base size.

Wire the Executive Summary, ROI Simulator headline, and Strategy KPIs to this endpoint when MotherDuck is the active source, so the *numbers* reflect 3.5M even though the *drilldown table* shows the 100k sample.

### 3. Make the cap visible and adjustable
- Show "**100,000 of 3,545,538 customers loaded** (uniform random sample · headline KPIs computed on full base)" in the Active customer source card on `/data`, replacing the misleading "945 customers loaded".
- Add a numeric input (default 100k, max 250k) in the MotherDuck connector card so an admin can tune the working-sample size for their machine.
- Persist the chosen size on the `data_connections.config` row so it survives reloads.

### 4. Targeted single-customer lookup stays full-base
The existing `/api/admin/connections/query-motherduck` endpoint already accepts `customerId` and queries MotherDuck live for any specific identifier. Surface a "Look up any customer (full 3.5M base)" search box on the Explainability page that calls this endpoint and injects the result into the in-memory store on demand — so even though the bulk drilldown is sampled, any individual customer in the full base can be inspected.

## Technical details

- **Files to edit**
  - `src/routes/api.admin.connections.snapshot-motherduck.ts` — raise cap, switch to `USING SAMPLE`, stream NDJSON.
  - `src/data/liveCustomerHydrator.ts` — request 100k, parse stream, read configured size from connection.
  - `src/routes/api.admin.connections.aggregate-motherduck.ts` — new endpoint returning full-base aggregates.
  - `src/routes/data.tsx` — fix the "Active customer source" line; add sample-size control.
  - `src/routes/index.tsx` / `src/routes/strategy.tsx` / `src/components/RoiSimulator.tsx` — read headline KPIs from the new aggregate endpoint when source is MotherDuck.
  - `src/routes/explainability.tsx` — add full-base customer lookup that hits `query-motherduck`.

- **Why ~945 specifically**: `mapCustomers` requires non-null `unique_customer_identifier`, `tenure_months`, `mrr` and a parseable `package`. On the 5,000-row alphabetical slice currently pulled, only ~945 rows satisfy all four. Switching to `USING SAMPLE` plus the larger N also raises the keep-rate because the sample is no longer biased to one corner of the table.

- **No database migrations required.** Connector config is stored in the existing `data_connections.config` JSONB column.

- **No new secrets / connectors.** Uses the existing MotherDuck connection.

## Out of scope (call out, do not implement)

- Replacing the in-memory client store with a server-paged grid for the customer list — much larger refactor; the 100k working sample + full-base aggregates closes the credibility gap without it.
- Caching aggregates in Postgres — MotherDuck is fast enough at this size; we can revisit if latency becomes a problem.