import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Users, AlertTriangle, BadgePoundSterling, ShieldCheck, Scissors, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { RoiSimulator } from "@/components/RoiSimulator";
import { SensitivityPanel } from "@/components/SensitivityPanel";
import { PerTriggerSensitivityPanel } from "@/components/PerTriggerSensitivityPanel";

import { roiParams, segmentSummary, formatGbp, formatNumber } from "@/data/nba";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import { useScenarioStore } from "@/data/scenarioStore";
import { useDatasetProv, useRuleProv, useHasActiveCustomerSource } from "@/data/provenanceHooks";
import {
  computeRuleFinancials,
  summariseRuleFinancials,
  customerLtv,
} from "@/data/financials";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Retention Prioritisation Dashboard — TalkTalk NBA" },
      {
        name: "description",
        content:
          "Executive ROI dashboard for the TalkTalk Next Best Action churn-prevention model. Live scenario modelling for retention spend, intervention success rate and outbound contact cost.",
      },
      { property: "og:title", content: "Retention Prioritisation Dashboard — TalkTalk NBA" },
      {
        property: "og:description",
        content:
          "Live ROI modelling for the TalkTalk NBA churn-prevention engine — built for the CDO and Head of Finance.",
      },
    ],
  }),
  component: RoiPage,
});

