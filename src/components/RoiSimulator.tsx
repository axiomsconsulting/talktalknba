import { useEffect, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { Info, Target, Coins, PoundSterling, Users, Layers } from "lucide-react";
import { roiParams, formatGbp, formatNumber } from "@/data/nba";
import { cn } from "@/lib/utils";
import {
  useScenarioStore,
  computeDeciles,
  summariseScenario,
  type RoiViewMode,
} from "@/data/scenarioStore";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import {
  computeRuleFinancials,
  summariseRuleFinancials,
  customerLtv,
} from "@/data/financials";

const VIEWS: Array<{ id: RoiViewMode; label: string; description: string }> = [
  {
    id: "lift",
    label: "Targeted lift over baseline",
    description:
      "Net £ saves attributable to the model — incremental over the 15% baseline retention rate.",
  },
  {
    id: "gross",
    label: "Gross saves minus costs",
    description: "Total revenue saved by the campaign minus the full campaign cost (call + budget).",
  },
  {
    id: "compare",
    label: "Top-decile vs random",
    description:
      "Compares ROI when targeting top-decile risk customers against a random sample of equal size.",
  },
];

export function RoiSimulator() {
  const { budget, successRate, callCost, view, setBudget, setSuccessRate, setCallCost, setView } =
    useScenarioStore();

  const { highRiskVolume, averageAnnualArpuGbp, baselineRetentionConversionRate } = roiParams;

  const calc = useMemo(
    () =>
      computeDeciles({
        budget,
        successRate,
        callCost,
        view,
        highRiskVolume,
        averageAnnualArpuGbp,
        baselineRetentionConversionRate,
      }),
    [budget, successRate, callCost, view, highRiskVolume, averageAnnualArpuGbp, baselineRetentionConversionRate]
  );

  const totals = useMemo(() => summariseScenario(calc), [calc]);

  // Top decile vs random comparison (D1 only — the cohort decision)
  const topDecile = calc[0];
  const randomCohortSaved = Math.round(
    (totals.totalSaved / 10) * (calc.reduce((s, d) => s + d.targetedSaved, 0) > 0 ? 1 : 1)
  );
  // The expected saves if you picked the SAME volume randomly across the whole high-risk population
  const randomEquivalent = useMemo(() => {
    const cohortSize = topDecile.contacted;
    const avgConversionAcrossBase = successRate; // success rate applies to actual at-risk
    // average at-risk in any given cohort if randomly sampled from high-risk volume
    const avgAtRiskPerCohort = highRiskVolume * 0.1;
    const saved = avgAtRiskPerCohort * avgConversionAcrossBase;
    const arpu = averageAnnualArpuGbp;
    const rev = saved * arpu;
    const cost = cohortSize * callCost + saved * budget;
    return { saved: Math.round(saved), revenue: Math.round(rev), net: Math.round(rev - cost), cohortSize };
  }, [topDecile, successRate, highRiskVolume, averageAnnualArpuGbp, callCost, budget]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Live Scenario Modelling
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">NBA Scenario Simulator</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Adjust the levers to see how spend, success rate, and channel cost change net ROI per decile.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-muted border border-border">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                view === v.id
                  ? "bg-card text-primary shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_2fr] divide-y lg:divide-y-0 lg:divide-x divide-border">
        {/* Sliders */}
        <div className="p-5 sm:p-7 space-y-6 bg-[var(--surface-sunken)]/40">
          <SliderControl
            icon={Coins}
            label="Retention Budget per Saved Customer"
            value={`£${budget}`}
            sub="Discount, credit, or hardware allowance"
            min={5}
            max={50}
            step={1}
            current={budget}
            onChange={setBudget}
          />
          <SliderControl
            icon={Target}
            label="Expected Intervention Success Rate"
            value={`${(successRate * 100).toFixed(0)}%`}
            sub={`Baseline (no model): ${(baselineRetentionConversionRate * 100).toFixed(0)}%`}
            min={0.05}
            max={0.30}
            step={0.01}
            current={successRate}
            onChange={setSuccessRate}
          />
          <SliderControl
            icon={PoundSterling}
            label="Cost of Outbound Call"
            value={`£${callCost.toFixed(2)}`}
            sub="Fully-loaded contact-centre cost per dial"
            min={2}
            max={10}
            step={0.5}
            current={callCost}
            onChange={setCallCost}
          />

          <div className="rounded-lg bg-card border border-border p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Users className="size-3" /> Targeted at this scenario
            </div>
            <div className="space-y-2.5 text-sm">
              <Stat label="Customers contacted" value={formatNumber(totals.totalContacted, { compact: true })} />
              <Stat label="Customers saved" value={formatNumber(totals.totalSaved, { compact: true })} />
              <Stat
                label="Net ROI · targeted"
                value={formatGbp(totals.totalTargetedNet, { compact: true })}
                emphasis
              />
              <Stat
                label="Net ROI · random"
                value={formatGbp(totals.totalRandomNet, { compact: true })}
                muted
              />
              <div className="pt-2 mt-2 border-t border-border flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Model uplift</span>
                <span className="font-semibold text-[var(--success)]">
                  {formatGbp(totals.totalTargetedNet - totals.totalRandomNet, { compact: true })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-2 mb-4 text-xs text-muted-foreground">
            <Info className="size-3.5 mt-0.5 shrink-0 text-primary" />
            <span>{VIEWS.find((v) => v.id === view)?.description}</span>
          </div>
          <div className="h-[320px] -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calc} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 300)" vertical={false} />
                <XAxis
                  dataKey="decile"
                  tick={{ fill: "oklch(0.5 0.02 285)", fontSize: 12 }}
                  axisLine={{ stroke: "oklch(0.92 0.01 300)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "oklch(0.5 0.02 285)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatGbp(v, { compact: true })}
                />
                <Tooltip
                  cursor={{ fill: "oklch(0.58 0.24 350 / 0.06)" }}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    boxShadow: "var(--shadow-md)",
                  }}
                  formatter={(value: number, name: string) => [formatGbp(value), name === "targeted" ? "Targeted (Top-decile)" : "Random sampling"]}
                  labelFormatter={(label) => `Risk decile ${label}`}
                />
                <Legend
                  wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
                  formatter={(v) => (v === "targeted" ? "Targeted (model-led)" : "Random sampling")}
                />
                <Bar dataKey="random" fill="oklch(0.78 0.02 285)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="targeted" radius={[4, 4, 0, 0]}>
                  {calc.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.targeted >= 0
                          ? `oklch(${0.45 + (i / 10) * 0.18} 0.24 350)`
                          : "oklch(0.6 0.24 25)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top-decile vs random comparison table */}
          <div className="mt-4 rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--surface-sunken)] border-b border-border flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Top-decile vs random · same contact volume
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                cohort: {formatNumber(topDecile.contacted, { compact: true })}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Strategy</th>
                  <th className="px-4 py-2 text-right font-medium">Customers saved</th>
                  <th className="px-4 py-2 text-right font-medium">Revenue saved</th>
                  <th className="px-4 py-2 text-right font-medium">Net ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-primary/5">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-primary" />
                      <span className="font-medium text-foreground">Top decile (model-led)</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                    {formatNumber(topDecile.targetedSaved, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                    {formatGbp(topDecile.targetedRevenueSaved, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-primary">
                    {formatGbp(topDecile.targeted, { compact: true })}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-muted-foreground" />
                      <span className="font-medium text-foreground">Random sample · equal size</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatNumber(randomEquivalent.saved, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatGbp(randomEquivalent.revenue, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatGbp(randomEquivalent.net, { compact: true })}
                  </td>
                </tr>
                <tr className="bg-[var(--success)]/5">
                  <td className="px-4 py-2.5 font-semibold text-foreground">Model uplift</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--success)] font-semibold">
                    +{formatNumber(topDecile.targetedSaved - randomEquivalent.saved, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--success)] font-semibold">
                    +{formatGbp(topDecile.targetedRevenueSaved - randomEquivalent.revenue, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--success)] font-semibold">
                    +{formatGbp(topDecile.targeted - randomEquivalent.net, { compact: true })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderControl({
  icon: Icon,
  label,
  value,
  sub,
  min,
  max,
  step,
  current,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <Icon className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground leading-tight">{label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
          </div>
        </div>
        <div className="text-base font-semibold text-primary tabular-nums shrink-0">{value}</div>
      </div>
      <Slider
        value={[current]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="mt-3"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          emphasis && "text-primary text-base",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}
