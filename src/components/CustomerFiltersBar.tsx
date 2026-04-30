// Reusable customer filter bar.
//
// Supports:
//   - Discrete multi-select chips: region, package, contract_status, risk tier,
//     persona, NBA trigger
//   - Numeric range sliders: tenure (months), MRR (£), monthly download (GB),
//     speed deficit (%), hold seconds, loyalty calls (90d)
//
// Facet ranges/values are sourced from MotherDuck when active (via the
// /api/admin/connections/facets-motherduck route). Otherwise they're derived
// from the in-memory Customer[] passed in.
//
// Filters are applied locally to in-memory customers via `applyCustomerFilters`,
// and serialised for the MotherDuck search endpoint via `filtersToQueryBody`.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Filter, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Customer, NbaTriggerKey } from "@/data/customers";
import { NBA_TRIGGERS } from "@/data/customers";
import { cn } from "@/lib/utils";

export type CustomerFilters = {
  regions: string[];
  packages: string[];
  contractStatuses: string[];
  riskTiers: string[]; // "Low" | "Medium" | "High"
  personas: string[];
  nbaTriggers: NbaTriggerKey[];
  tenureMonths: { min: number; max: number } | null;
  mrrGbp: { min: number; max: number } | null;
  monthlyDownloadGb: { min: number; max: number } | null;
  speedDeficitPct: { min: number; max: number } | null;
  loyaltyCalls90d: { min: number; max: number } | null;
  holdSeconds: { min: number; max: number } | null;
  // 0..1 — model churn probability
  churnProbability: { min: number; max: number } | null;
};

export const EMPTY_FILTERS: CustomerFilters = {
  regions: [],
  packages: [],
  contractStatuses: [],
  riskTiers: [],
  personas: [],
  nbaTriggers: [],
  tenureMonths: null,
  mrrGbp: null,
  monthlyDownloadGb: null,
  speedDeficitPct: null,
  loyaltyCalls90d: null,
  holdSeconds: null,
  churnProbability: null,
};

export type FilterFacets = {
  regions: string[];
  packages: string[];
  contractStatuses: string[];
  riskTiers: string[];
  personas: string[];
  nbaTriggers: { key: NbaTriggerKey; label: string }[];
  tenureMonths: { min: number; max: number };
  mrrGbp: { min: number; max: number };
  monthlyDownloadGb: { min: number; max: number };
  speedDeficitPct: { min: number; max: number };
  loyaltyCalls90d: { min: number; max: number };
  holdSeconds: { min: number; max: number };
};

const DEFAULT_FACETS: FilterFacets = {
  regions: [],
  packages: [],
  contractStatuses: [],
  riskTiers: ["Low", "Medium", "High"],
  personas: [],
  nbaTriggers: (Object.keys(NBA_TRIGGERS) as NbaTriggerKey[]).map((k) => ({
    key: k,
    label: NBA_TRIGGERS[k]?.label ?? k,
  })),
  tenureMonths: { min: 0, max: 60 },
  mrrGbp: { min: 0, max: 100 },
  monthlyDownloadGb: { min: 0, max: 1500 },
  speedDeficitPct: { min: 0, max: 100 },
  loyaltyCalls90d: { min: 0, max: 10 },
  holdSeconds: { min: 0, max: 3600 },
};

/** Derive facets from an in-memory Customer[] when the live source is offline. */
export function deriveFacetsFromCustomers(customers: Customer[]): FilterFacets {
  if (customers.length === 0) return DEFAULT_FACETS;
  const regions = unique(customers.map((c) => c.region));
  const packages = unique(customers.map((c) => c.package));
  const contractStatuses = unique(customers.map((c) => c.contractStatus));
  const riskTiers = unique(customers.map((c) => c.riskTier));
  const personas = unique(customers.map((c) => c.persona ?? "").filter(Boolean));
  const tenureMonthsArr = customers.map((c) => Math.round(c.tenureDays / 30));
  const mrrArr = customers.map((c) => c.monthlyArpu);
  const dlArr = customers.map((c) => c.signals?.monthlyDownloadGb ?? 0);
  const speedDef = customers
    .map((c) => {
      const sold = c.signals?.soldSpeedMbps ?? 0;
      const line = c.signals?.lineSpeedMbps ?? 0;
      return sold > 0 ? Math.max(0, Math.round(((sold - line) / sold) * 100)) : 0;
    });
  const loyaltyArr = customers.map((c) => c.signals?.loyaltyCalls90d ?? 0);
  const holdArr = customers.map((c) => c.signals?.totalHoldSeconds ?? 0);

  return {
    regions,
    packages,
    contractStatuses,
    riskTiers,
    personas,
    nbaTriggers: DEFAULT_FACETS.nbaTriggers,
    tenureMonths: rangeOf(tenureMonthsArr, 0, 60),
    mrrGbp: rangeOf(mrrArr, 0, 100),
    monthlyDownloadGb: rangeOf(dlArr, 0, 1500),
    speedDeficitPct: rangeOf(speedDef, 0, 100),
    loyaltyCalls90d: rangeOf(loyaltyArr, 0, 10),
    holdSeconds: rangeOf(holdArr, 0, 3600),
  };
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean))).sort();
}

