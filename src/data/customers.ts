// Mock customer data for the Explainability page.
// 6 hand-crafted personas + ~50 procedurally generated customers
// drawn from the segment_risk_summary distribution.
//
// These can later be overridden by uploading customer_info.parquet.

import type { RiskTier } from "./nba";

export type SHAPContribution = {
  feature: string;
  label: string;
  // Positive = pushes risk up. Negative = pulls risk down.
  impact: number;
  detail: string;
};

export type BehavioralSignals = {
  // Calls (from calls.csv)
  loyaltyCalls90d: number;
  totalHoldSeconds: number;
  totalTalkSeconds: number;
  // Contract / network (from customer_info.parquet)
  oocDays: number;
  soldSpeedMbps: number;
  lineSpeedMbps: number;
  technology: string;
  // Usage (from usage.parquet)
  monthlyDownloadGb: number;
  monthlyUploadGb: number;
  // Cease intent (from cease.csv) — derived insight if present
  ceaseInsight?: "CompetitorDeals" | "HomeMove" | "Bereavement" | "Other" | "VagueReason";
  preferredChannel?: string;
};

export type Customer = {
  id: string;
  name: string;
  tenureDays: number;
  package: string;
  riskScore: number;
  riskTier: RiskTier;
  monthlyArpu: number;
  contractStatus: "In contract" | "Out of contract" | "Rolling";
  region: string;
  // Pre-computed SHAP contributions ordered by absolute impact
  shap: SHAPContribution[];
  // Optional persona narrative
  persona?: string;
  // Live behavioural signals surfaced in the explainability profile
  signals?: BehavioralSignals;
  // The Next Best Action this customer should receive
  nbaTrigger?: NbaTriggerKey;
};

export type NbaTriggerKey =
  | "loyalty_save_desk"
  | "free_tech_upgrade"
  | "rightsize_email"
  | "competitor_match"
  | "suppress"
  | "nurture";

const PACKAGES = [
  "Fibre 35 (FTTC-OR)",
  "Fibre 65 (FTTC-OR)",
  "Fibre 150 (FTTP)",
  "Fibre 500 (FTTP)",
  "Full Fibre 900 (G.Fast)",
  "ADSL Essentials",
];

const REGIONS = [
  "Greater London",
  "North West",
  "West Midlands",
  "Yorkshire & Humber",
  "South East",
  "Scotland",
  "Wales",
  "East of England",
];

