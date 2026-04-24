## Why metrics don't show even though they're stored

I confirmed the data is in the database:

- `model_runs` has one `status='success'` row with a 7,305-byte `metrics` JSON containing `performance_metrics`, `confusion_matrix`, `hyperparameters`, `dataset_split`, `roc_curve`, `segment_metrics`, `feature_importance` — exactly what the Model page expects.

But the page still shows blank KPIs because of a **load-order bug** in the live-data hydrator:

1. `LiveDataHydrator` lives in `src/routes/__root.tsx` and runs on app boot, **before** `AuthGate` lets the user sign in.
2. On that first call, `supabase.auth.getSession()` returns no session, so the `model_runs` RLS policy (`is_active_user(auth.uid())`) blocks the read and the query returns `null`.
3. `liveDataStore.load()` then sets `loaded: true` with `stats: null`.
4. Every subsequent call to `load()` short-circuits on `if (get().loading || get().loaded) return;` — so after sign-in, after a fresh import, or on a route change, the store **never refetches**.
5. `model.tsx` derives `isLive = !!(liveStats?.performance_metrics && liveStats.confusion_matrix)`. With `liveStats === null`, `isLive` is false and every KPI renders as `null` (blank).

The "Import results" flow inserts straight into `model_runs` via the admin endpoint, so the row is there — but nothing tells the client store to re-read it.

## Fix

Three small, surgical changes — no schema change, no UI redesign.

### 1. `src/data/liveDataStore.ts` — make `load()` refetchable

- Add a `force?: boolean` parameter that bypasses the `loaded` short-circuit.
- Re-running the query is cheap (single row, indexed) so we can also drop the unconditional gate when called explicitly.
- Keep the implicit on-mount call idempotent (still skips when already loading or already populated with non-null stats).

### 2. `src/routes/__root.tsx` — re-hydrate when auth state changes

- In `LiveDataHydrator`, also subscribe to `useAuth()` (or a `session`/`isAdmin` selector) and call `load(true)` whenever the user transitions from signed-out → signed-in. This is the missing trigger that currently leaves the store stuck on the failed pre-auth read.

### 3. `src/components/ExternalTrainingKit.tsx` — refresh after import

- After a successful `submitImport()`, call `useLiveDataStore.getState().load(true)` (alongside the existing `refreshTopCount()`). This way the Model page lights up immediately on the next visit without needing a hard reload.

### Optional polish (only if trivial)

- Add a tiny "Refresh" affordance on the Model page header that calls `load(true)` — useful if a user opens the page in another tab after a teammate runs training. Not required to fix the bug.

## Files touched

- `src/data/liveDataStore.ts`
- `src/routes/__root.tsx`
- `src/components/ExternalTrainingKit.tsx`

## Verification after implementation

1. Hard-reload `/model` while signed in → KPI tiles populate from the stored run (Accuracy, Precision, Recall, F1, ROC-AUC, confusion matrix, hyperparameters, ROC curve, segment breakdown).
2. Re-import `model_metrics.json` → tiles update without a manual reload.
3. Sign out and back in → tiles still populate (no stale `loaded: true` lockout).