function rangeOf(arr: number[], minDef: number, maxDef: number) {
  const finite = arr.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return { min: minDef, max: maxDef };
  return {
    min: Math.floor(Math.min(...finite)),
    max: Math.max(maxDef, Math.ceil(Math.max(...finite))),
  };
}

/** Hook: fetch facets from MotherDuck when enabled, else compute in-memory. */
export function useCustomerFacets(opts: {
  customers: Customer[];
  liveEnabled: boolean;
}): FilterFacets {
  const { customers, liveEnabled } = opts;
  const inMemory = useMemo(() => deriveFacetsFromCustomers(customers), [customers]);
  const [live, setLive] = useState<FilterFacets | null>(null);

  useEffect(() => {
    if (!liveEnabled) { setLive(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch("/api/admin/connections/facets-motherduck", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as Partial<FilterFacets> & {
          regions?: string[]; packages?: string[]; contractStatuses?: string[];
          tenureMonths?: { min: number; max: number };
          mrrGbp?: { min: number; max: number };
          monthlyDownloadGb?: { min: number; max: number };
          speedDeficitPct?: { min: number; max: number };
          loyaltyCalls90d?: { min: number; max: number };
          holdSeconds?: { min: number; max: number };
        };
        if (cancelled) return;
        setLive({
          ...inMemory, // baseline (covers personas/triggers/risk tiers)
          regions: json.regions ?? inMemory.regions,
          packages: json.packages ?? inMemory.packages,
          contractStatuses: json.contractStatuses ?? inMemory.contractStatuses,
          tenureMonths: json.tenureMonths ?? inMemory.tenureMonths,
          mrrGbp: json.mrrGbp ?? inMemory.mrrGbp,
          monthlyDownloadGb: json.monthlyDownloadGb ?? inMemory.monthlyDownloadGb,
          speedDeficitPct: json.speedDeficitPct ?? inMemory.speedDeficitPct,
          loyaltyCalls90d: json.loyaltyCalls90d ?? inMemory.loyaltyCalls90d,
          holdSeconds: json.holdSeconds ?? inMemory.holdSeconds,
        });
      } catch (e) {
        console.warn("[useCustomerFacets] live facets failed", e);
      }
    })();
    return () => { cancelled = true; };
    // intentionally only refetch when liveEnabled flips, not on every customers change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEnabled]);

  return live ?? inMemory;
}

/** Apply filters to an in-memory Customer[]. */
export function applyCustomerFilters(
  customers: Customer[],
  f: CustomerFilters,
): Customer[] {
  return customers.filter((c) => {
    if (f.regions.length && !f.regions.includes(c.region)) return false;
    if (f.packages.length && !f.packages.includes(c.package)) return false;
    if (f.contractStatuses.length && !f.contractStatuses.includes(c.contractStatus)) return false;
    if (f.riskTiers.length && !f.riskTiers.includes(c.riskTier)) return false;
    if (f.personas.length && !f.personas.includes(c.persona ?? "")) return false;
    if (f.nbaTriggers.length && (!c.nbaTrigger || !f.nbaTriggers.includes(c.nbaTrigger))) return false;

    const tenureMonths = c.tenureDays / 30;
    if (f.tenureMonths && (tenureMonths < f.tenureMonths.min || tenureMonths > f.tenureMonths.max)) return false;
    if (f.mrrGbp && (c.monthlyArpu < f.mrrGbp.min || c.monthlyArpu > f.mrrGbp.max)) return false;

    const dl = c.signals?.monthlyDownloadGb ?? 0;
    if (f.monthlyDownloadGb && (dl < f.monthlyDownloadGb.min || dl > f.monthlyDownloadGb.max)) return false;

    const sold = c.signals?.soldSpeedMbps ?? 0;
    const line = c.signals?.lineSpeedMbps ?? 0;
    const deficit = sold > 0 ? Math.max(0, Math.round(((sold - line) / sold) * 100)) : 0;
    if (f.speedDeficitPct && (deficit < f.speedDeficitPct.min || deficit > f.speedDeficitPct.max)) return false;

    const loyalty = c.signals?.loyaltyCalls90d ?? 0;
    if (f.loyaltyCalls90d && (loyalty < f.loyaltyCalls90d.min || loyalty > f.loyaltyCalls90d.max)) return false;

    const hold = c.signals?.totalHoldSeconds ?? 0;
    if (f.holdSeconds && (hold < f.holdSeconds.min || hold > f.holdSeconds.max)) return false;

    if (
      f.churnProbability &&
      (c.riskScore < f.churnProbability.min || c.riskScore > f.churnProbability.max)
    )
      return false;

    return true;
  });
}

/** Serialise filters into the MotherDuck search-motherduck endpoint body. */
export function filtersToQueryBody(f: CustomerFilters) {
  const out: Record<string, unknown> = {};
  if (f.regions.length) out.regions = f.regions;
  if (f.packages.length) out.packages = f.packages;
  if (f.contractStatuses.length) out.contractStatuses = f.contractStatuses;
  if (f.riskTiers.length) out.riskTiers = f.riskTiers;
  if (f.personas.length) out.personas = f.personas;
  if (f.nbaTriggers.length) out.nbaTriggers = f.nbaTriggers;
  if (f.tenureMonths) out.tenureMonths = f.tenureMonths;
  if (f.mrrGbp) out.mrrGbp = f.mrrGbp;
  if (f.monthlyDownloadGb) out.monthlyDownloadGb = f.monthlyDownloadGb;
  if (f.speedDeficitPct) out.speedDeficitPct = f.speedDeficitPct;
  if (f.loyaltyCalls90d) out.loyaltyCalls90d = f.loyaltyCalls90d;
  if (f.holdSeconds) out.holdSeconds = f.holdSeconds;
  if (f.churnProbability) out.churnProbability = f.churnProbability;
  return out;
}

/** Count active filter clauses (used for the "Filters · N" badge). */
export function countActiveFilters(f: CustomerFilters): number {
  let n = 0;
  if (f.regions.length) n++;
  if (f.packages.length) n++;
  if (f.contractStatuses.length) n++;
  if (f.riskTiers.length) n++;
  if (f.personas.length) n++;
  if (f.nbaTriggers.length) n++;
  if (f.tenureMonths) n++;
  if (f.mrrGbp) n++;
  if (f.monthlyDownloadGb) n++;
  if (f.speedDeficitPct) n++;
  if (f.loyaltyCalls90d) n++;
  if (f.holdSeconds) n++;
  if (f.churnProbability) n++;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI component
// ─────────────────────────────────────────────────────────────────────────────

export function CustomerFiltersBar({
  filters,
  onChange,
  facets,
  liveEnabled,
  className,
}: {
  filters: CustomerFilters;
  onChange: (next: CustomerFilters) => void;
  facets: FilterFacets;
  liveEnabled: boolean;
  className?: string;
}) {
  const active = countActiveFilters(filters);
  const reset = () => onChange(EMPTY_FILTERS);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mr-1">
        <Filter className="size-3.5" />
        <span>Filters</span>
        {active > 0 && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            {active}
          </Badge>
        )}
        <span className="text-[10px] opacity-70">
          · {liveEnabled ? "live · MotherDuck" : "in-memory"}
        </span>
      </div>

      <MultiSelectFilter
        label="Region"
        options={facets.regions}
        selected={filters.regions}
        onChange={(v) => onChange({ ...filters, regions: v })}
      />
      <MultiSelectFilter
        label="Package"
        options={facets.packages}
        selected={filters.packages}
        onChange={(v) => onChange({ ...filters, packages: v })}
      />
      <MultiSelectFilter
        label="Contract"
        options={facets.contractStatuses}
        selected={filters.contractStatuses}
        onChange={(v) => onChange({ ...filters, contractStatuses: v })}
      />
      <MultiSelectFilter
        label="Risk tier"
        options={facets.riskTiers}
        selected={filters.riskTiers}
        onChange={(v) => onChange({ ...filters, riskTiers: v })}
      />
      <MultiSelectFilter
        label="NBA trigger"
        options={facets.nbaTriggers.map((t) => t.label)}
        selected={filters.nbaTriggers
          .map((k) => facets.nbaTriggers.find((t) => t.key === k)?.label ?? k)}
        onChange={(labels) => {
          const keys = labels
            .map((l) => facets.nbaTriggers.find((t) => t.label === l)?.key)
            .filter((k): k is NbaTriggerKey => !!k);
          onChange({ ...filters, nbaTriggers: keys });
        }}
      />
      {facets.personas.length > 0 && (
        <MultiSelectFilter
          label="Persona"
          options={facets.personas}
          selected={filters.personas}
          onChange={(v) => onChange({ ...filters, personas: v })}
        />
      )}

      <RangeFilter
        label="Tenure (mo)"
        bounds={facets.tenureMonths}
        value={filters.tenureMonths}
        step={1}
        onChange={(v) => onChange({ ...filters, tenureMonths: v })}
      />
      <RangeFilter
        label="MRR (£)"
        bounds={facets.mrrGbp}
        value={filters.mrrGbp}
        step={1}
        onChange={(v) => onChange({ ...filters, mrrGbp: v })}
      />
      <RangeFilter
        label="Monthly DL (GB)"
        bounds={facets.monthlyDownloadGb}
        value={filters.monthlyDownloadGb}
        step={10}
        onChange={(v) => onChange({ ...filters, monthlyDownloadGb: v })}
      />
      <RangeFilter
        label="Speed deficit (%)"
        bounds={facets.speedDeficitPct}
        value={filters.speedDeficitPct}
        step={1}
        onChange={(v) => onChange({ ...filters, speedDeficitPct: v })}
      />
      <RangeFilter
        label="Loyalty calls 90d"
        bounds={facets.loyaltyCalls90d}
        value={filters.loyaltyCalls90d}
        step={1}
        onChange={(v) => onChange({ ...filters, loyaltyCalls90d: v })}
      />
      <RangeFilter
        label="Hold (sec)"
        bounds={facets.holdSeconds}
        value={filters.holdSeconds}
        step={30}
        onChange={(v) => onChange({ ...filters, holdSeconds: v })}
      />
      <RangeFilter
        label="Churn prob (%)"
        bounds={{ min: 0, max: 100 }}
        value={
          filters.churnProbability
            ? {
                min: Math.round(filters.churnProbability.min * 100),
                max: Math.round(filters.churnProbability.max * 100),
              }
            : null
        }
        step={1}
        onChange={(v) =>
          onChange({
            ...filters,
            churnProbability: v ? { min: v.min / 100, max: v.max / 100 } : null,
          })
        }
      />

      {active > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          className="h-7 px-2 text-[11px] text-muted-foreground"
        >
          <X className="size-3 mr-1" /> Clear all
        </Button>
      )}
    </div>
  );
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, search]);
  const isActive = selected.length > 0;
  const toggle = (v: string) =>
    selected.includes(v)
      ? onChange(selected.filter((s) => s !== v))
      : onChange([...selected, v]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-7 px-2 text-[11px] gap-1",
            isActive && "bg-primary text-primary-foreground",
          )}
        >
          {label}
          {isActive && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[9px] bg-primary-foreground/20 text-primary-foreground"
            >
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
          {label}
        </div>
        {options.length > 8 && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-7 text-[12px] mb-2"
          />
        )}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.length === 0 && (
            <div className="text-[11px] text-muted-foreground px-2 py-3 text-center">
              No options.
            </div>
          )}
          {filtered.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-[12px]"
            >
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={() => toggle(opt)}
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="border-t border-border mt-2 pt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {selected.length} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RangeFilter({
  label,
  bounds,
  value,
  step,
  onChange,
}: {
  label: string;
  bounds: { min: number; max: number };
  value: { min: number; max: number } | null;
  step: number;
  onChange: (v: { min: number; max: number } | null) => void;
}) {
  const safeBounds =
    bounds.min === bounds.max
      ? { min: bounds.min, max: bounds.min + Math.max(1, step) }
      : bounds;
  const current = value ?? safeBounds;
  const isActive = !!value && (value.min !== safeBounds.min || value.max !== safeBounds.max);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-7 px-2 text-[11px] gap-1",
            isActive && "bg-primary text-primary-foreground",
          )}
        >
          {label}
          {isActive && (
            <span className="text-[10px] opacity-90">
              {current.min}–{current.max}
            </span>
          )}
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground mb-3 tabular-nums">
          {current.min} – {current.max}
          <span className="opacity-60">
            {" "}
            (range {safeBounds.min} – {safeBounds.max})
          </span>
        </div>
        <Slider
          min={safeBounds.min}
          max={safeBounds.max}
          step={step}
          value={[current.min, current.max]}
          onValueChange={(v) => {
            const [mn, mx] = v;
            onChange({ min: mn ?? safeBounds.min, max: mx ?? safeBounds.max });
          }}
        />
        <div className="border-t border-border mt-3 pt-2 flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => onChange(null)}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
