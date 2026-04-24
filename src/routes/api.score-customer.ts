// POST /api/score-customer
//
// Body: { "customer_id": "..." }
//
// Resolves a customer id from one of:
//   1. Live ML output  — public.top_customers (pre-scored by external trainer)
//   2. Live snapshots  — datasets/{azure|gdrive}/{connId}/{customer_info|calls|cease|usage}.json
//      (written by the pull workers, also feeds the in-app Active Data store)
//   3. In-app personas / generated customers  — src/data/customers.ts
//
// Then runs the same scoreCustomer() the UI uses, so the API tester output
// is byte-for-byte identical to what Lovable would render for that customer.

import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { scoreCustomer, type ScoringInput, type ScoringResult } from "@/data/scoring";
import { allCustomers } from "@/data/customers";
import type { BehavioralSignals } from "@/data/customers";

type RawRow = Record<string, unknown>;
type LiveSnapshot = { headers?: string[]; rows?: unknown[][] | RawRow[]; total_rows?: number };

const ID_COL = "unique_customer_identifier";

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function rowsToObjects(snap: LiveSnapshot): RawRow[] {
  const rows = snap.rows ?? [];
  if (rows.length === 0) return [];
  // Already an array of objects?
  if (!Array.isArray(rows[0])) return rows as RawRow[];
  const headers = snap.headers ?? [];
  return (rows as unknown[][]).map((arr) => {
    const o: RawRow = {};
    headers.forEach((h, i) => { o[h] = arr[i]; });
    return o;
  });
}

async function downloadSnapshot(path: string): Promise<RawRow[] | null> {
  try {
    const { data } = await supabaseAdmin.storage.from("datasets").download(path);
    if (!data) return null;
    const text = await data.text();
    const snap = JSON.parse(text) as LiveSnapshot;
    return rowsToObjects(snap);
  } catch {
    return null;
  }
}

function findRowById(rows: RawRow[] | null, id: string): RawRow | null {
  if (!rows) return null;
  const lower = id.toLowerCase();
  // Latest-wins by datevalue (mirrors mapCustomers)
  let best: RawRow | null = null;
  let bestDate = "";
  for (const r of rows) {
    const v = str(r[ID_COL]);
    if (!v) continue;
    if (v.toLowerCase() !== lower) continue;
    const d = str(r["datevalue"] ?? r["calendar_date"] ?? r["event_date"]);
    if (!best || d > bestDate) { best = r; bestDate = d; }
  }
  return best;
}

function aggregateCallsForId(rows: RawRow[] | null, id: string) {
  if (!rows) return null;
  const lower = id.toLowerCase();
  let totalHold = 0, totalTalk = 0, loyalty = 0;
  let maxDate = "";
  const filtered: RawRow[] = [];
  for (const r of rows) {
    if (str(r[ID_COL]).toLowerCase() !== lower) continue;
    filtered.push(r);
    const d = str(r["event_date"]);
    if (d > maxDate) maxDate = d;
  }
  if (filtered.length === 0) return null;
  const cutoff = maxDate ? new Date(maxDate) : null;
  if (cutoff) cutoff.setDate(cutoff.getDate() - 90);
  const cutoffIso = cutoff ? cutoff.toISOString().slice(0, 10) : "";
  for (const r of filtered) {
    totalHold += num(r["hold_time_seconds"]);
    totalTalk += num(r["talk_time_seconds"]);
    const callType = str(r["call_type_key"] || r["call_type"]).toLowerCase();
    if (callType.includes("loyalty") && (!cutoffIso || str(r["event_date"]) >= cutoffIso)) {
      loyalty += 1;
    }
  }
  return { totalHoldSeconds: totalHold, totalTalkSeconds: totalTalk, loyaltyCalls90d: loyalty };
}

function ceaseInsightForId(rows: RawRow[] | null, id: string): BehavioralSignals["ceaseInsight"] | undefined {
  if (!rows) return undefined;
  const lower = id.toLowerCase();
  for (const r of rows) {
    if (str(r[ID_COL]).toLowerCase() !== lower) continue;
    const ins = str(r["reason_description_insight"]);
    if (ins) return ins as BehavioralSignals["ceaseInsight"];
  }
  return undefined;
}

