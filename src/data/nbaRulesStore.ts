// NBA rule configuration backed by Lovable Cloud (public.nba_rules).
//
// One row per trigger key. The simulator, explainability page, and PDF all
// consume rules from here so an operator's edits in /nba-rules immediately
// flow into the financial model.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import type { NbaTriggerKey } from "./customers";

export type NbaRule = {
  id: string;
  triggerKey: NbaTriggerKey;
  label: string;
  description: string;
  channel: string;
  discountPct: number;        // 0..100
  contractMonths: number;
  eligiblePackages: string[]; // matches Product.name
  thresholds: {
    loyaltyCalls90d: number | null;
    holdSeconds: number | null;
    oocDays: number | null;
    speedDeficitPct: number | null; // 0..1
    monthlyDownloadGb: number | null;
  };
  costPerContactGbp: number;
  isActive: boolean;
  displayOrder: number;
};

type RulesState = {
  rules: NbaRule[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (rule: NbaRule) => Promise<void>;
  setLocal: (id: string, patch: Partial<NbaRule>) => void;
};

type DbRow = {
  id: string;
  trigger_key: string;
  label: string;
  description: string;
  channel: string;
  discount_pct: number;
  contract_months: number;
  eligible_packages: string[] | null;
  min_loyalty_calls_90d: number | null;
  min_hold_seconds: number | null;
  min_ooc_days: number | null;
  min_speed_deficit_pct: number | null;
  min_monthly_download_gb: number | null;
  cost_per_contact_gbp: number;
  is_active: boolean;
  display_order: number;
};

function fromDb(r: DbRow): NbaRule {
  return {
    id: r.id,
    triggerKey: r.trigger_key as NbaTriggerKey,
    label: r.label,
    description: r.description,
    channel: r.channel,
    discountPct: Number(r.discount_pct),
    contractMonths: r.contract_months,
    eligiblePackages: r.eligible_packages ?? [],
    thresholds: {
      loyaltyCalls90d: r.min_loyalty_calls_90d,
      holdSeconds: r.min_hold_seconds,
      oocDays: r.min_ooc_days,
      speedDeficitPct: r.min_speed_deficit_pct == null ? null : Number(r.min_speed_deficit_pct),
      monthlyDownloadGb: r.min_monthly_download_gb == null ? null : Number(r.min_monthly_download_gb),
    },
    costPerContactGbp: Number(r.cost_per_contact_gbp),
    isActive: r.is_active,
    displayOrder: r.display_order,
  };
}

export const useNbaRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loading: false,
  loaded: false,
  error: null,
  async load() {
    if (get().loading) return;
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("nba_rules")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) {
      set({ loading: false, loaded: true, error: error.message });
      return;
    }
    set({
      rules: (data as DbRow[]).map(fromDb),
      loading: false,
      loaded: true,
    });
  },
  async save(rule) {
    const { error } = await supabase
      .from("nba_rules")
      .update({
        label: rule.label,
        description: rule.description,
        channel: rule.channel,
        discount_pct: rule.discountPct,
        contract_months: rule.contractMonths,
        eligible_packages: rule.eligiblePackages,
        min_loyalty_calls_90d: rule.thresholds.loyaltyCalls90d,
        min_hold_seconds: rule.thresholds.holdSeconds,
        min_ooc_days: rule.thresholds.oocDays,
        min_speed_deficit_pct: rule.thresholds.speedDeficitPct,
        min_monthly_download_gb: rule.thresholds.monthlyDownloadGb,
        cost_per_contact_gbp: rule.costPerContactGbp,
        is_active: rule.isActive,
      })
      .eq("id", rule.id);
    if (error) {
      set({ error: error.message });
      return;
    }
    set((s) => ({ rules: s.rules.map((r) => (r.id === rule.id ? rule : r)) }));
  },
  setLocal(id, patch) {
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  },
}));
