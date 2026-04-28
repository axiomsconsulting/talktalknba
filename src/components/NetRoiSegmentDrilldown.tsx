// Net ROI segment drill-down for the executive ROI dashboard.
//
// Lets Finance break the portfolio Net Retained Revenue down by a chosen
// segment dimension (region, contract status, risk tier or package). The
// breakdown can be optionally constrained by the same CustomerFilters bar
// used on Explainability, so the user can answer questions like
// "what's Net ROI on out-of-contract Fibre 65 in the South East?".
//
// Per-segment maths:
//   1. Filter the in-memory Customer[] by the active CustomerFilters.
//   2. For each segment value, count how many filtered customers fall in
//      it, plus how many of those are High risk tier (proxy for "high-
//      risk volume" the rule engine prices against).
//   3. Pro-rate roiParams.highRiskVolume across segments by High share so
//      the drill-down is internally consistent with the headline KPIs.
//   4. Run computeRuleFinancials/summariseRuleFinancials per segment using
//      the current scenario success rate.

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { Layers, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCustomerStore } from "@/data/customerStore";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import { useScenarioStore } from "@/data/scenarioStore";
import { roiParams, segmentSummary, formatGbp, formatNumber, type RiskTier } from "@/data/nba";
import { useFullBaseAggregate } from "@/data/fullBaseAggregate";
import {
  computeRuleFinancials,
  summariseRuleFinancials,
  customerLtv,
} from "@/data/financials";
import {
  CustomerFiltersBar,
  EMPTY_FILTERS,
  applyCustomerFilters,
  countActiveFilters,
  useCustomerFacets,
  type CustomerFilters,
} from "@/components/CustomerFiltersBar";
import type { Customer } from "@/data/customers";

type Dimension = "region" | "contractStatus" | "riskTier" | "package";

const DIMENSION_LABELS: Record<Dimension, string> = {
  region: "Region",
  contractStatus: "Contract status",
  riskTier: "Risk tier",
  package: "Package",
};

function segmentValue(c: Customer, dim: Dimension): string {
  switch (dim) {
    case "region": return c.region || "—";
    case "contractStatus": return c.contractStatus || "—";
    case "riskTier": return c.riskTier || "—";
    case "package": return c.package || "—";
  }
}

function normaliseContractStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("ooc") || s.includes("out")) return "Out of contract";
  if (s.includes("rolling")) return "Rolling";
  if (s.includes("in")) return "In contract";
  return raw || "—";
}

function fullBaseGroupsForDimension(
  dim: Dimension,
  fullBase: ReturnType<typeof useFullBaseAggregate>,
): Map<string, { total: number; high: number }> | null {
  if (dim === "riskTier") {
    return new Map(
      segmentSummary.map((s) => [
        s.tier,
        { total: s.customerCount, high: s.tier === "High" ? s.customerCount : 0 },
      ]),
    );
  }
  if (!fullBase) return null;
  if (dim === "package") {
    return new Map(fullBase.packageBreakdown.map((r) => [r.package || "—", { total: r.customers, high: 0 }]));
  }
  if (dim === "contractStatus") {
    return new Map(fullBase.contractBreakdown.map((r) => [normaliseContractStatus(r.status), { total: r.customers, high: 0 }]));
  }
  if (dim === "region") {
    return new Map(fullBase.regionBreakdown.map((r) => [r.region || "—", { total: r.customers, high: 0 }]));
  }
  return null;
}

