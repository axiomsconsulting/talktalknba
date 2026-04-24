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
import { Info, Target, Coins, PoundSterling, Users, Layers, TrendingUp, BadgePoundSterling, Sparkles } from "lucide-react";
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
    id: "gross",
    label: "Total retained revenue (net)",
    description:
      "Every saved customer's revenue (including those who would have stayed naturally), minus retention spend and outbound call cost.",
  },
  {
    id: "lift",
    label: "Incremental margin (model-only)",
    description:
      "Revenue we keep that we would have lost without the model — saves above the 15% no-model baseline, minus retention spend and call cost.",
  },
];

export function RoiSimulator() {
  const { budget, successRate, callCost, view, setBudget, setSuccessRate, setCallCost, setView } =
    useScenarioStore();
  const { rules, loaded, load } = useNbaRulesStore();

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const { highRiskVolume, averageAnnualArpuGbp, baselineRetentionConversionRate } = roiParams;
  const monthlyArpu = averageAnnualArpuGbp / 12;

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

  // Per-rule financial breakdown (uses live editable rules + scenario success rate)
  const ruleFinancials = useMemo(
    () =>
      computeRuleFinancials(rules, {
        highRiskVolume,
        averageMonthlyArpuGbp: monthlyArpu,
        baselineRetentionConversionRate,
        successRate,
      }),
    [rules, highRiskVolume, monthlyArpu, baselineRetentionConversionRate, successRate],
  );
  const avgLtvPerSave = customerLtv(monthlyArpu, "High");
  const portfolioTotals = useMemo(
    () => summariseRuleFinancials(ruleFinancials, avgLtvPerSave),
    [ruleFinancials, avgLtvPerSave],
  );

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
            Move the three retention levers below to see what each scenario delivers in net retained revenue.
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
              title={v.description}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hero KPI strip — at-a-glance answers for a scenario discussion */}
      <HeroKpiStrip
        net={totals.totalTargetedNet}
        savedCustomers={totals.totalSaved}
        contacted={totals.totalContacted}
        budget={budget}
        callCost={callCost}
        uplift={totals.totalTargetedNet - totals.totalRandomNet}
        viewLabel={VIEWS.find((v) => v.id === view)?.label ?? ""}
      />

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

      {/* Per-rule financial breakdown — driven by the editable NBA rules */}
      <div className="border-t border-border bg-[var(--surface-sunken)]/40">
        <div className="px-5 sm:px-7 py-5 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Layers className="size-3.5" />
              Per-rule financials
            </div>
            <h3 className="mt-1 text-base font-semibold text-foreground">
              Where the spend lands · revenue dilution by NBA
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Volumes derived from the rules in <code className="px-1 py-0.5 rounded bg-muted text-foreground/80 font-mono text-[10px]">/nba-rules</code>. Edit a rule's discount, contract length or cost-to-serve to see the dilution and net retained revenue update live.
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Avg saved-customer LTV: <span className="font-semibold text-foreground tabular-nums">{formatGbp(avgLtvPerSave)}</span></div>
            <div>Total saved-customer LTV: <span className="font-semibold text-foreground tabular-nums">{formatGbp(portfolioTotals.totalLtvGbp, { compact: true })}</span></div>
          </div>
        </div>
        {ruleFinancials.length === 0 ? (
          <div className="px-5 sm:px-7 pb-6 text-sm text-muted-foreground">
            No active NBA rules. Activate at least one rule on the NBA Rules page to see the breakdown.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[820px]">
              <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground border-y border-border">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">NBA rule</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contacted</th>
                  <th className="px-3 py-2.5 text-right font-medium">Saved</th>
                  <th className="px-3 py-2.5 text-right font-medium">Gross retained</th>
                  <th className="px-3 py-2.5 text-right font-medium">Dilution</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cost-to-serve</th>
                  <th className="px-3 py-2.5 text-right font-medium">Net retained</th>
                  <th className="px-3 py-2.5 text-right font-medium">% LTV used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ruleFinancials.map((r) => (
                  <tr key={r.triggerKey} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-foreground">{r.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.channel}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatNumber(r.contacted, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      {formatNumber(r.saved, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      {formatGbp(r.grossRetainedGbp, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--risk-high)]">
                      −{formatGbp(r.dilutionGbp, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      −{formatGbp(r.costToServeGbp, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-primary">
                      {formatGbp(r.netRetainedGbp, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      {r.ltvBudgetUsedPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-primary/5 font-semibold">
                  <td className="px-5 py-2.5 text-foreground">Portfolio total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {formatNumber(portfolioTotals.contacted, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {formatNumber(portfolioTotals.saved, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {formatGbp(portfolioTotals.grossRetainedGbp, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--risk-high)]">
                    −{formatGbp(portfolioTotals.dilutionGbp, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    −{formatGbp(portfolioTotals.costToServeGbp, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-primary">
                    {formatGbp(portfolioTotals.netRetainedGbp, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {portfolioTotals.ltvBudgetUsedPct.toFixed(1)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
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
