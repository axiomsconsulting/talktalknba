// Single source of truth for the in-app NBA scoring algorithm.
//
// Both the client (sample / locally uploaded data) and the
// /api/score-customer endpoint (live data) call `scoreCustomer`
// so the API tester is guaranteed to match what the UI shows.
//
// Mirrors:
//   computeRiskScore() in src/data/customerMapping.ts
//   tierFromScore()    in src/data/customerMapping.ts
//   deriveNbaTrigger() in src/data/customers.ts
//   enrichment SHAP bumps in src/data/customerStore.ts / customerMapping.ts
//
// Keep this file framework-free (no React, no Supabase) so it can
// run inside an edge handler without bundler surprises.

import type { BehavioralSignals, NbaTriggerKey, SHAPContribution } from "./customers";
import { NBA_TRIGGERS } from "./customers";
import type { RiskTier } from "./nba";

export type ScoringInput = {
  id: string;
  name?: string;
  package: string;
  tenureDays: number;
  contractStatusRaw: string;
  oocDays: number;
  ddCancel60: number;
  contractDdCancels: number;
  soldSpeedMbps: number;
  lineSpeedMbps: number;
  technology?: string;
  // Enrichments — optional; zeros / undefined are safe.
  loyaltyCalls90d?: number;
  totalHoldSeconds?: number;
  totalTalkSeconds?: number;
  monthlyDownloadGb?: number;
  monthlyUploadGb?: number;
  ceaseInsight?: BehavioralSignals["ceaseInsight"];
  preferredChannel?: string;
  // Optional pre-computed score override (for live `top_customers` rows).
  riskScoreOverride?: number | null;
};

export type ScoringResult = {
  customer: {
    id: string;
    name: string;
    package: string;
    tenureDays: number;
    contractStatus: "In contract" | "Out of contract" | "Rolling";
    region?: string;
  };
  riskScore: number;
  riskTier: RiskTier;
  baseScore: number;
  shap: SHAPContribution[];
  nba: {
    trigger: NbaTriggerKey;
    label: string;
    description: string;
    channel: string;
    offer: string;
  };
  signals: BehavioralSignals;
  whyThisCustomer: string;
  whyThisNba: string;
  speedDeficitPct: number;
};

const round3 = (n: number) => Number(n.toFixed(3));

export function tierFromScore(score: number): RiskTier {
  if (score >= 0.65) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

export function normaliseContract(raw: string): "In contract" | "Out of contract" | "Rolling" {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("ooc") || s.includes("out of contract")) return "Out of contract";
  if (s.includes("rolling")) return "Rolling";
  return "In contract";
}

function deriveNbaTriggerLocal(input: {
  riskTier: RiskTier;
  contractStatus: "In contract" | "Out of contract" | "Rolling";
  signals: BehavioralSignals;
  package: string;
}): NbaTriggerKey {
  const { riskTier, contractStatus, signals, package: pkg } = input;
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
}