function aggregateUsageForId(rows: RawRow[] | null, id: string) {
  if (!rows) return null;
  const lower = id.toLowerCase();
  let dl = 0, ul = 0, n = 0;
  for (const r of rows) {
    if (str(r[ID_COL]).toLowerCase() !== lower) continue;
    dl += num(r["usage_download_mbs"]);
    ul += num(r["usage_upload_mbs"]);
    n += 1;
  }
  if (n === 0) return null;
  return {
    monthlyDownloadGb: Math.round((dl / n) * 30 / 1024),
    monthlyUploadGb: Math.round((ul / n) * 30 / 1024),
  };
}

type Source = "top_customers" | "live_snapshots" | "in_app_sample" | "not_found";

async function resolveLive(id: string): Promise<{ ci: RawRow; calls: RawRow[] | null; cease: RawRow[] | null; usage: RawRow[] | null; sourceLabel: string } | null> {
  const { data: sources } = await supabaseAdmin
    .from("active_data_sources")
    .select("kind, origin, connection_id, label, remote_name")
    .in("kind", ["customer_info", "calls", "cease", "usage"]);
  if (!sources || sources.length === 0) return null;

  const pathFor = (s: { connection_id: string | null; kind: string }) => {
    // Both workers use {kind_prefix}/{connId}/{kind}.json — try both.
    if (!s.connection_id) return [];
    return [
      `azure/${s.connection_id}/${s.kind}.json`,
      `gdrive/${s.connection_id}/${s.kind}.json`,
    ];
  };

  async function fetchKind(kind: string): Promise<{ rows: RawRow[]; label: string } | null> {
    const row = sources!.find((r) => r.kind === kind);
    if (!row) return null;
    for (const p of pathFor(row)) {
      const rows = await downloadSnapshot(p);
      if (rows && rows.length) return { rows, label: row.label ?? row.remote_name ?? p };
    }
    return null;
  }

  const ci = await fetchKind("customer_info");
  if (!ci) return null;
  const ciRow = findRowById(ci.rows, id);
  if (!ciRow) return null;
  const calls = await fetchKind("calls");
  const cease = await fetchKind("cease");
  const usage = await fetchKind("usage");
  return {
    ci: ciRow,
    calls: calls?.rows ?? null,
    cease: cease?.rows ?? null,
    usage: usage?.rows ?? null,
    sourceLabel: ci.label,
  };
}

function buildInputFromLive(id: string, ci: RawRow, calls: RawRow[] | null, cease: RawRow[] | null, usage: RawRow[] | null): ScoringInput {
  const callsAgg = aggregateCallsForId(calls, id);
  const usageAgg = aggregateUsageForId(usage, id);
  const ceaseInsight = ceaseInsightForId(cease, id);
  return {
    id,
    package: str(ci["crm_package_name"]) || "Unknown package",
    tenureDays: num(ci["tenure_days"]),
    contractStatusRaw: str(ci["contract_status"]),
    oocDays: num(ci["ooc_days"]),
    ddCancel60: num(ci["dd_cancel_60_day"]),
    contractDdCancels: num(ci["contract_dd_cancels"]),
    soldSpeedMbps: num(ci["speed"]),
    lineSpeedMbps: num(ci["line_speed"]),
    technology: str(ci["technology"]),
    loyaltyCalls90d: callsAgg?.loyaltyCalls90d,
    totalHoldSeconds: callsAgg?.totalHoldSeconds,
    totalTalkSeconds: callsAgg?.totalTalkSeconds,
    monthlyDownloadGb: usageAgg?.monthlyDownloadGb,
    monthlyUploadGb: usageAgg?.monthlyUploadGb,
    ceaseInsight,
  };
}