function RoiPage() {
  const { rules, loaded, load } = useNbaRulesStore();
  const { successRate } = useScenarioStore();
  const hasSource = useHasActiveCustomerSource();
  const datasetProv = useDatasetProv("aggregated from customer dataset", "Aggregations over the active customer source");
  const ruleProv = useRuleProv("rule-engine output", "Editable NBA rules × scenario success-rate × dataset volume");

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // Saved-revenue projection: incremental over baseline at default scenario
  const defaultSuccess = 0.18;
  const incrementalSavedCustomers =
    roiParams.highRiskVolume * (defaultSuccess - roiParams.baselineRetentionConversionRate);
  const projectedSavedRevenue = incrementalSavedCustomers * roiParams.averageAnnualArpuGbp;

  // Portfolio financials driven by editable rules + scenario success rate
  const monthlyArpu = roiParams.averageAnnualArpuGbp / 12;
  const ruleFinancials = useMemo(
    () =>
      computeRuleFinancials(rules, {
        highRiskVolume: roiParams.highRiskVolume,
        averageMonthlyArpuGbp: monthlyArpu,
        baselineRetentionConversionRate: roiParams.baselineRetentionConversionRate,
        successRate,
      }),
    [rules, monthlyArpu, successRate],
  );
  const avgLtvPerSave = customerLtv(monthlyArpu, "High");
  const portfolioTotals = useMemo(
    () => summariseRuleFinancials(ruleFinancials, avgLtvPerSave),
    [ruleFinancials, avgLtvPerSave],
  );

  const segmentChartData = segmentSummary.map((s) => ({
    name: `${s.tier} Risk`,
    value: s.customerCount,
    fill:
      s.tier === "High"
        ? "oklch(0.6 0.24 25)"
        : s.tier === "Medium"
          ? "oklch(0.75 0.16 70)"
          : "oklch(0.62 0.16 155)",
  }));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Finance · Executive Summary"
        title="Retention Prioritisation Dashboard"
        description="Live commercial view of the TalkTalk NBA churn-prevention model. KPIs reflect the trained scoring run on 3.5M customers; the simulator below lets Finance stress-test spend and conversion assumptions."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <KpiCard
            label="Total Customer Base"
            value={hasSource ? formatNumber(roiParams.totalCustomerBase, { compact: true }) : null}
            sub={`${formatNumber(roiParams.totalCustomerBase)} accounts scored`}
            icon={Users}
            accent="neutral"
            prov={datasetProv}
          />
          <KpiCard
            label="Customers at Risk"
            value={hasSource ? formatNumber(roiParams.highRiskVolume, { compact: true }) : null}
            sub="Top-tier model probability ≥ 0.65"
            icon={AlertTriangle}
            accent="risk"
            trend={{
              value: `${((roiParams.highRiskVolume / roiParams.totalCustomerBase) * 100).toFixed(1)}% of base`,
              direction: "neutral",
            }}
            prov={datasetProv}
          />
          <KpiCard
            label="Revenue at Risk"
            value={hasSource ? formatGbp(roiParams.revenueAtRiskGbp, { compact: true }) : null}
            sub={`${formatGbp(roiParams.averageAnnualArpuGbp)} avg annual ARPU`}
            icon={BadgePoundSterling}
            accent="risk"
            prov={
              hasSource
                ? {
                    kind: "rule",
                    source: "Heuristic rule · Revenue at risk",
                    formula: "high-risk customers × average annual ARPU",
                    inputs: [
                      { label: "High-risk volume", value: formatNumber(roiParams.highRiskVolume) },
                      { label: "Avg annual ARPU", value: formatGbp(roiParams.averageAnnualArpuGbp) },
                    ],
                  }
                : null
            }
          />
          <KpiCard
            label="Saved Revenue Projection"
            value={hasSource ? formatGbp(projectedSavedRevenue, { compact: true }) : null}
            sub={`@ ${(defaultSuccess * 100).toFixed(0)}% intervention vs ${(roiParams.baselineRetentionConversionRate * 100).toFixed(0)}% baseline`}
            icon={ShieldCheck}
            accent="success"
            trend={{
              value: `${formatNumber(incrementalSavedCustomers, { compact: true })} saves`,
              direction: "up",
            }}
            prov={
              hasSource
                ? {
                    kind: "rule",
                    source: "Heuristic rule · Saved revenue projection",
                    formula: "high-risk × (intervention success − baseline) × avg annual ARPU",
                    inputs: [
                      { label: "Intervention success", value: `${(defaultSuccess * 100).toFixed(0)}%` },
                      { label: "Baseline conversion", value: `${(roiParams.baselineRetentionConversionRate * 100).toFixed(0)}%` },
                      { label: "Incremental saves", value: formatNumber(Math.round(incrementalSavedCustomers)) },
                    ],
                  }
                : null
            }
          />
        </div>

        {/* Financial KPIs · driven by the editable NBA rules */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <KpiCard
            label="Gross Retained Revenue"
            value={hasSource ? formatGbp(portfolioTotals.grossRetainedGbp, { compact: true }) : null}
            sub={`${formatNumber(portfolioTotals.saved, { compact: true })} customers saved over contract horizon`}
            icon={ShieldCheck}
            accent="success"
            prov={ruleProv}
          />
          <KpiCard
            label="Revenue Dilution"
            value={hasSource ? formatGbp(portfolioTotals.dilutionGbp, { compact: true }) : null}
            sub="Cost of discounts × ARPU × contract length"
            icon={Scissors}
            accent="risk"
            trend={{
              value:
                portfolioTotals.grossRetainedGbp > 0
                  ? `${((portfolioTotals.dilutionGbp / portfolioTotals.grossRetainedGbp) * 100).toFixed(0)}% of gross`
                  : "—",
              direction: "neutral",
            }}
            prov={ruleProv}
          />
          <KpiCard
            label="Net Retained Revenue"
            value={hasSource ? formatGbp(portfolioTotals.netRetainedGbp, { compact: true }) : null}
            sub="Gross − dilution − cost-to-serve"
            icon={BadgePoundSterling}
            accent="success"
            prov={ruleProv}
          />
          <KpiCard
            label="LTV Budget Used"
            value={hasSource ? `${portfolioTotals.ltvBudgetUsedPct.toFixed(1)}%` : null}
            sub={`of ${formatGbp(portfolioTotals.totalLtvGbp, { compact: true })} saved-customer LTV`}
            icon={Wallet}
            accent="neutral"
            trend={{
              value:
                portfolioTotals.ltvBudgetUsedPct < 25
                  ? "Healthy headroom"
                  : portfolioTotals.ltvBudgetUsedPct < 50
                    ? "Within plan"
                    : "Review pricing",
              direction:
                portfolioTotals.ltvBudgetUsedPct < 25
                  ? "up"
                  : portfolioTotals.ltvBudgetUsedPct < 50
                    ? "neutral"
                    : "down",
            }}
            prov={ruleProv}
          />
        </div>

        {/* Simulator */}
        <RoiSimulator />

        {/* Sensitivity analysis */}
        <SensitivityPanel />

        {/* Per-NBA-trigger sensitivity */}
        <PerTriggerSensitivityPanel />

        {/* Risk distribution */}
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Portfolio split
            </div>
            <h3 className="mt-1 text-base font-semibold text-foreground">Risk tier distribution</h3>
            <p className="text-xs text-muted-foreground mt-1">Across 3.5M scored accounts</p>
            <div className="h-[200px] mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segmentChartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    {segmentChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => formatNumber(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-2">
              {segmentSummary.map((s) => (
                <div key={s.tier} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{
                        background:
                          s.tier === "High"
                            ? "var(--risk-high)"
                            : s.tier === "Medium"
                              ? "var(--risk-medium)"
                              : "var(--risk-low)",
                      }}
                    />
                    <span className="font-medium text-foreground">{s.tier} Risk</span>
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {formatNumber(s.customerCount, { compact: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Tier characteristics
              </div>
              <h3 className="mt-1 text-base font-semibold text-foreground">
                Where the £438M risk concentrates
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Risk tier</th>
                    <th className="px-5 py-3 text-right font-medium">Customers</th>
                    <th className="px-5 py-3 text-right font-medium">Avg tenure</th>
                    <th className="px-5 py-3 text-right font-medium">Avg score</th>
                    <th className="px-5 py-3 text-left font-medium">Dominant package</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {segmentSummary.map((s) => (
                    <tr key={s.tier} className="hover:bg-muted/40 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{
                              background:
                                s.tier === "High"
                                  ? "var(--risk-high)"
                                  : s.tier === "Medium"
                                    ? "var(--risk-medium)"
                                    : "var(--risk-low)",
                            }}
                          />
                          <span className="font-medium text-foreground">{s.tier} Risk</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-foreground">
                        {formatNumber(s.customerCount)}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                        {(s.avgTenureDays / 365).toFixed(1)} yrs
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                        {s.avgRiskScore.toFixed(3)}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">{s.dominantPackage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
