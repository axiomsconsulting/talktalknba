// Real summarised data from the TalkTalk model output.
// Source: nba_roi_params.json, segment_risk_summary.csv, feature_importance.json

export const roiParams = {
  totalCustomerBase: 3_545_538,
  highRiskVolume: 1_043_449,
  averageAnnualArpuGbp: 420.0,
  baselineRetentionConversionRate: 0.15,
  revenueAtRiskGbp: 438_248_580.0,
};

export type RiskTier = "High" | "Medium" | "Low";

export const segmentSummary: Array<{
  tier: RiskTier;
  customerCount: number;
  avgTenureDays: number;
  avgRiskScore: number;
  dominantPackage: string;
}> = [
  {
    tier: "High",
    customerCount: 1_043_449,
    avgTenureDays: 835.79,
    avgRiskScore: 0.8223,
    dominantPackage: "Fibre 65 (FTTC-OR)",
  },
  {
    tier: "Medium",
    customerCount: 1_239_063,
    avgTenureDays: 1944.45,
    avgRiskScore: 0.5070,
    dominantPackage: "Fibre 65 (FTTC-OR)",
  },
  {
    tier: "Low",
    customerCount: 1_263_026,
    avgTenureDays: 3972.96,
    avgRiskScore: 0.1575,
    dominantPackage: "Fibre 65 (FTTC-OR)",
  },
];

// Friendly feature labels for the explainability page
export const featureLabels: Record<string, { label: string; description: string }> = {
  tenure_days: {
    label: "Customer Tenure",
    description: "Days since the customer joined TalkTalk",
  },
  loyalty_calls: {
    label: "Loyalty Calls",
    description: "Inbound calls to the loyalty / save desk",
  },
  ooc_days: {
    label: "Days Out of Contract",
    description: "Time elapsed since minimum-term contract ended",
  },
  total_talk_time: {
    label: "Total Talk Time",
    description: "Aggregate seconds spent on inbound support calls",
  },
  total_hold_time: {
    label: "Total Hold Time",
    description: "Aggregate seconds the customer waited on hold",
  },
  avg_download_mbs: {
    label: "Avg Download Speed",
    description: "Realised broadband throughput vs. package headline",
  },
  contract_dd_cancels: {
    label: "Direct Debit Cancellations",
    description: "DD cancellation events during contract lifetime",
  },
  speed_deficit: {
    label: "Speed Deficit",
    description: "Gap between sold and delivered line speed",
  },
  dd_cancel_60_day: {
    label: "Recent DD Cancel (60d)",
    description: "Direct Debit cancelled within the last 60 days",
  },
};

export const featureImportance: Array<{ feature: string; importance: number }> = [
  { feature: "tenure_days", importance: 0.4854 },
  { feature: "loyalty_calls", importance: 0.1181 },
  { feature: "ooc_days", importance: 0.1051 },
  { feature: "total_talk_time", importance: 0.0795 },
  { feature: "total_hold_time", importance: 0.0705 },
  { feature: "avg_download_mbs", importance: 0.052 },
  { feature: "contract_dd_cancels", importance: 0.0382 },
  { feature: "speed_deficit", importance: 0.0302 },
  { feature: "dd_cancel_60_day", importance: 0.021 },
];

// Treatment matrix — Risk × Context → Next Best Action
export const treatmentMatrix: Array<{
  segment: string;
  riskTier: RiskTier;
  context: string;
  action: string;
  channel: string;
  expectedLift: string;
  // approximate share of the total base falling in this bucket
  shareOfBase: number;
}> = [
  {
    segment: "High Risk · Out of Contract",
    riskTier: "High",
    context: "OOC > 60d, Fibre package, talk time elevated",
    action: "Proactive Save Call · 20% loyalty discount, 24-month re-contract",
    channel: "Outbound Call",
    expectedLift: "+18 ppt vs control",
    shareOfBase: 0.21, // ~21% of base
  },
  {
    segment: "High Risk · In Contract",
    riskTier: "High",
    context: "Speed deficit > 30%, recent DD issues",
    action: "Engineer dispatch + service credit (£15)",
    channel: "Outbound Call + SMS",
    expectedLift: "+12 ppt vs control",
    shareOfBase: 0.08,
  },
  {
    segment: "Medium Risk · High Usage",
    riskTier: "Medium",
    context: "Fibre 65 customer hitting bandwidth ceiling",
    action: "Email offering Fibre 150 / Full Fibre upgrade",
    channel: "Email + In-app",
    expectedLift: "+9 ppt vs control",
    shareOfBase: 0.19,
  },
  {
    segment: "Medium Risk · Loyalty Caller",
    riskTier: "Medium",
    context: "≥1 loyalty call in last 90d, in contract",
    action: "Personalised retention email · annual review",
    channel: "Email",
    expectedLift: "+6 ppt vs control",
    shareOfBase: 0.16,
  },
  {
    segment: "Low Risk · Long Tenure",
    riskTier: "Low",
    context: "Tenure > 8 yrs, no recent service events",
    action: "Do Not Disturb · annual thank-you only",
    channel: "Suppress",
    expectedLift: "Avoid £4.20 contact cost",
    shareOfBase: 0.28,
  },
  {
    segment: "Low Risk · New Customer",
    riskTier: "Low",
    context: "Tenure < 180 days, healthy usage",
    action: "Onboarding nurture sequence",
    channel: "Email + In-app",
    expectedLift: "Brand affinity",
    shareOfBase: 0.08,
  },
];

// Compact formatter implemented manually so SSR (Node ICU) and the browser
// always agree byte-for-byte. Intl.NumberFormat with notation:"compact" can
// disagree between runtimes (e.g. "£71M" vs "£71.0M") because of CLDR
// version drift, which causes React hydration mismatches.
function compactGbp(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}£${Math.round(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}£${Math.round(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}K`;
  return `${sign}£${Math.round(abs)}`;
}

function compactNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${Math.round(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${Math.round(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

export function formatGbp(value: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) return compactGbp(value);
  // Manual thousands formatting for SSR/client parity.
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const parts = Math.abs(rounded).toString().split("");
  for (let i = parts.length - 3; i > 0; i -= 3) parts.splice(i, 0, ",");
  return `${sign}£${parts.join("")}`;
}

export function formatNumber(value: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) return compactNumber(value);
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const parts = Math.abs(rounded).toString().split("");
  for (let i = parts.length - 3; i > 0; i -= 3) parts.splice(i, 0, ",");
  return `${sign}${parts.join("")}`;
}
