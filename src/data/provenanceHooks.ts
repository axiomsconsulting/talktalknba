// Helper to derive provenance objects from current live/customer store state.
// Centralises the policy so pages don't make up their own labels.

import type { Provenance } from "./provenance";
import { useLiveDataStore } from "./liveDataStore";
import { useCustomerStore } from "./customerStore";

/** True when a successful model run has been ingested. */
export function useHasLiveModel(): boolean {
  return useLiveDataStore((s) => !!s.stats?.performance_metrics);
}

/** True when there is any active customer source (upload OR live integration). */
export function useHasActiveCustomerSource(): boolean {
  return useCustomerStore((s) => s.source.kind === "uploaded");
}

/** Provenance for figures coming out of the trained model. */
export function useModelProv(metric: string, formula?: string): Provenance | null {
  const liveStats = useLiveDataStore((s) => s.stats);
  const liveRun = useLiveDataStore((s) => s.run);
  if (!liveStats?.performance_metrics) return null;
  return {
    kind: "model",
    source: liveRun?.databricksRunId
      ? `Trained model · run ${liveRun.databricksRunId} · ${metric}`
      : `Trained model · ${metric}`,
    formula,
  };
}

/** Provenance for figures derived from the customer dataset (upload or live). */
export function useDatasetProv(metric: string, formula?: string): Provenance | null {
  const source = useCustomerStore((s) => s.source);
  if (source.kind === "mock" || source.kind === "empty") return null;
  return {
    kind: source.origin === "live" ? "live" : "upload",
    source: `${source.detail ?? source.filename} · ${metric}`,
    formula,
  };
}

/** Provenance for deterministic rule output applied to a connected dataset. */
export function useRuleProv(rule: string, formula?: string): Provenance | null {
  const source = useCustomerStore((s) => s.source);
  if (source.kind === "mock" || source.kind === "empty") return null;
  return {
    kind: "rule",
    source: `Heuristic rule · ${rule} · applied to ${source.detail ?? source.filename}`,
    formula,
  };
}