export function scoreCustomer(input: ScoringInput): ScoringResult {
  const base = 0.5;
  const c: SHAPContribution[] = [];

  // ── Base risk drivers ───────────────────────────────────────────────
  const oocImpact = Math.min(0.30, Math.max(-0.05, (input.oocDays / 600) * 0.30));
  c.push({
    feature: "ooc_days",
    label: "Days Out of Contract",
    impact: round3(oocImpact),
    detail:
      input.oocDays > 0
        ? `${input.oocDays} days since contract end.`
        : `${Math.abs(input.oocDays)} days remaining on contract.`,
  });

  const ddImpact = input.ddCancel60 > 0 ? 0.18 : -0.02;
  c.push({
    feature: "dd_cancel_60_day",
    label: "Recent DD Cancel (60d)",
    impact: round3(ddImpact),
    detail:
      input.ddCancel60 > 0
        ? "Direct Debit cancelled in the last 60 days."
        : "No recent DD failures.",
  });

  const ddLifeImpact = Math.min(0.12, input.contractDdCancels * 0.04);
  c.push({
    feature: "contract_dd_cancels",
    label: "DD Cancellations",
    impact: round3(ddLifeImpact),
    detail: `${input.contractDdCancels} DD cancellation(s) in account history.`,
  });

  const tenureImpact = -Math.min(0.32, (input.tenureDays / 4000) * 0.32);
  c.push({
    feature: "tenure_days",
    label: "Customer Tenure",
    impact: round3(tenureImpact),
    detail: `${(input.tenureDays / 365).toFixed(1)} years of tenure.`,
  });

  let speedDeficitPct = 0;
  if (input.soldSpeedMbps > 0 && input.lineSpeedMbps >= 0) {
    speedDeficitPct = (input.soldSpeedMbps - input.lineSpeedMbps) / input.soldSpeedMbps;
    if (speedDeficitPct > 0.1) {
      const sd = Math.min(0.16, speedDeficitPct * 0.2);
      c.push({
        feature: "speed_deficit",
        label: "Speed Deficit",
        impact: round3(sd),
        detail: `Receiving ${input.lineSpeedMbps.toFixed(1)} Mbps vs ${input.soldSpeedMbps} Mbps sold (${(speedDeficitPct * 100).toFixed(0)}% deficit).`,
      });
    }
  }

  // ── Enrichment bumps ────────────────────────────────────────────────
  const loyalty = input.loyaltyCalls90d ?? 0;
  if (loyalty > 0) {
    c.push({
      feature: "loyalty_calls",
      label: "Loyalty Calls",
      impact: round3(Math.min(0.22, loyalty * 0.07)),
      detail: `${loyalty} loyalty call(s) in last 90 days.`,
    });
  }

  const hold = input.totalHoldSeconds ?? 0;
  if (hold > 600) {
    c.push({
      feature: "total_hold_time",
      label: "Total Hold Time",
      impact: round3(Math.min(0.12, (hold / 3600) * 0.08)),
      detail: `${Math.round(hold / 60)} minutes on hold across recent calls.`,
    });
  }

  if (input.ceaseInsight === "CompetitorDeals") {
    c.push({
      feature: "cease_competitor",
      label: "Cease Pattern · Competitor",
      impact: 0.15,
      detail: "Profile matches historical Competitor Deals cease patterns.",
    });
  }

  const dl = input.monthlyDownloadGb ?? 0;
  if (dl > 800 && /Fibre 35|Fibre 65|ADSL|Essentials/i.test(input.package)) {
    c.push({
      feature: "usage_overflow",
      label: "Usage vs Package",
      impact: 0.08,
      detail: `${Math.round(dl)} GB/mo on a basic package — capacity-bound.`,
    });
  }

  // ── Score & tier ────────────────────────────────────────────────────
  let score = Math.max(0.02, Math.min(0.98, base + c.reduce((s, x) => s + x.impact, 0)));
  if (input.riskScoreOverride != null && Number.isFinite(input.riskScoreOverride)) {
    score = Math.max(0, Math.min(1, input.riskScoreOverride));
  }
  c.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  const riskTier = tierFromScore(score);
  const contractStatus = normaliseContract(input.contractStatusRaw);

  const signals: BehavioralSignals = {
    loyaltyCalls90d: loyalty,
    totalHoldSeconds: hold,
    totalTalkSeconds: input.totalTalkSeconds ?? 0,
    oocDays: input.oocDays,
    soldSpeedMbps: input.soldSpeedMbps,
    lineSpeedMbps: input.lineSpeedMbps,
    technology: input.technology ?? "",
    monthlyDownloadGb: dl,
    monthlyUploadGb: input.monthlyUploadGb ?? 0,
    ceaseInsight: input.ceaseInsight,
    preferredChannel: input.preferredChannel,
  };

  const triggerKey = deriveNbaTriggerLocal({ riskTier, contractStatus, signals, package: input.package });
  const trigger = NBA_TRIGGERS[triggerKey];

  // ── Narratives ──────────────────────────────────────────────────────
  const top = c.slice(0, 3);
  const driverPhrase = top.length
    ? top
        .map((x) => `${x.label.toLowerCase()} (${x.impact >= 0 ? "+" : ""}${(x.impact * 100).toFixed(0)} pts)`)
        .join(", ")
    : "no dominant signal";
  const whyThisCustomer =
    `${riskTier} risk (score ${(score * 100).toFixed(0)}/100). ` +
    `Strongest drivers: ${driverPhrase}. ` +
    (contractStatus === "Out of contract"
      ? `Currently out of contract for ${input.oocDays} days — free to switch on any given day.`
      : contractStatus === "Rolling"
        ? "On a rolling monthly contract — low switching friction."
        : `In contract with ${Math.abs(input.oocDays)} days left.`);

  const whyThisNba = (() => {
    switch (triggerKey) {
      case "loyalty_save_desk":
        return loyalty >= 2 || hold > 1800
          ? "Multiple loyalty calls / extended hold time signal active shopping — needs a specialist save agent with a pre-approved discount before they cancel."
          : "High-risk customer out of contract — proactive call with a loyalty discount converts at +18 ppt vs. control.";
      case "free_tech_upgrade":
        return `Sold ${input.soldSpeedMbps} Mbps but receiving ${input.lineSpeedMbps} Mbps (${(speedDeficitPct * 100).toFixed(0)}% deficit). Discounting masks the real problem — fix the line first.`;
      case "rightsize_email":
        return `Heavy usage (${Math.round(dl)} GB/mo) on a basic package — they will keep hitting throttling. An automated upgrade email converts at +9 ppt.`;
      case "competitor_match":
        return "Cease intent matches historical Competitor Deals patterns — price is the primary lever, route the highest-tier price-match offer through their preferred channel.";
      case "suppress":
        return "Long-tenure low-risk customer. Outbound contact erodes satisfaction here — hold in nurture sequences only.";
      case "nurture":
      default:
        return "Mid-risk profile without a single dominant trigger. Send a personalised retention email with usage insights to keep the relationship warm.";
    }
  })();

  return {
    customer: {
      id: input.id,
      name: input.name ?? `Customer ${input.id.slice(0, 6)}`,
      package: input.package,
      tenureDays: input.tenureDays,
      contractStatus,
    },
    riskScore: round3(score),
    riskTier,
    baseScore: base,
    shap: c,
    nba: {
      trigger: triggerKey,
      label: trigger.label,
      description: trigger.description,
      channel: trigger.channel,
      offer: trigger.offer,
    },
    signals,
    whyThisCustomer,
    whyThisNba,
    speedDeficitPct: round3(speedDeficitPct),
  };
}
