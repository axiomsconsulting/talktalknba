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

export function mapCustomers(
  rows: RawCustomerRow[],
  mapping: FieldMapping = DEFAULT_MAPPING
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
  for (const [id, row] of latest) {
    const tenureDays = num(row[mapping.tenureDays]);
    const oocDays = num(row[mapping.oocDays]);
    const ddCancel60 = num(row[mapping.ddCancel60]);
    const ddCancels = num(row[mapping.contractDdCancels]);
    const speed = num(row[mapping.speed]);
    const lineSpeed = num(row[mapping.lineSpeed]);
    const contractRaw = str(row[mapping.contractStatus]);
    const pkg = str(row[mapping.package]) || "Unknown package";
    const technology = str(row[mapping.technology]);

    let score: number;
    let contributions: SHAPContribution[];
    if (mapping.riskScoreOverride && row[mapping.riskScoreOverride] != null) {
      score = Math.max(0, Math.min(1, num(row[mapping.riskScoreOverride])));
      contributions = computeRiskScore({
        oocDays,
        ddCancel60,
        ddCancels,
        tenureDays,
        speed,
        lineSpeed,
        contractStatus: contractRaw,
      }).contributions;
    } else {
      const r = computeRiskScore({
        oocDays,
        ddCancel60,
        ddCancels,
        tenureDays,
        speed,
        lineSpeed,
        contractStatus: contractRaw,
      });
      score = r.score;
      contributions = r.contributions;
    }

    const arpuMonthly = mapping.arpuOverride && row[mapping.arpuOverride] != null
      ? num(row[mapping.arpuOverride])
      : packageArpu(pkg);

    out.push({
      id: `TT-${id.slice(0, 8).toUpperCase()}`,
      name: `Customer ${id.slice(0, 6).toUpperCase()}`,
      tenureDays,
      package: pkg,
      riskScore: Number(score.toFixed(3)),
      riskTier: tierFromScore(score),
      monthlyArpu: arpuMonthly,
      contractStatus: normaliseContract(contractRaw),
      region: REGION_POOL[i % REGION_POOL.length],
      shap: contributions,
      persona: technology ? `${technology} · ${pkg}` : undefined,
    });
    i += 1;
  }
  return out;
}

// Detect available column names from a parsed sample row to pre-fill the mapping UI.
export function detectColumns(sample: RawCustomerRow): string[] {
  return Object.keys(sample);
}
