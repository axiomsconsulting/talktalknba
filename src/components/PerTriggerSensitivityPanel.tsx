// Per-NBA-trigger sensitivity: recalculates Net ROI separately by trigger
// (Save Desk, Free Tech Upgrade, Right-sizing, Price Match) across
// best / base / worst case grids.

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { roiParams, formatGbp } from "@/data/nba";
import { useScenarioStore } from "@/data/scenarioStore";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import type { NbaTriggerKey } from "@/data/customers";
import { useCustomerStore } from "@/data/customerStore";
import { cn } from "@/lib/utils";

// Cases (success rate, budget multiplier-of-rule-discount-cost, label).
type Case = { label: string; successRate: number; budgetMultiplier: number; tone: "success" | "primary" | "danger" };

const CASES: Case[] = [
  { label: "Best", successRate: 0.28, budgetMultiplier: 0.7, tone: "success" },
  { label: "Base", successRate: 0.18, budgetMultiplier: 1.0, tone: "primary" },
  { label: "Worst", successRate: 0.08, budgetMultiplier: 1.3, tone: "danger" },
];

// Triggers we surface in the panel.
const TRIGGERS: Array<{ key: NbaTriggerKey; label: string }> = [
  { key: "loyalty_save_desk", label: "Save Desk" },
  { key: "free_tech_upgrade", label: "Free Tech Upgrade" },
  { key: "rightsize_email", label: "Right-sizing" },
  { key: "competitor_match", label: "Price Match" },
];

export function PerTriggerSensitivityPanel() {
  const { callCost } = useScenarioStore();
  const { rules } = useNbaRulesStore();
  const customers = useCustomerStore((s) => s.customers);

  // Volume per trigger from the live customer base (proportional to high-risk total).
  const volumeByTrigger = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of customers) {
      const k = c.nbaTrigger ?? "nurture";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const total = customers.length || 1;
    const out: Record<string, number> = {};
    for (const t of TRIGGERS) {
      const share = (counts[t.key] ?? 0) / total;
      out[t.key] = Math.round(share * roiParams.highRiskVolume);
    }
    return out;
  }, [customers]);

  const grid = useMemo(() => {
    return TRIGGERS.map((t) => {
      const rule = rules.find((r) => r.triggerKey === t.key);
      const volume = volumeByTrigger[t.key] ?? 0;
      const arpuMonthly = roiParams.averageAnnualArpuGbp / 12;
      const discountPct = rule?.discountPct ?? 0;
      const months = rule?.contractMonths ?? 24;
      const costPer = rule?.costPerContactGbp ?? callCost;

      const cells = CASES.map((c) => {
        const contacted = volume;
        const saved = volume * c.successRate;
        // Gross retained = saved customers × full ARPU horizon
        const grossRetained = saved * arpuMonthly * months;
        // Dilution = saved customers × discount × ARPU × months × budget multiplier
        const dilution = saved * arpuMonthly * months * (discountPct / 100) * c.budgetMultiplier;
        const contactCost = contacted * costPer;
        const net = grossRetained - dilution - contactCost;
        return { ...c, contacted, saved, grossRetained, dilution, contactCost, net };
      });

      return { trigger: t, rule, cells };
    });
  }, [rules, volumeByTrigger, callCost]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary inline-flex items-center gap-1.5">
            <Layers className="size-3.5" /> Per-trigger sensitivity
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            Net ROI by NBA trigger · best / base / worst
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Each row recalculates ROI for one trigger using its own discount %, contract length and
            cost-to-serve from the NBA Rules console. Volume reflects the share of the active
            customer base routed to that trigger.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--surface-sunken)] text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Trigger</th>
              <th className="px-3 py-3 text-right font-medium">Volume</th>
              <th className="px-3 py-3 text-right font-medium">Discount × months</th>
              {CASES.map((c) => (
                <th key={c.label} className="px-3 py-3 text-right font-medium">
                  {c.label}<br />
                  <span className="text-muted-foreground/70 font-normal normal-case">
                    {(c.successRate * 100).toFixed(0)}% save · {c.budgetMultiplier.toFixed(1)}× cost
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {grid.map((row) => (
              <tr key={row.trigger.key} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{row.trigger.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{row.trigger.key}</div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {(volumeByTrigger[row.trigger.key] ?? 0).toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {row.rule ? `${row.rule.discountPct.toFixed(0)}% · ${row.rule.contractMonths}mo` : "—"}
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.label} className="px-3 py-3 text-right tabular-nums">
                    <CaseBadge value={cell.net} tone={cell.tone} />
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      saved {Math.round(cell.saved).toLocaleString()} · −{formatGbp(cell.dilution, { compact: true })} dilution
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--surface-sunken)] border-t-2 border-border">
              <td className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-foreground">
                Portfolio total
              </td>
              <td className="px-3 py-3 text-right tabular-nums font-semibold text-foreground">
                {Object.values(volumeByTrigger).reduce((a, b) => a + b, 0).toLocaleString()}
              </td>
              <td />
              {CASES.map((c, i) => {
                const total = grid.reduce((s, row) => s + row.cells[i].net, 0);
                return (
                  <td key={c.label} className="px-3 py-3 text-right tabular-nums font-semibold">
                    <CaseBadge value={total} tone={c.tone} />
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function CaseBadge({ value, tone }: { value: number; tone: "success" | "primary" | "danger" }) {
  const Icon: LucideIcon = tone === "success" ? TrendingUp : tone === "danger" ? TrendingDown : Minus;
  const color =
    value < 0
      ? "var(--risk-high)"
      : tone === "success"
        ? "var(--success)"
        : tone === "danger"
          ? "var(--risk-medium)"
          : "var(--primary)";
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold")} style={{ color }}>
      <Icon className="size-3" />
      {formatGbp(value, { compact: true })}
    </span>
  );
}
