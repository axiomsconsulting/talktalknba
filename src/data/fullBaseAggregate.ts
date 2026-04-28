import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FullBaseAggregate = {
  totalCustomers: number;
  totalActive: number;
  totalCeased: number;
  totalRevenueMrr: number;
  averageMrr: number;
  averageTenureMonths: number;
  tierCounts: { tier: string; customers: number; avgTenureDays: number; avgRiskScore: number }[];
  packageBreakdown: { package: string; customers: number; mrr: number }[];
  contractBreakdown: { status: string; customers: number }[];
  regionBreakdown: { region: string; customers: number }[];
  tenureHistogram: { bucket: string; customers: number }[];
  loyaltyHistogram: { bucket: string; customers: number }[];
  holdHistogram: { bucket: string; customers: number }[];
  downloadHistogram: { bucket: string; customers: number }[];
  triggerCounts: Record<string, number>;
  callsCoverage: { customersWithLoyaltyCalls: number; sumLoyaltyCalls: number; sumHoldSeconds: number };
  usageCoverage: { customersWithUsage: number; avgDownloadGb: number; avgUploadGb: number };
  ceaseCoverage: { customers: number };
  topCustomers: Array<{
    rank: number;
    customer_id: string;
    churn_prob: number;
    tier: string;
    package: string | null;
    region: string | null;
    contract_status: string | null;
    monthly_arpu: number | null;
    tenure_months: number | null;
    recommended_nba: string | null;
  }>;
  computedAt: string;
  cached?: boolean;
};

let cached: { value: FullBaseAggregate; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Fetches headline statistics computed inside MotherDuck against the FULL
 * customer base. Server caches in `md_aggregate_cache` (Supabase) keyed by
 * "motherduck:fullbase:v2"; pass `force: true` to recompute (used by the
 * "Full resync" button on /data).
 */
export async function fetchFullBaseAggregate(
  opts: { force?: boolean } = {},
): Promise<FullBaseAggregate | null> {
  if (!opts.force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const { data: conn } = await supabase
    .from("data_connections")
    .select("id, enabled")
    .eq("kind", "motherduck")
    .maybeSingle();
  if (!conn?.enabled) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  try {
    const res = await fetch("/api/admin/connections/aggregate-motherduck", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ force: !!opts.force }),
    });
    if (!res.ok) return null;
    const value = (await res.json()) as FullBaseAggregate;
    cached = { value, at: Date.now() };
    return value;
  } catch (e) {
    console.warn("[fullBaseAggregate] fetch failed", e);
    return null;
  }
}

/** React hook wrapper. */
export function useFullBaseAggregate(): FullBaseAggregate | null {
  const [value, setValue] = useState<FullBaseAggregate | null>(cached?.value ?? null);
  useEffect(() => {
    let alive = true;
    fetchFullBaseAggregate().then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

/** Invalidate the in-memory hook cache (used after a server resync). */
export function invalidateFullBaseAggregateCache() {
  cached = null;
}
