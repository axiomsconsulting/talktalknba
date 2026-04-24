// Maps raw customer_info schema rows into the Customer shape used by the
// Explainability page (search + SHAP waterfall).
//
// Schema (customer_info.parquet → CSV):
//   unique_customer_identifier, datevalue, contract_status, contract_dd_cancels,
//   dd_cancel_60_day, ooc_days, technology, speed, line_speed, sales_channel,
//   crm_package_name, tenure_days

import type { BehavioralSignals, Customer, SHAPContribution } from "./customers";
import { deriveNbaTrigger } from "./customers";
import type { RiskTier } from "./nba";

export type RawCustomerRow = Record<string, string | number | null | undefined>;

export type FieldMapping = {
  id: string;
  package: string;
  tenureDays: string;
  contractStatus: string;
  oocDays: string;
  ddCancel60: string;
  contractDdCancels: string;
  speed: string;
  lineSpeed: string;
  technology: string;
  arpuOverride?: string; // optional column to use as ARPU
  riskScoreOverride?: string; // optional pre-computed risk score column
};

export const DEFAULT_MAPPING: FieldMapping = {
  id: "unique_customer_identifier",
  package: "crm_package_name",
  tenureDays: "tenure_days",
  contractStatus: "contract_status",
  oocDays: "ooc_days",
  ddCancel60: "dd_cancel_60_day",
  contractDdCancels: "contract_dd_cancels",
  speed: "speed",
  lineSpeed: "line_speed",
  technology: "technology",
};

// Heuristic ARPU by package — derived from typical TalkTalk price points.
const PACKAGE_ARPU: Array<{ match: RegExp; arpu: number }> = [
  { match: /full fibre 9|g\.?fast/i, arpu: 50 },
  { match: /fibre 500/i, arpu: 47 },
  { match: /fibre 150|fttp/i, arpu: 42 },
  { match: /fibre 65|faster fibre/i, arpu: 35 },
  { match: /fibre 35/i, arpu: 30 },
  { match: /fast broadband|essentials|adsl/i, arpu: 25 },
];

