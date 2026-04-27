import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FullBaseAggregate = {
  totalCustomers: number;
  totalActive: number;
  totalCeased: number;
  totalRevenueMrr: number;
  averageMrr: number;
  averageTenureMonths: number;
  packageBreakdown: { package: string; customers: number; mrr: number }[];
  contractBreakdown: { status: string; customers: number }[];
  regionBreakdown: { region: string; customers: number }[];
  tenureHistogram: { bucket: string; customers: number }[];
  computedAt: string;
};

let cached: { value: FullBaseAggregate; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Fetches headline statistics computed inside MotherDuck against the FULL
 * customer base (no row transfer). Returns null when MotherDuck is not the
 * active source or the user is not an admin.
 *
 * Cached for 5 minutes — these aggregates don't change minute-to-minute.
 */
export async function fetchFullBaseAggregate(
  opts: { force?: boolean } = {},
): Promise<FullBaseAggregate | null> {
  if (!opts.force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  // Skip the network round-trip if MotherDuck isn't enabled.
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
      body: JSON.stringify({}),
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