export function NetRoiSegmentDrilldown() {
  const customers = useCustomerStore((s) => s.customers);
  const source = useCustomerStore((s) => s.source);
  const { rules, loaded, load } = useNbaRulesStore();
  const { successRate } = useScenarioStore();
  const [dim, setDim] = useState<Dimension>("region");
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const facets = useCustomerFacets({ customers, liveEnabled: false });
  const fullBase = useFullBaseAggregate();
  const isMotherDuck =
    source.kind === "uploaded" &&
    ((source.detail ?? source.filename).toLowerCase().includes("motherduck"));

  // The drill-down is driven by the in-memory store regardless of whether
  // MotherDuck is the live source — the store is hydrated from MD on boot
  // via liveCustomerHydrator, so it stays in sync.
  if (!loaded) {
    void load();
  }

  const activeFilterCount = countActiveFilters(filters);

  const segments = useMemo(() => {
    const filtered = applyCustomerFilters(customers, filters);
    const activeFilterCount = countActiveFilters(filters);
    const fullGroups = isMotherDuck && activeFilterCount === 0
      ? fullBaseGroupsForDimension(dim, fullBase)
      : null;
    if (!fullGroups && filtered.length === 0) return [];

    // Group by segment value; track total + high-risk count per segment.
    const groups = fullGroups ?? new Map<string, { total: number; high: number }>();
    let totalHigh = 0;
    if (fullGroups) {
      for (const slot of groups.values()) totalHigh += slot.high;
    } else {
      for (const c of filtered) {
        const key = segmentValue(c, dim);
        const slot = groups.get(key) ?? { total: 0, high: 0 };
        slot.total += 1;
        if (c.riskTier === "High") {
          slot.high += 1;
          totalHigh += 1;
        }
        groups.set(key, slot);
      }
    }
    // If no high-risk customers exist in the filtered set, fall back to
    // proportional split by total (so the chart is never empty).
    const useHigh = totalHigh > 0;
    const denom = useHigh ? totalHigh : filtered.length;

    const monthlyArpu = roiParams.averageAnnualArpuGbp / 12;
    const avgLtvPerSave = customerLtv(monthlyArpu, "High");

    const rows = Array.from(groups.entries()).map(([key, { total, high }]) => {
      const share = (useHigh ? high : total) / Math.max(1, denom);
      const segHighRiskVolume = Math.round(roiParams.highRiskVolume * share);
      const ruleRows = computeRuleFinancials(rules, {
        highRiskVolume: segHighRiskVolume,
        averageMonthlyArpuGbp: monthlyArpu,
        baselineRetentionConversionRate: roiParams.baselineRetentionConversionRate,
        successRate,
      });
      const totals = summariseRuleFinancials(ruleRows, avgLtvPerSave);
      return {
        segment: key,
        customers: total,
        highRisk: high,
        sharePct: share * 100,
        segHighRiskVolume,
        grossRetainedGbp: totals.grossRetainedGbp,
        dilutionGbp: totals.dilutionGbp,
        costToServeGbp: totals.costToServeGbp,
        netRetainedGbp: totals.netRetainedGbp,
        saved: totals.saved,
      };
    });

    rows.sort((a, b) => b.netRetainedGbp - a.netRetainedGbp);
    return rows;
  }, [customers, filters, dim, rules, successRate, isMotherDuck, fullBase]);

  const grandTotal = useMemo(
    () =>
      segments.reduce(
        (acc, r) => {
          acc.net += r.netRetainedGbp;
          acc.gross += r.grossRetainedGbp;
          acc.dilution += r.dilutionGbp;
          acc.cost += r.costToServeGbp;
          acc.saved += r.saved;
          return acc;
        },
        { net: 0, gross: 0, dilution: 0, cost: 0, saved: 0 },
      ),
    [segments],
  );

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Layers className="size-3.5" />
              Drill-down
            </div>
            <h3 className="mt-1 text-base font-semibold text-foreground">
              Net ROI by {DIMENSION_LABELS[dim].toLowerCase()}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pro-rated against the current scenario ({Math.round(successRate * 100)}% success
              rate). Optional filters narrow the segment universe before
              high-risk volume is split across buckets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Filter className="size-3" /> Break by
            </span>
            <Select value={dim} onValueChange={(v) => setDim(v as Dimension)}>
              <SelectTrigger className="h-8 w-[170px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DIMENSION_LABELS) as Dimension[]).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {DIMENSION_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Optional cross-cutting filters */}
        <div className="mt-4 flex items-start gap-2 flex-wrap">
          <CustomerFiltersBar
            filters={filters}
            onChange={setFilters}
            facets={facets}
            liveEnabled={false}
          />
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="h-7 px-2 text-[11px] text-muted-foreground"
            >
              <X className="size-3 mr-1" /> Reset
            </Button>
          )}
        </div>
      </div>

      {segments.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No customers match the current filters.
        </div>
      ) : (
        <>
          <div className="px-5 sm:px-7 py-5 grid sm:grid-cols-4 gap-3 text-xs border-b border-border bg-[var(--surface-sunken)]/50">
            <Stat label="Segments" value={segments.length.toString()} />
            <Stat label="Total customers (filtered)" value={formatNumber(segments.reduce((s, r) => s + r.customers, 0))} />
            <Stat label="Saved (modelled)" value={formatNumber(grandTotal.saved)} />
            <Stat label="Net ROI (sum)" value={formatGbp(grandTotal.net)} accent="success" />
          </div>

          <div className="p-5 sm:p-7">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={segments}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fill: "oklch(0.5 0.02 285)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => formatGbp(v, { compact: true })}
                  />
                  <YAxis
                    type="category"
                    dataKey="segment"
                    width={160}
                    tick={{ fill: "oklch(0.18 0.025 285)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "oklch(0.58 0.24 350 / 0.05)" }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: "var(--shadow-md)",
                    }}
                    formatter={(v: number) => [formatGbp(v), "Net retained"]}
                  />
                  <Bar dataKey="netRetainedGbp" radius={[0, 6, 6, 0]}>
                    {segments.map((s, i) => (
                      <Cell
                        key={i}
                        fill={
                          s.netRetainedGbp >= 0
                            ? `oklch(${0.55 + (i / Math.max(1, segments.length)) * 0.2} 0.18 155)`
                            : "var(--risk-high)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">{DIMENSION_LABELS[dim]}</th>
                  <th className="px-5 py-3 text-right font-medium">Customers</th>
                  <th className="px-5 py-3 text-right font-medium">High-risk share</th>
                  <th className="px-5 py-3 text-right font-medium">Saved</th>
                  <th className="px-5 py-3 text-right font-medium">Gross retained</th>
                  <th className="px-5 py-3 text-right font-medium">Dilution + cost</th>
                  <th className="px-5 py-3 text-right font-medium">Net ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {segments.map((s) => (
                  <tr key={s.segment} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">{s.segment}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {formatNumber(s.customers)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {s.sharePct.toFixed(1)}%
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {formatNumber(s.saved)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {formatGbp(s.grossRetainedGbp, { compact: true })}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--risk-high)]">
                      −{formatGbp(s.dilutionGbp + s.costToServeGbp, { compact: true })}
                    </td>
                    <td
                      className="px-5 py-3 text-right tabular-nums font-semibold"
                      style={{
                        color: s.netRetainedGbp >= 0 ? "var(--success)" : "var(--risk-high)",
                      }}
                    >
                      {formatGbp(s.netRetainedGbp, { compact: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success";
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className="text-base font-semibold tabular-nums mt-0.5"
        style={{ color: accent === "success" ? "var(--success)" : "var(--foreground)" }}
      >
        {value}
      </div>
    </div>
  );
}