function packageArpu(pkg: string): number {
  for (const p of PACKAGE_ARPU) if (p.match.test(pkg)) return p.arpu;
  return 32;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function tierFromScore(score: number): RiskTier {
  if (score >= 0.65) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

function normaliseContract(raw: string): Customer["contractStatus"] {
  const s = raw.toLowerCase();
  if (s.includes("ooc")) return "Out of contract";
  if (s.includes("rolling")) return "Rolling";
  return "In contract";
}

// Compute a heuristic risk score 0..1 from the available signals.
// Calibrated against the trained model's segment-level stats:
//   - oocDays is the strongest single live signal alongside tenure
//   - dd_cancel_60_day flips score sharply
//   - tenure_days reduces risk
//   - speed deficit (sold vs delivered) lifts risk
export function computeRiskScore(row: {
  oocDays: number;
  ddCancel60: number;
  ddCancels: number;
  tenureDays: number;
  speed: number;
  lineSpeed: number;
  contractStatus: string;
}): { score: number; contributions: SHAPContribution[] } {
  // Base population rate
  const base = 0.5;

  const c: SHAPContribution[] = [];

  // Out-of-contract days — saturating curve to +0.30
  const oocImpact = Math.min(0.30, Math.max(-0.05, (row.oocDays / 600) * 0.30));
  c.push({
    feature: "ooc_days",
    label: "Days Out of Contract",
    impact: Number(oocImpact.toFixed(3)),
    detail:
      row.oocDays > 0
        ? `${row.oocDays} days since contract end.`
        : `${Math.abs(row.oocDays)} days remaining on contract.`,
  });

  // Recent DD cancel — binary +0.18
  const ddImpact = row.ddCancel60 > 0 ? 0.18 : -0.02;
  c.push({
    feature: "dd_cancel_60_day",
    label: "Recent DD Cancel (60d)",
    impact: Number(ddImpact.toFixed(3)),
    detail:
      row.ddCancel60 > 0
        ? "Direct Debit cancelled in the last 60 days."
        : "No recent DD failures.",
  });

  // Lifetime DD cancellations — up to +0.12
  const ddLifeImpact = Math.min(0.12, row.ddCancels * 0.04);
  c.push({
    feature: "contract_dd_cancels",
    label: "DD Cancellations",
    impact: Number(ddLifeImpact.toFixed(3)),
    detail: `${row.ddCancels} DD cancellation(s) in account history.`,
  });

  // Tenure — strong negative pull, up to -0.32
  const tenureImpact = -Math.min(0.32, (row.tenureDays / 4000) * 0.32);
  c.push({
    feature: "tenure_days",
    label: "Customer Tenure",
    impact: Number(tenureImpact.toFixed(3)),
    detail: `${(row.tenureDays / 365).toFixed(1)} years of tenure.`,
  });

  // Speed deficit — when sold > delivered, lifts risk
  if (row.speed > 0 && row.lineSpeed >= 0) {
    const deficit = (row.speed - row.lineSpeed) / row.speed;
    if (deficit > 0.1) {
      const sd = Math.min(0.16, deficit * 0.2);
      c.push({
        feature: "speed_deficit",
        label: "Speed Deficit",
        impact: Number(sd.toFixed(3)),
        detail: `Receiving ${row.lineSpeed.toFixed(1)} Mbps vs ${row.speed} Mbps sold (${(deficit * 100).toFixed(0)}% deficit).`,
      });
    }
  }

  const score = Math.max(0.02, Math.min(0.98, base + c.reduce((s, x) => s + x.impact, 0)));
  c.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return { score, contributions: c };
}

const REGION_POOL = [
  "Greater London",
  "North West",
  "West Midlands",
  "Yorkshire & Humber",
  "South East",
  "Scotland",
  "Wales",
  "East of England",
];

// Optional enrichment: aggregated signals keyed by raw customer id.
export type CallEnrichment = {
  loyaltyCalls90d: number;
  totalHoldSeconds: number;
  totalTalkSeconds: number;
  preferredChannel?: string;
};
export type CeaseEnrichment = {
  insight: BehavioralSignals["ceaseInsight"];
};
export type UsageEnrichment = {
  monthlyDownloadGb: number;
  monthlyUploadGb: number;
};

export type EnrichmentMaps = {
  calls?: Map<string, CallEnrichment>;
  cease?: Map<string, CeaseEnrichment>;
  usage?: Map<string, UsageEnrichment>;
};

export function mapCustomers(
  rows: RawCustomerRow[],
  mapping: FieldMapping = DEFAULT_MAPPING,
  enrichment: EnrichmentMaps = {}
): Customer[] {
  // De-duplicate by id (a single customer can have many monthly rows; keep the latest)
  const latest = new Map<string, RawCustomerRow>();
  for (const r of rows) {
    const id = str(r[mapping.id]);
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev) {
      latest.set(id, r);
      continue;
    }
    const a = String(r["datevalue"] ?? "");
    const b = String(prev["datevalue"] ?? "");
    if (a > b) latest.set(id, r);
  }

  const out: Customer[] = [];
  let i = 0;
  for (const [rawId, row] of latest) {
    const tenureDays = num(row[mapping.tenureDays]);
    const oocDays = num(row[mapping.oocDays]);
    const ddCancel60 = num(row[mapping.ddCancel60]);
    const ddCancels = num(row[mapping.contractDdCancels]);
    const speed = num(row[mapping.speed]);
    const lineSpeed = num(row[mapping.lineSpeed]);
    const contractRaw = str(row[mapping.contractStatus]);
    const pkg = str(row[mapping.package]) || "Unknown package";
    const technology = str(row[mapping.technology]);

    const callsRow = enrichment.calls?.get(rawId);
    const ceaseRow = enrichment.cease?.get(rawId);
    const usageRow = enrichment.usage?.get(rawId);

    let score: number;
    let contributions: SHAPContribution[];
    const baseRisk = computeRiskScore({
      oocDays,
      ddCancel60,
      ddCancels,
      tenureDays,
      speed,
      lineSpeed,
      contractStatus: contractRaw,
    });
    contributions = baseRisk.contributions;
    score = baseRisk.score;

    // Enrichment SHAP contributions
    if (callsRow && callsRow.loyaltyCalls90d > 0) {
      const impact = Math.min(0.22, callsRow.loyaltyCalls90d * 0.07);
      contributions.push({
        feature: "loyalty_calls",
        label: "Loyalty Calls",
        impact: Number(impact.toFixed(3)),
        detail: `${callsRow.loyaltyCalls90d} loyalty call(s) in last 90 days.`,
      });
      score = Math.min(0.98, score + impact);
    }
    if (callsRow && callsRow.totalHoldSeconds > 600) {
      const impact = Math.min(0.12, (callsRow.totalHoldSeconds / 3600) * 0.08);
      contributions.push({
        feature: "total_hold_time",
        label: "Total Hold Time",
        impact: Number(impact.toFixed(3)),
        detail: `${Math.round(callsRow.totalHoldSeconds / 60)} minutes on hold across recent calls.`,
      });
      score = Math.min(0.98, score + impact);
    }
    if (ceaseRow?.insight === "CompetitorDeals") {
      const impact = 0.15;
      contributions.push({
        feature: "cease_competitor",
        label: "Cease Pattern · Competitor",
        impact,
        detail: "Profile matches historical Competitor Deals cease patterns.",
      });
      score = Math.min(0.98, score + impact);
    }
    if (usageRow && usageRow.monthlyDownloadGb > 800 && /Fibre 35|Fibre 65|ADSL|Essentials/i.test(pkg)) {
      const impact = 0.08;
      contributions.push({
        feature: "usage_overflow",
        label: "Usage vs Package",
        impact,
        detail: `${Math.round(usageRow.monthlyDownloadGb)} GB/mo on a basic package — capacity-bound.`,
      });
      score = Math.min(0.98, score + impact);
    }
    contributions.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

    if (mapping.riskScoreOverride && row[mapping.riskScoreOverride] != null) {
      score = Math.max(0, Math.min(1, num(row[mapping.riskScoreOverride])));
    }

    const arpuMonthly = mapping.arpuOverride && row[mapping.arpuOverride] != null
      ? num(row[mapping.arpuOverride])
      : packageArpu(pkg);

    const signals: BehavioralSignals = {
      loyaltyCalls90d: callsRow?.loyaltyCalls90d ?? 0,
      totalHoldSeconds: callsRow?.totalHoldSeconds ?? 0,
      totalTalkSeconds: callsRow?.totalTalkSeconds ?? 0,
      oocDays,
      soldSpeedMbps: speed,
      lineSpeedMbps: lineSpeed,
      technology,
      monthlyDownloadGb: usageRow?.monthlyDownloadGb ?? 0,
      monthlyUploadGb: usageRow?.monthlyUploadGb ?? 0,
      ceaseInsight: ceaseRow?.insight,
      preferredChannel: callsRow?.preferredChannel,
    };

    const contractStatus = normaliseContract(contractRaw);
    const riskTier = tierFromScore(score);

    out.push({
      id: `TT-${rawId.slice(0, 8).toUpperCase()}`,
      name: `Customer ${rawId.slice(0, 6).toUpperCase()}`,
      tenureDays,
      package: pkg,
      riskScore: Number(score.toFixed(3)),
      riskTier,
      monthlyArpu: arpuMonthly,
      contractStatus,
      region: REGION_POOL[i % REGION_POOL.length],
      shap: contributions,
      persona: technology ? `${technology} · ${pkg}` : undefined,
      signals,
      nbaTrigger: deriveNbaTrigger({ riskTier, contractStatus, signals, package: pkg }),
    });
    i += 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregators for the calls / cease / usage extracts.
// These reduce per-event rows to one record per customer keyed by raw id.
// ─────────────────────────────────────────────────────────────────────────────

export function aggregateCalls(rows: RawCustomerRow[]): Map<string, CallEnrichment> {
  const out = new Map<string, CallEnrichment>();
  // Treat anything within ~90 days of the most recent event as "recent"
  let maxDate = "";
  for (const r of rows) {
    const d = str(r["event_date"]);
    if (d > maxDate) maxDate = d;
  }
  const cutoff = maxDate ? new Date(maxDate) : null;
  if (cutoff) cutoff.setDate(cutoff.getDate() - 90);
  const cutoffIso = cutoff ? cutoff.toISOString().slice(0, 10) : "";

  // Track most-frequent call type per customer to infer preferred channel
  const channelCounts = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const id = str(r["unique_customer_identifier"]);
    if (!id) continue;
    const callType = str(r["call_type_key"] || r["call_type"]);
    const eventDate = str(r["event_date"]);
    const talk = num(r["talk_time_seconds"]);
    const hold = num(r["hold_time_seconds"]);

    const cur = out.get(id) ?? { loyaltyCalls90d: 0, totalHoldSeconds: 0, totalTalkSeconds: 0 };
    cur.totalHoldSeconds += hold;
    cur.totalTalkSeconds += talk;
    if (callType.toLowerCase().includes("loyalty") && (!cutoffIso || eventDate >= cutoffIso)) {
      cur.loyaltyCalls90d += 1;
    }
    out.set(id, cur);

    const cm = channelCounts.get(id) ?? new Map<string, number>();
    cm.set(callType, (cm.get(callType) ?? 0) + 1);
    channelCounts.set(id, cm);
  }

  for (const [id, counts] of channelCounts) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const cur = out.get(id);
      if (cur) cur.preferredChannel = top[0] === "Loyalty" ? "Outbound Call" : top[0];
    }
  }

  return out;
}

