// Sensitivity analysis: a heatmap-style grid of net ROI across (success rate × budget),
// plus best/base/worst case callouts. Reads call-cost from the shared scenario store.

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { roiParams, formatGbp } from "@/data/nba";
import { computeDeciles, summariseScenario, useScenarioStore } from "@/data/scenarioStore";
import { cn } from "@/lib/utils";

const SUCCESS_RATES = [0.08, 0.12, 0.16, 0.20, 0.24, 0.28];
const BUDGETS = [10, 15, 20, 25, 30, 40];

export function SensitivityPanel() {
  const { callCost, view } = useScenarioStore();

  const grid = useMemo(() => {
    return SUCCESS_RATES.map((sr) =>
      BUDGETS.map((b) => {
        const d = computeDeciles({
          budget: b,
          successRate: sr,
          callCost,
          view,
          highRiskVolume: roiParams.highRiskVolume,
          averageAnnualArpuGbp: roiParams.averageAnnualArpuGbp,
          baselineRetentionConversionRate: roiParams.baselineRetentionConversionRate,
        });
        return summariseScenario(d).totalTargetedNet;
      })
    );
  }, [callCost, view]);

  const flat = grid.flat();
  const max = Math.max(...flat);
  const min = Math.min(...flat);

  const best = useMemo(() => {
    let val = -Infinity;
    let pos = { sr: 0, b: 0 };
    SUCCESS_RATES.forEach((sr, i) =>
      BUDGETS.forEach((b, j) => {
        if (grid[i][j] > val) {
          val = grid[i][j];
          pos = { sr, b };
        }
      })
    );
    return { val, ...pos };
  }, [grid]);

  const worst = useMemo(() => {
    let val = Infinity;
    let pos = { sr: 0, b: 0 };
    SUCCESS_RATES.forEach((sr, i) =>
      BUDGETS.forEach((b, j) => {
        if (grid[i][j] < val) {
          val = grid[i][j];
          pos = { sr, b };
        }
      })
    );
    return { val, ...pos };
  }, [grid]);

  // Base case = current scenario position (closest to slider state)
  const { successRate, budget } = useScenarioStore();
  const baseSrIdx = SUCCESS_RATES.reduce(
    (acc, v, i) => (Math.abs(v - successRate) < Math.abs(SUCCESS_RATES[acc] - successRate) ? i : acc),
    0
  );
  const baseBIdx = BUDGETS.reduce(
    (acc, v, i) => (Math.abs(v - budget) < Math.abs(BUDGETS[acc] - budget) ? i : acc),
    0
  );
  const baseVal = grid[baseSrIdx][baseBIdx];

  function cellColor(v: number): string {
    if (v >= 0) {
      const t = max === 0 ? 0 : v / max;
      const lightness = 0.96 - t * 0.42; // light → dark magenta
      return `oklch(${lightness} ${0.04 + t * 0.20} 350)`;
    }
    const t = min === 0 ? 0 : v / min;
    const lightness = 0.96 - t * 0.36;
    return `oklch(${lightness} ${0.04 + t * 0.18} 25)`;
  }

  function cellTextColor(v: number): string {
    const intensity = max === 0 ? 0 : Math.abs(v) / Math.max(Math.abs(max), Math.abs(min));
    return intensity > 0.55 ? "oklch(0.99 0 0)" : "oklch(0.18 0.025 285)";
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Sensitivity analysis
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            Net ROI across success rate × retention budget
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Each cell holds the full-portfolio net ROI at that combination, given the current call-cost
            assumption (£{callCost.toFixed(2)} / dial) and view mode.
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        {/* Best / Base / Worst */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <CaseCard
            label="Best case"
            icon={TrendingUp}
            value={formatGbp(best.val, { compact: true })}
            sub={`Success ${(best.sr * 100).toFixed(0)}% · Budget £${best.b}`}
            tone="success"
          />
          <CaseCard
            label="Base case · current sliders"
            icon={Minus}
            value={formatGbp(baseVal, { compact: true })}
            sub={`Success ${(SUCCESS_RATES[baseSrIdx] * 100).toFixed(0)}% · Budget £${BUDGETS[baseBIdx]}`}
            tone="primary"
          />
          <CaseCard
            label="Worst case"
            icon={TrendingDown}
            value={formatGbp(worst.val, { compact: true })}
            sub={`Success ${(worst.sr * 100).toFixed(0)}% · Budget £${worst.b}`}
            tone={worst.val < 0 ? "danger" : "muted"}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Success rate ↓ &nbsp;/ &nbsp;Budget →
                </th>
                {BUDGETS.map((b) => (
                  <th key={b} className="px-2 py-2 text-center font-medium text-muted-foreground">
                    £{b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SUCCESS_RATES.map((sr, i) => (
                <tr key={sr}>
                  <td className="px-3 py-2 font-medium text-foreground tabular-nums">
                    {(sr * 100).toFixed(0)}%
                  </td>
                  {BUDGETS.map((b, j) => {
                    const v = grid[i][j];
                    const isBase = i === baseSrIdx && j === baseBIdx;
                    return (
                      <td key={b} className="p-1">
                        <div
                          className={cn(
                            "rounded-md px-2 py-2.5 text-center tabular-nums font-semibold border",
                            isBase ? "border-primary ring-2 ring-primary/30" : "border-transparent"
                          )}
                          style={{
                            background: cellColor(v),
                            color: cellTextColor(v),
                          }}
                          title={`${(sr * 100).toFixed(0)}% × £${b} → ${formatGbp(v)}`}
                        >
                          {formatGbp(v, { compact: true })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CaseCard({
  label,
  icon: Icon,
  value,
  sub,
  tone,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  sub: string;
  tone: "success" | "primary" | "danger" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "border-[var(--success)]/30 bg-[var(--success)]/5 text-[var(--success)]"
      : tone === "danger"
        ? "border-[var(--risk-high)]/30 bg-[var(--risk-high)]/5 text-[var(--risk-high)]"
        : tone === "primary"
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div className={cn("rounded-lg border p-4", toneClass)}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider opacity-90">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
