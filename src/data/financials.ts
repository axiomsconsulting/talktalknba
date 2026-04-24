// Shared financial model used across the dashboard, RoiSimulator, PDF and
// customer profile. The financial answer the audience cares about is:
//
//   gross saved revenue (over the discount horizon)
//   - revenue dilution (discount % × ARPU × contract months × saved customers)
//   - cost-to-serve (cost-per-contact × contacted)
//   = NET retained revenue
//
// LTV horizon is tier-based (churn-adjusted) so a saved low-risk customer
// is worth far more than a saved high-risk one. Numbers reflect the trained
// model's segment_risk_summary.

import type { RiskTier } from "./nba";
import type { NbaRule } from "./nbaRulesStore";
import type { NbaTriggerKey } from "./customers";

// Annualised churn rates inferred from segment_risk_summary average scores.
// (Tuned so total expected losses ≈ revenue at risk in the dashboard.)
export const TIER_ANNUAL_CHURN: Record<RiskTier, number> = {
  High: 0.45,
  Medium: 0.18,
  Low: 0.06,
};

// LTV horizon in months = 12 / annual churn (i.e. expected remaining tenure
// under the steady-state assumption). Capped at 10 years.
export function tierHorizonMonths(tier: RiskTier): number {
  return Math.min(120, 12 / TIER_ANNUAL_CHURN[tier]);
}

export function customerLtv(monthlyArpu: number, tier: RiskTier): number {
  return monthlyArpu * tierHorizonMonths(tier);
}

// Per-trigger financials for the RoiSimulator breakdown table.
export type RuleFinancials = {
  triggerKey: NbaTriggerKey;
  label: string;
  channel: string;
  contacted: number;
  saved: number;
  grossRetainedGbp: number;     // saved × ARPU × contract length
  dilutionGbp: number;          // discount × ARPU × contract length × saved
  costToServeGbp: number;       // contacted × cost-per-contact
  netRetainedGbp: number;       // gross − dilution − cost
  ltvBudgetUsedPct: number;     // (dilution + cost) / (saved × LTV)
};

export type ScenarioInputs = {
  highRiskVolume: number;
  averageMonthlyArpuGbp: number;
  baselineRetentionConversionRate: number;
  successRate: number;
};

// Distribute campaign volumes across active rules using a fixed mix that
// roughly mirrors the treatment matrix. Rules without an active flag are
// excluded; suppress is excluded from contacted/saved entirely.
const RULE_MIX: Record<NbaTriggerKey, number> = {
  loyalty_save_desk: 0.32,
  free_tech_upgrade: 0.18,
  rightsize_email: 0.22,
  competitor_match: 0.10,
  nurture: 0.18,
  suppress: 0.0,
};

export function computeRuleFinancials(
  rules: NbaRule[],
  inputs: ScenarioInputs,
  primaryTier: RiskTier = "High",
): RuleFinancials[] {
  const activeRules = rules.filter((r) => r.isActive && r.triggerKey !== "suppress");
  // Renormalise mix across whatever is active.
  const totalWeight = activeRules.reduce(
    (s, r) => s + (RULE_MIX[r.triggerKey] ?? 0),
    0,
  );
  if (totalWeight === 0) return [];

  const arpuMonthly = inputs.averageMonthlyArpuGbp;
  const ltv = customerLtv(arpuMonthly, primaryTier);

  return activeRules
    .map((rule) => {
      const share = (RULE_MIX[rule.triggerKey] ?? 0) / totalWeight;
      const contacted = Math.round(inputs.highRiskVolume * share);
      const saved = Math.round(contacted * inputs.successRate);
      const horizonMonths =
        rule.contractMonths > 0
          ? rule.contractMonths
          : tierHorizonMonths(primaryTier);
      const grossRetained = saved * arpuMonthly * horizonMonths;
      const dilution = saved * arpuMonthly * horizonMonths * (rule.discountPct / 100);
      const costToServe = contacted * rule.costPerContactGbp;
      const net = grossRetained - dilution - costToServe;
      const totalLtv = saved * ltv;
      const budgetUsedPct = totalLtv > 0 ? ((dilution + costToServe) / totalLtv) * 100 : 0;
      return {
        triggerKey: rule.triggerKey,
        label: rule.label,
        channel: rule.channel,
        contacted,
        saved,
        grossRetainedGbp: Math.round(grossRetained),
        dilutionGbp: Math.round(dilution),
        costToServeGbp: Math.round(costToServe),
        netRetainedGbp: Math.round(net),
        ltvBudgetUsedPct: Number(budgetUsedPct.toFixed(1)),
      };
    });
}

export type PortfolioTotals = {
  contacted: number;
  saved: number;
  grossRetainedGbp: number;
  dilutionGbp: number;
  costToServeGbp: number;
  netRetainedGbp: number;
  totalLtvGbp: number;
  ltvBudgetUsedPct: number;
};

export function summariseRuleFinancials(rows: RuleFinancials[], avgLtvPerSave: number): PortfolioTotals {
  const totals = rows.reduce(
    (acc, r) => {
      acc.contacted += r.contacted;
      acc.saved += r.saved;
      acc.grossRetainedGbp += r.grossRetainedGbp;
      acc.dilutionGbp += r.dilutionGbp;
      acc.costToServeGbp += r.costToServeGbp;
      acc.netRetainedGbp += r.netRetainedGbp;
      return acc;
    },
    {
      contacted: 0,
      saved: 0,
      grossRetainedGbp: 0,
      dilutionGbp: 0,
      costToServeGbp: 0,
      netRetainedGbp: 0,
    },
  );
  const totalLtv = totals.saved * avgLtvPerSave;
  return {
    ...totals,
    totalLtvGbp: Math.round(totalLtv),
    ltvBudgetUsedPct:
      totalLtv > 0 ? Number((((totals.dilutionGbp + totals.costToServeGbp) / totalLtv) * 100).toFixed(1)) : 0,
  };
}