// 6 hand-crafted persona archetypes with carefully tuned SHAP breakdowns.
const PERSONAS: Customer[] = [
  {
    id: "TT-2048771",
    name: "Margaret Holloway",
    persona: "Long-tenure FTTC, recently out of contract",
    tenureDays: 2_847,
    package: "Fibre 65 (FTTC-OR)",
    riskScore: 0.91,
    riskTier: "High",
    monthlyArpu: 38.0,
    contractStatus: "Out of contract",
    region: "South East",
    nbaTrigger: "loyalty_save_desk",
    signals: {
      loyaltyCalls90d: 2,
      totalHoldSeconds: 2820, // 47 min
      totalTalkSeconds: 1860,
      oocDays: 182,
      soldSpeedMbps: 67,
      lineSpeedMbps: 64,
      technology: "FTTC",
      monthlyDownloadGb: 240,
      monthlyUploadGb: 18,
      preferredChannel: "Outbound Call",
    },
    shap: [
      { feature: "ooc_days", label: "Days Out of Contract", impact: 0.22, detail: "182 days since contract end — well above the 60-day inflection point." },
      { feature: "loyalty_calls", label: "Loyalty Calls", impact: 0.18, detail: "2 inbound calls to retentions in the last 60 days." },
      { feature: "dd_cancel_60_day", label: "Recent DD Cancel (60d)", impact: 0.15, detail: "Direct Debit cancelled 23 days ago, then reinstated." },
      { feature: "total_hold_time", label: "Total Hold Time", impact: 0.09, detail: "47 minutes on hold across recent contacts." },
      { feature: "tenure_days", label: "Customer Tenure", impact: -0.06, detail: "7.8 years of tenure provides modest stickiness." },
    ],
  },
  {
    id: "TT-1739044",
    name: "Daniel Okafor",
    persona: "New Fibre 65 with multiple loyalty calls",
    tenureDays: 142,
    package: "Fibre 65 (FTTC-OR)",
    riskScore: 0.84,
    riskTier: "High",
    monthlyArpu: 32.0,
    contractStatus: "In contract",
    region: "Greater London",
    nbaTrigger: "loyalty_save_desk",
    signals: {
      loyaltyCalls90d: 3,
      totalHoldSeconds: 1560,
      totalTalkSeconds: 6720, // 112 min
      oocDays: -218,
      soldSpeedMbps: 67,
      lineSpeedMbps: 41,
      technology: "FTTC",
      monthlyDownloadGb: 180,
      monthlyUploadGb: 12,
      preferredChannel: "Outbound Call",
    },
    shap: [
      { feature: "tenure_days", label: "Customer Tenure", impact: 0.28, detail: "Only 142 days tenure — early-life churn risk." },
      { feature: "loyalty_calls", label: "Loyalty Calls", impact: 0.22, detail: "3 loyalty calls in 90 days — actively shopping." },
      { feature: "speed_deficit", label: "Speed Deficit", impact: 0.14, detail: "Receiving 41 Mbps vs 67 Mbps sold (39% deficit)." },
      { feature: "total_talk_time", label: "Total Talk Time", impact: 0.08, detail: "112 minutes on inbound support — frustrated." },
    ],
  },
  {
    id: "TT-3309128",
    name: "Priya Ramanathan",
    persona: "Heavy user on Fibre 65, capacity-constrained",
    tenureDays: 1_540,
    package: "Fibre 65 (FTTC-OR)",
    riskScore: 0.61,
    riskTier: "Medium",
    monthlyArpu: 35.0,
    contractStatus: "Rolling",
    region: "West Midlands",
    nbaTrigger: "rightsize_email",
    signals: {
      loyaltyCalls90d: 0,
      totalHoldSeconds: 240,
      totalTalkSeconds: 540,
      oocDays: 92,
      soldSpeedMbps: 67,
      lineSpeedMbps: 63,
      technology: "FTTC",
      monthlyDownloadGb: 1850,
      monthlyUploadGb: 120,
      preferredChannel: "Email + In-app",
    },
    shap: [
      { feature: "avg_download_mbs", label: "Avg Download Speed", impact: 0.18, detail: "Sustained throughput at 95% of cap — capacity-bound." },
      { feature: "ooc_days", label: "Days Out of Contract", impact: 0.12, detail: "On rolling monthly terms for 3 months." },
      { feature: "total_talk_time", label: "Total Talk Time", impact: 0.06, detail: "1 support call about slow speeds." },
      { feature: "loyalty_calls", label: "Loyalty Calls", impact: -0.04, detail: "No retention contact — disengaged but not unhappy." },
    ],
  },
  {
    id: "TT-0892310",
    name: "James Whitcombe",
    persona: "Settled long-tenure customer, low risk",
    tenureDays: 4_650,
    package: "Fibre 65 (FTTC-OR)",
    riskScore: 0.12,
    riskTier: "Low",
    monthlyArpu: 36.0,
    contractStatus: "In contract",
    region: "Yorkshire & Humber",
    nbaTrigger: "suppress",
    signals: {
      loyaltyCalls90d: 0,
      totalHoldSeconds: 0,
      totalTalkSeconds: 0,
      oocDays: -420,
      soldSpeedMbps: 67,
      lineSpeedMbps: 65,
      technology: "FTTC",
      monthlyDownloadGb: 95,
      monthlyUploadGb: 6,
      preferredChannel: "Suppress",
    },
    shap: [
      { feature: "tenure_days", label: "Customer Tenure", impact: -0.32, detail: "12.7 years tenure — strongest retention signal in the model." },
      { feature: "loyalty_calls", label: "Loyalty Calls", impact: -0.10, detail: "No loyalty contact in 24 months." },
      { feature: "contract_dd_cancels", label: "Direct Debit Cancellations", impact: -0.06, detail: "Zero DD failures across history." },
      { feature: "ooc_days", label: "Days Out of Contract", impact: -0.04, detail: "In contract for 14 more months." },
    ],
  },
  {
    id: "TT-4471209",
    name: "Aisha Bennett",
    persona: "FTTP upgrade candidate, healthy but underutilised",
    tenureDays: 980,
    package: "Fibre 150 (FTTP)",
    riskScore: 0.44,
    riskTier: "Medium",
    monthlyArpu: 47.0,
    contractStatus: "In contract",
    region: "North West",
    nbaTrigger: "rightsize_email",
    signals: {
      loyaltyCalls90d: 1,
      totalHoldSeconds: 540,
      totalTalkSeconds: 360,
      oocDays: -160,
      soldSpeedMbps: 150,
      lineSpeedMbps: 144,
      technology: "FTTP",
      monthlyDownloadGb: 70,
      monthlyUploadGb: 8,
      preferredChannel: "Email + In-app",
    },
    shap: [
      { feature: "avg_download_mbs", label: "Avg Download Speed", impact: 0.08, detail: "Using 22% of available bandwidth — over-spec'd." },
      { feature: "tenure_days", label: "Customer Tenure", impact: -0.10, detail: "2.7 years — moderate stickiness." },
      { feature: "loyalty_calls", label: "Loyalty Calls", impact: 0.05, detail: "1 call about pricing in 6 months." },
      { feature: "total_hold_time", label: "Total Hold Time", impact: 0.03, detail: "9 minutes on hold — minor friction." },
    ],
  },
  {
    id: "TT-2756814",
    name: "Robert Ashworth",
    persona: "ADSL holdout, deeply tenured, price-sensitive",
    tenureDays: 5_840,
    package: "ADSL Essentials",
    riskScore: 0.78,
    riskTier: "High",
    monthlyArpu: 22.0,
    contractStatus: "Out of contract",
    region: "Wales",
    nbaTrigger: "free_tech_upgrade",
    signals: {
      loyaltyCalls90d: 1,
      totalHoldSeconds: 1320,
      totalTalkSeconds: 980,
      oocDays: 411,
      soldSpeedMbps: 17,
      lineSpeedMbps: 6,
      technology: "ADSL",
      monthlyDownloadGb: 28,
      monthlyUploadGb: 3,
      ceaseInsight: "CompetitorDeals",
      preferredChannel: "Outbound Call",
    },
    shap: [
      { feature: "ooc_days", label: "Days Out of Contract", impact: 0.20, detail: "OOC for 411 days — sustained exposure." },
      { feature: "speed_deficit", label: "Speed Deficit", impact: 0.16, detail: "ADSL line delivering 6 Mbps in an FTTC-enabled exchange." },
      { feature: "contract_dd_cancels", label: "DD Cancellations", impact: 0.11, detail: "2 DD cancellations in last 18 months." },
      { feature: "tenure_days", label: "Customer Tenure", impact: -0.18, detail: "16 years tenure offsets some risk." },
    ],
  },
];

