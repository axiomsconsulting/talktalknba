import { useMemo, useState } from "react";
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
import { Info, Target, Coins, PoundSterling } from "lucide-react";
import { roiParams, formatGbp, formatNumber } from "@/data/nba";
import { cn } from "@/lib/utils";

type ViewMode = "lift" | "gross" | "compare";

const VIEWS: Array<{ id: ViewMode; label: string; description: string }> = [
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
  const [budget, setBudget] = useState(20); // £ per saved customer
  const [successRate, setSuccessRate] = useState(0.18); // 18%
  const [callCost, setCallCost] = useState(4); // £ per outbound call
  const [view, setView] = useState<ViewMode>("compare");

  const { highRiskVolume, averageAnnualArpuGbp, baselineRetentionConversionRate } = roiParams;

  const calc = useMemo(() => {
    // Build a bar chart over decile cohorts (10 cohorts of equal volume).
    // Risk score concentration: top decile carries the highest churn probability.
    // Simulate per-decile churn-likelihood weights summing to 1 across all 10 deciles.
    const decileWeights = [0.27, 0.18, 0.13, 0.10, 0.08, 0.07, 0.06, 0.05, 0.04, 0.02];
    const cohortSize = Math.round(highRiskVolume / 10);
    const arpu = averageAnnualArpuGbp;

    // Random sampling assumption: each cohort = average risk = total / 10
    const randomChurnPerCohort = (decileWeights.reduce((a, b) => a + b, 0) / 10) * highRiskVolume;

    return decileWeights.map((w, i) => {
      const decile = i + 1;
      const targetedAtRiskCustomers = w * highRiskVolume; // expected churners in this decile if untreated
      const randomAtRiskCustomers = randomChurnPerCohort;

      // Customers we contact in this cohort (we contact everyone in the cohort)
      const contacted = cohortSize;
      const callSpend = contacted * callCost;

      // Targeted: success rate is full rate; baseline always saves 15% of at-risk
      const targetedSavedCustomers = targetedAtRiskCustomers * successRate;
      const targetedBaselineSaved = targetedAtRiskCustomers * baselineRetentionConversionRate;
      const targetedIncrementalSaved = targetedSavedCustomers - targetedBaselineSaved;

      const targetedRevenueSaved = targetedSavedCustomers * arpu;
      const targetedIncrementalRevenue = targetedIncrementalSaved * arpu;
      const targetedBudgetSpend = targetedSavedCustomers * budget;
      const targetedTotalCost = callSpend + targetedBudgetSpend;

      // Random sampling: same volume contacted but random hit rate
      const randomSavedCustomers = randomAtRiskCustomers * successRate * (cohortSize / highRiskVolume) * 10 / 10;
      // Simpler: random cohort hit rate is the average across base
      const randomSavedSimple = (randomAtRiskCustomers / 10) * successRate;
      const randomRevenueSaved = randomSavedSimple * arpu;
      const randomBudgetSpend = randomSavedSimple * budget;
      const randomTotalCost = callSpend + randomBudgetSpend;

      let targetedNet = 0;
      let randomNet = 0;

      if (view === "lift") {
        targetedNet = targetedIncrementalRevenue - targetedTotalCost;
        randomNet = randomRevenueSaved - randomBudgetSpend - callSpend - (randomAtRiskCustomers / 10) * baselineRetentionConversionRate * arpu * -0; // baseline subtracted
        // Random lift over baseline
        const randomBaselineSaved = (randomAtRiskCustomers / 10) * baselineRetentionConversionRate;
        const randomIncrementalRevenue = (randomSavedSimple - randomBaselineSaved) * arpu;
        randomNet = randomIncrementalRevenue - randomTotalCost;
      } else if (view === "gross") {
        targetedNet = targetedRevenueSaved - targetedTotalCost;
        randomNet = randomRevenueSaved - randomTotalCost;
      } else {
        // compare uses gross saves minus costs as the apples-to-apples measure
        targetedNet = targetedRevenueSaved - targetedTotalCost;
        randomNet = randomRevenueSaved - randomTotalCost;
      }

      return {
        decile: `D${decile}`,
        targeted: Math.round(targetedNet),
        random: Math.round(randomNet),
        targetedSaved: Math.round(targetedSavedCustomers),
        contacted,
      };
    });
  }, [budget, successRate, callCost, view, highRiskVolume, averageAnnualArpuGbp, baselineRetentionConversionRate]);

  const totals = useMemo(() => {
    const totalTargetedNet = calc.reduce((s, d) => s + d.targeted, 0);
    const totalRandomNet = calc.reduce((s, d) => s + d.random, 0);
    const totalSaved = calc.reduce((s, d) => s + d.targetedSaved, 0);
    const totalContacted = calc.reduce((s, d) => s + d.contacted, 0);
    return { totalTargetedNet, totalRandomNet, totalSaved, totalContacted };
  }, [calc]);

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
        <div className="p-5 sm:p-7 space-y-7 bg-[var(--surface-sunken)]/40">
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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Scenario outputs
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
          <div className="h-[380px] -mx-2">
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