export function aggregateCease(rows: RawCustomerRow[]): Map<string, CeaseEnrichment> {
  const out = new Map<string, CeaseEnrichment>();
  for (const r of rows) {
    const id = str(r["unique_customer_identifier"]);
    if (!id) continue;
    const insight = str(r["reason_description_insight"]) as BehavioralSignals["ceaseInsight"];
    if (insight) out.set(id, { insight });
  }
  return out;
}

export function aggregateUsage(rows: RawCustomerRow[]): Map<string, UsageEnrichment> {
  const out = new Map<string, { dl: number; ul: number; n: number }>();
  for (const r of rows) {
    const id = str(r["unique_customer_identifier"]);
    if (!id) continue;
    const dl = num(r["usage_download_mbs"]);
    const ul = num(r["usage_upload_mbs"]);
    const cur = out.get(id) ?? { dl: 0, ul: 0, n: 0 };
    cur.dl += dl;
    cur.ul += ul;
    cur.n += 1;
    out.set(id, cur);
  }
  // mbs is per-day reading; sum/30 ≈ monthly average. Convert to GB (÷ 1024).
  const result = new Map<string, UsageEnrichment>();
  for (const [id, v] of out) {
    const monthlyDownloadGb = (v.dl / Math.max(1, v.n)) * 30 / 1024;
    const monthlyUploadGb = (v.ul / Math.max(1, v.n)) * 30 / 1024;
    result.set(id, {
      monthlyDownloadGb: Math.round(monthlyDownloadGb),
      monthlyUploadGb: Math.round(monthlyUploadGb),
    });
  }
  return result;
}

// Detect available column names from a parsed sample row to pre-fill the mapping UI.
export function detectColumns(sample: RawCustomerRow): string[] {
  return Object.keys(sample);
}