// Deterministic PRNG so the procedurally generated list is stable across renders.
function mulberry32(seed: number) {
  let t = seed;
  return function () {
    t |= 0;
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ["Oliver", "Amelia", "George", "Sophia", "Harry", "Lily", "Noah", "Mia", "Charlie", "Isla", "Jack", "Ava", "Leo", "Grace", "Theo", "Freya", "Arthur", "Ella", "Henry", "Poppy", "Jacob", "Evie", "Thomas", "Ivy", "Oscar", "Florence", "William", "Daisy", "Mohammed", "Zara"];
const LAST_NAMES = ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Robinson", "Wright", "Thompson", "Evans", "Walker", "White", "Roberts", "Green", "Hall", "Wood", "Khan", "Patel", "Singh", "Begum", "Ahmed", "Lewis", "Clarke"];

function generateShap(tier: RiskTier, rand: () => number): SHAPContribution[] {
  // Distribute realistic contributions consistent with the global feature importance
  const baseFactors = (() => {
    if (tier === "High") {
      return [
        { feature: "ooc_days", label: "Days Out of Contract", impact: 0.12 + rand() * 0.12, detail: `${Math.floor(80 + rand() * 320)} days since contract end.` },
        { feature: "loyalty_calls", label: "Loyalty Calls", impact: 0.08 + rand() * 0.10, detail: `${1 + Math.floor(rand() * 3)} loyalty calls in last 90 days.` },
        { feature: "dd_cancel_60_day", label: "Recent DD Cancel (60d)", impact: 0.06 + rand() * 0.08, detail: rand() > 0.5 ? "DD cancelled within last 60 days." : "DD failure on most recent collection." },
        { feature: "tenure_days", label: "Customer Tenure", impact: -0.04 - rand() * 0.06, detail: "Tenure offsets some risk." },
      ];
    }
    if (tier === "Medium") {
      return [
        { feature: "avg_download_mbs", label: "Avg Download Speed", impact: 0.06 + rand() * 0.08, detail: "Bandwidth utilisation above 80% of cap." },
        { feature: "total_talk_time", label: "Total Talk Time", impact: 0.04 + rand() * 0.06, detail: `${10 + Math.floor(rand() * 60)} minutes on inbound support.` },
        { feature: "ooc_days", label: "Days Out of Contract", impact: 0.03 + rand() * 0.06, detail: `${Math.floor(rand() * 90)} days since contract end.` },
        { feature: "tenure_days", label: "Customer Tenure", impact: -0.06 - rand() * 0.05, detail: "Mid-tenure customer." },
      ];
    }
    return [
      { feature: "tenure_days", label: "Customer Tenure", impact: -0.20 - rand() * 0.15, detail: "Long-tenure customer — strongest retention signal." },
      { feature: "loyalty_calls", label: "Loyalty Calls", impact: -0.05 - rand() * 0.05, detail: "No retention contact in 12+ months." },
      { feature: "contract_dd_cancels", label: "DD Cancellations", impact: -0.03 - rand() * 0.03, detail: "Clean payment history." },
      { feature: "ooc_days", label: "Days Out of Contract", impact: -0.02 - rand() * 0.03, detail: "Comfortably in contract." },
    ];
  })();
  return baseFactors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

// Decide which Next Best Action a customer should receive based on their
// behavioural signals. The rules mirror the four NBA triggers documented on
// the Strategy page so the explainability and strategy views stay in sync.
// NOTE: declared as `const` and placed before generateCustomers so module
// init code below can reference it under Vite's ESM dev runtime.
export const deriveNbaTrigger = (input: {
  riskTier: RiskTier;
  contractStatus: Customer["contractStatus"];
  signals?: Partial<BehavioralSignals>;
  package: string;
}): NbaTriggerKey => {
  const { riskTier, contractStatus, signals = {}, package: pkg } = input;
  const speedDeficit =
    signals.soldSpeedMbps && signals.lineSpeedMbps
      ? (signals.soldSpeedMbps - signals.lineSpeedMbps) / signals.soldSpeedMbps
      : 0;
  const isHeavyUser =
    (signals.monthlyDownloadGb ?? 0) > 800 &&
    /Fibre 35|Fibre 65|ADSL|Essentials/i.test(pkg);

  if (riskTier === "Low") return "suppress";
  if (signals.ceaseInsight === "CompetitorDeals") return "competitor_match";
  if ((signals.loyaltyCalls90d ?? 0) >= 2 || (signals.totalHoldSeconds ?? 0) > 1800) {
    return "loyalty_save_desk";
  }
  if (speedDeficit > 0.25 || /ADSL|Fibre 35/i.test(pkg)) return "free_tech_upgrade";
  if (isHeavyUser) return "rightsize_email";
  if (riskTier === "High" && contractStatus === "Out of contract") return "loyalty_save_desk";
  return "nurture";
};

function generateCustomers(): Customer[] {
  const rand = mulberry32(42);
  // Distribution weights from segment_risk_summary
  const distribution: Array<{ tier: RiskTier; weight: number; tenureMean: number; tenureSpread: number; scoreMean: number; scoreSpread: number }> = [
    { tier: "High", weight: 0.295, tenureMean: 836, tenureSpread: 600, scoreMean: 0.82, scoreSpread: 0.10 },
    { tier: "Medium", weight: 0.350, tenureMean: 1944, tenureSpread: 900, scoreMean: 0.51, scoreSpread: 0.12 },
    { tier: "Low", weight: 0.355, tenureMean: 3973, tenureSpread: 1500, scoreMean: 0.16, scoreSpread: 0.10 },
  ];

  const customers: Customer[] = [];
  for (let i = 0; i < 50; i++) {
    const r = rand();
    let acc = 0;
    const seg = distribution.find((d) => {
      acc += d.weight;
      return r <= acc;
    }) ?? distribution[0];

    const tenure = Math.max(30, Math.round(seg.tenureMean + (rand() - 0.5) * 2 * seg.tenureSpread));
    const score = Math.max(0.02, Math.min(0.98, seg.scoreMean + (rand() - 0.5) * 2 * seg.scoreSpread));
    const id = `TT-${(1_000_000 + Math.floor(rand() * 8_999_999)).toString().padStart(7, "0")}`;
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
    const pkg = PACKAGES[Math.floor(rand() * PACKAGES.length)];
    const region = REGIONS[Math.floor(rand() * REGIONS.length)];
    const monthlyArpu = 22 + Math.round(rand() * 32);
    const contractStatus: Customer["contractStatus"] =
      seg.tier === "High" && rand() > 0.4 ? "Out of contract" : rand() > 0.7 ? "Rolling" : "In contract";

    // Behavioural signals tuned to the segment
    const techPool = ["FTTC", "FTTC", "FTTP", "ADSL", "GFAST"];
    const technology = techPool[Math.floor(rand() * techPool.length)];
    const soldSpeedMbps = pkg.includes("ADSL") ? 17 : pkg.includes("Fibre 35") ? 38 : pkg.includes("Fibre 65") || pkg.includes("Faster") ? 67 : pkg.includes("Fibre 150") ? 150 : pkg.includes("Fibre 500") ? 500 : 900;
    const speedDeficit = seg.tier === "High" ? 0.25 + rand() * 0.4 : seg.tier === "Medium" ? rand() * 0.2 : rand() * 0.05;
    const lineSpeedMbps = Math.max(2, Math.round(soldSpeedMbps * (1 - speedDeficit)));
    const oocDays = contractStatus === "Out of contract" ? Math.round(60 + rand() * 600) : contractStatus === "Rolling" ? Math.round(rand() * 90) : -Math.round(60 + rand() * 540);
    const loyaltyCalls90d = seg.tier === "High" ? 1 + Math.floor(rand() * 3) : seg.tier === "Medium" ? Math.floor(rand() * 2) : 0;
    const totalHoldSeconds = seg.tier === "High" ? Math.round(600 + rand() * 2400) : seg.tier === "Medium" ? Math.round(rand() * 800) : 0;
    const totalTalkSeconds = seg.tier === "High" ? Math.round(900 + rand() * 4200) : seg.tier === "Medium" ? Math.round(rand() * 1200) : Math.round(rand() * 200);
    const monthlyDownloadGb = pkg.includes("ADSL") ? Math.round(20 + rand() * 80) : seg.tier === "Medium" ? Math.round(400 + rand() * 1800) : Math.round(60 + rand() * 400);
    const monthlyUploadGb = Math.round(monthlyDownloadGb * (0.04 + rand() * 0.06));
    const ceaseInsight: BehavioralSignals["ceaseInsight"] | undefined =
      seg.tier === "High" && rand() > 0.55 ? (rand() > 0.5 ? "CompetitorDeals" : "VagueReason") : undefined;

    const signals: BehavioralSignals = {
      loyaltyCalls90d,
      totalHoldSeconds,
      totalTalkSeconds,
      oocDays,
      soldSpeedMbps,
      lineSpeedMbps,
      technology,
      monthlyDownloadGb,
      monthlyUploadGb,
      ceaseInsight,
    };

    customers.push({
      id,
      name: `${first} ${last}`,
      tenureDays: tenure,
      package: pkg,
      riskScore: Number(score.toFixed(3)),
      riskTier: seg.tier,
      monthlyArpu,
      contractStatus,
      region,
      shap: generateShap(seg.tier, rand),
      signals,
      nbaTrigger: deriveNbaTrigger({ riskTier: seg.tier, contractStatus, signals, package: pkg }),
    });
  }
  return customers;
}

// Decide which Next Best Action a customer should receive based on their
// behavioural signals. The rules mirror the four NBA triggers documented on
// the Strategy page so the explainability and strategy views stay in sync.
// NOTE: declared as `const` rather than `function` so module-init code that
// runs at the top of this file (generateCustomers) can rely on it being
// initialised before use under Vite's ESM dev runtime.
export const deriveNbaTrigger = (input: {
  riskTier: RiskTier;
  contractStatus: Customer["contractStatus"];
  signals?: Partial<BehavioralSignals>;
  package: string;
}): NbaTriggerKey => {
  const { riskTier, contractStatus, signals = {}, package: pkg } = input;
  const speedDeficit =
    signals.soldSpeedMbps && signals.lineSpeedMbps
      ? (signals.soldSpeedMbps - signals.lineSpeedMbps) / signals.soldSpeedMbps
      : 0;
  const isHeavyUser =
    (signals.monthlyDownloadGb ?? 0) > 800 &&
    /Fibre 35|Fibre 65|ADSL|Essentials/i.test(pkg);

  if (riskTier === "Low") return "suppress";
  if (signals.ceaseInsight === "CompetitorDeals") return "competitor_match";
  if ((signals.loyaltyCalls90d ?? 0) >= 2 || (signals.totalHoldSeconds ?? 0) > 1800) {
    return "loyalty_save_desk";
  }
  if (speedDeficit > 0.25 || /ADSL|Fibre 35/i.test(pkg)) return "free_tech_upgrade";
  if (isHeavyUser) return "rightsize_email";
  if (riskTier === "High" && contractStatus === "Out of contract") return "loyalty_save_desk";
  return "nurture";
};

export const NBA_TRIGGERS: Record<
  NbaTriggerKey,
  { label: string; description: string; channel: string; offer: string }
> = {
  loyalty_save_desk: {
    label: "Specialist Save Desk",
    description:
      "Multiple loyalty calls or extended hold time → friction + active shopping. Route to a specialist save agent with a pre-approved discount.",
    channel: "Outbound Call",
    offer: "20% loyalty discount + 24-month re-contract",
  },
  free_tech_upgrade: {
    label: "Free Tech Upgrade",
    description:
      "Speed deficit or legacy technology → fix the root cause rather than discounting. Move them to a faster line at the same price.",
    channel: "Outbound Call + Engineer Visit",
    offer: "FTTC → G.Fast / FTTP migration, no install fee",
  },
  rightsize_email: {
    label: "Right-size Upgrade Email",
    description:
      "Heavy usage on a basic package → throttling and poor performance. Trigger an automated upgrade campaign tailored to their use case.",
    channel: "Email + In-app",
    offer: "Premium fibre package, 6-month price hold",
  },
  competitor_match: {
    label: "Competitor-match Save Offer",
    description:
      "Cease intent matches Competitor Deals patterns → price is the primary lever. Trigger highest-tier retention offer immediately via preferred channel.",
    channel: "Customer's preferred channel",
    offer: "Top-tier price match (£/month off)",
  },
  suppress: {
    label: "Do Not Disturb",
    description:
      "Long-tenure low-risk customer. Outbound contact would erode satisfaction and induce churn — hold in nurture sequences only.",
    channel: "Suppress",
    offer: "Annual thank-you only",
  },
  nurture: {
    label: "Personalised Nurture",
    description:
      "Mid-risk customer without a single dominant trigger. Send a personalised retention email with usage insights.",
    channel: "Email",
    offer: "Account review + bill explainer",
  },
};

export const personas: Customer[] = PERSONAS;
export const generatedCustomers: Customer[] = generateCustomers();
export const allCustomers: Customer[] = [...PERSONAS, ...generatedCustomers];
