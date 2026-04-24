// Live-data overlay store.
// Loads the latest successful model_run + active data_source_files and exposes
// them to pages. Pages keep their hardcoded fallbacks; when a live value is
// present, the page should prefer it and surface a "Live" badge — otherwise
// the existing "Sample data" fallback is shown.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

export type LiveModelStats = {
  model_type?: string;
  hyperparameters?: Record<string, unknown>;
  performance_metrics?: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1_score?: number;
    roc_auc?: number;
  };
  confusion_matrix?: {
    true_negatives?: number;
    false_positives?: number;
    false_negatives?: number;
    true_positives?: number;
  };
  dataset_split?: { train_size?: number; test_size?: number };
  // Optional richer fields produced by an external trainer:
  roc_curve?: Array<{ fpr: number; tpr: number; threshold: number }>;
  segment_metrics?: Array<{
    segment: string;
    precision: number;
    recall: number;
    n: number;
  }>;
  feature_importance?: Array<{ feature: string; importance: number }>;
  roi_params?: {
    totalCustomerBase?: number;
    highRiskVolume?: number;
    averageAnnualArpuGbp?: number;
    baselineRetentionConversionRate?: number;
    revenueAtRiskGbp?: number;
  };
  segment_summary?: Array<{
    tier: "High" | "Medium" | "Low";
    customerCount: number;
    avgTenureDays: number;
    avgRiskScore: number;
    dominantPackage: string;
  }>;
};

export type LiveRunMeta = {
  id: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  databricksRunId: string | null;
};

type LiveDataStore = {
  loaded: boolean;
  loading: boolean;
  stats: LiveModelStats | null;
  run: LiveRunMeta | null;
  /**
   * Fetch the latest successful model_runs row.
   * Pass `force: true` to bypass the "already loaded" guard — needed after
   * the user signs in (the initial pre-auth call returns null due to RLS)
   * or after a fresh import via the External Training Kit.
   */
  load: (force?: boolean) => Promise<void>;
};

export const useLiveDataStore = create<LiveDataStore>((set, get) => ({
  loaded: false,
  loading: false,
  stats: null,
  run: null,
  load: async (force = false) => {
    const state = get();
    if (state.loading) return;
    // Skip the implicit on-mount call once we already have stats; always
    // honour explicit `force` requests so post-login / post-import refreshes
    // re-read the row that RLS previously hid.
    if (!force && state.loaded && state.stats) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from("model_runs")
        .select("id, metrics, finished_at, triggered_by, databricks_run_id")
        .eq("status", "success")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data && data.metrics) {
        set({
          stats: data.metrics as LiveModelStats,
          run: {
            id: data.id,
            finishedAt: data.finished_at,
            triggeredBy: data.triggered_by,
            databricksRunId: data.databricks_run_id,
          },
        });
      }
    } catch (e) {
      // Non-fatal: pages just stay on fallback data.
      console.warn("[liveDataStore] load failed", e);
    } finally {
      set({ loaded: true, loading: false });
    }
  },
}));