function buildInputFromSample(id: string): ScoringInput | null {
  // Match by exact id, by short tail (TT-XXXXXX), or by raw uuid prefix.
  const lower = id.toLowerCase();
  const c = allCustomers.find(
    (x) => x.id.toLowerCase() === lower || x.id.toLowerCase().endsWith(lower) || lower.endsWith(x.id.replace(/^TT-/i, "").toLowerCase()),
  );
  if (!c) return null;
  const s = c.signals;
  return {
    id: c.id,
    name: c.name,
    package: c.package,
    tenureDays: c.tenureDays,
    contractStatusRaw: c.contractStatus,
    oocDays: s?.oocDays ?? 0,
    ddCancel60: 0,
    contractDdCancels: 0,
    soldSpeedMbps: s?.soldSpeedMbps ?? 0,
    lineSpeedMbps: s?.lineSpeedMbps ?? 0,
    technology: s?.technology,
    loyaltyCalls90d: s?.loyaltyCalls90d,
    totalHoldSeconds: s?.totalHoldSeconds,
    totalTalkSeconds: s?.totalTalkSeconds,
    monthlyDownloadGb: s?.monthlyDownloadGb,
    monthlyUploadGb: s?.monthlyUploadGb,
    ceaseInsight: s?.ceaseInsight,
    preferredChannel: s?.preferredChannel,
  };
}

export const Route = createFileRoute("/api/score-customer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { customer_id?: string } = {};
        try { body = await request.json(); } catch { /* empty */ }
        const id = (body.customer_id ?? "").trim();
        if (!id) return jsonError(400, "customer_id is required");

        let source: Source = "not_found";
        let sourceDetail = "";
        let result: ScoringResult | null = null;
        let input: ScoringInput | null = null;

        // 1) Pre-scored live ML output
        const { data: tc } = await supabaseAdmin
          .from("top_customers")
          .select("customer_id, churn_prob, recommended_nba, reason_codes, features, rank")
          .eq("customer_id", id)
          .order("rank", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (tc?.features && typeof tc.features === "object") {
          const f = tc.features as Record<string, unknown>;
          input = {
            id,
            package: str(f["crm_package_name"]) || "Unknown package",
            tenureDays: num(f["tenure_days"]),
            contractStatusRaw: str(f["contract_status"]),
            oocDays: num(f["ooc_days"]),
            ddCancel60: num(f["dd_cancel_60_day"]),
            contractDdCancels: num(f["contract_dd_cancels"]),
            soldSpeedMbps: num(f["speed"]),
            lineSpeedMbps: num(f["line_speed"] ?? f["avg_download_mbs"]),
            technology: str(f["technology"]),
            loyaltyCalls90d: num(f["loyalty_calls_90d"]),
            totalHoldSeconds: num(f["avg_hold_seconds"]) * 10, // approx — rebuild bumps consistently
            totalTalkSeconds: num(f["avg_talk_seconds"]) * 10,
            monthlyDownloadGb: num(f["avg_download_mbs"]),
            monthlyUploadGb: num(f["avg_upload_mbs"]),
            riskScoreOverride: tc.churn_prob != null ? Number(tc.churn_prob) : null,
          };
          source = "top_customers";
          sourceDetail = `public.top_customers · rank #${tc.rank ?? "?"}`;
        }

        // 2) Live snapshots from active_data_sources
        if (!input) {
          const live = await resolveLive(id);
          if (live) {
            input = buildInputFromLive(id, live.ci, live.calls, live.cease, live.usage);
            source = "live_snapshots";
            sourceDetail = `Live integration · ${live.sourceLabel}`;
          }
        }

        // 3) In-app sample
        if (!input) {
          const sample = buildInputFromSample(id);
          if (sample) {
            input = sample;
            source = "in_app_sample";
            sourceDetail = "In-app personas / generated customers";
          }
        }

        if (!input) {
          return jsonOk(
            {
              ok: false,
              source: "not_found",
              error: `Customer "${id}" was not found in top_customers, live snapshots, or sample personas.`,
              hint: "Try a sample id like TT-2048771 or pull live data first.",
            },
            404,
          );
        }

        result = scoreCustomer(input);
        return jsonOk({
          ok: true,
          source,
          source_detail: sourceDetail,
          input,
          result,
        });
      },
    },
  },
});
