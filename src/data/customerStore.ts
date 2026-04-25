// In-memory store for parsed customer datasets, swappable from the upload page.
// Hydrates from the `active_data_sources` table on boot so the active selection
// survives reloads and follows the workspace, not the browser tab.
//
// Each "active" source carries an `origin` flag — "upload" (file in the dataset
// library) or "live" (live integration like Azure DevOps / Databricks / Drive).
// The UI uses this to label the Active Source banner & Behavioural Enrichment
// panel correctly.

import { create } from "zustand";
import { allCustomers as defaultCustomers, type Customer, deriveNbaTrigger } from "./customers";
import type {
  CallEnrichment,
  CeaseEnrichment,
  UsageEnrichment,
} from "./customerMapping";
import { supabase } from "@/integrations/supabase/client";

export type SourceOrigin = "upload" | "live";

export type EnrichmentSource = {
  filename: string;
  rowsAggregated: number;
  uploadedAt: string;
  origin: SourceOrigin;
  /** Human-readable source detail e.g. "Azure DevOps · cease.csv" */
  detail?: string;
};

export type CustomerSource =
  | { kind: "mock" }
  | {
      kind: "uploaded";
      filename: string;
      uploadedAt: string;
      origin: SourceOrigin;
      detail?: string;
    };

type PersistArgs = {
  kind: "customer_info" | "calls" | "cease" | "usage";
  origin: SourceOrigin;
  label: string;
  rows: number;
  datasetId?: string | null;
  connectionId?: string | null;
  remoteName?: string | null;
};

type CustomerStore = {
  hydrated: boolean;
  customers: Customer[];
  source: CustomerSource;
  callsMap: Map<string, CallEnrichment>;
  ceaseMap: Map<string, CeaseEnrichment>;
  usageMap: Map<string, UsageEnrichment>;
  callsSource: EnrichmentSource | null;
  ceaseSource: EnrichmentSource | null;
  usageSource: EnrichmentSource | null;

  hydrate: () => Promise<void>;

  setActive: (customers: Customer[], filename: string, origin?: SourceOrigin, detail?: string) => void;
  reset: () => void;

  applyCalls: (m: Map<string, CallEnrichment>, src: EnrichmentSource) => void;
  applyCease: (m: Map<string, CeaseEnrichment>, src: EnrichmentSource) => void;
  applyUsage: (m: Map<string, UsageEnrichment>, src: EnrichmentSource) => void;
  clearEnrichment: (which: "calls" | "cease" | "usage") => void;

  /** Persists the active selection to DB (idempotent, admin-only). */
  persistActive: (args: PersistArgs) => Promise<void>;

  /**
   * Wipes every active "upload"-origin selection (customer_info + enrichments)
   * from the in-memory store *and* the active_data_sources table, restoring
   * the bundled sample dataset. Used when the dataset library is emptied.
   */
  clearAllUploads: () => Promise<void>;
};

function enrichCustomers(
  base: Customer[],
  callsMap: Map<string, CallEnrichment>,
  ceaseMap: Map<string, CeaseEnrichment>,
  usageMap: Map<string, UsageEnrichment>,
): Customer[] {
  if (callsMap.size === 0 && ceaseMap.size === 0 && usageMap.size === 0) return base;

  return base.map((c) => {
    const cid = c.id.toLowerCase();
    const idTail = cid.replace(/^tt-/, "");
    const findKey = (m: Map<string, unknown>): unknown => {
      // Direct hit (full unique_customer_identifier match) — fast path for uploaded data
      const direct = m.get(c.id) ?? m.get(cid);
      if (direct) return direct;
      for (const [k, v] of m) {
        const lk = k.toLowerCase();
        if (lk === cid || lk.startsWith(idTail) || idTail.startsWith(lk.slice(0, 6))) {
          return v;
        }
      }
      return undefined;
    };
    const callsRow = findKey(callsMap) as CallEnrichment | undefined;
    const ceaseRow = findKey(ceaseMap) as CeaseEnrichment | undefined;
    const usageRow = findKey(usageMap) as UsageEnrichment | undefined;

    if (!callsRow && !ceaseRow && !usageRow) return c;

    const signals = {
      ...(c.signals ?? {
        loyaltyCalls90d: 0,
        totalHoldSeconds: 0,
        totalTalkSeconds: 0,
        oocDays: 0,
        soldSpeedMbps: 0,
        lineSpeedMbps: 0,
        technology: "",
        monthlyDownloadGb: 0,
        monthlyUploadGb: 0,
      }),
      ...(callsRow && {
        loyaltyCalls90d: callsRow.loyaltyCalls90d,
        totalHoldSeconds: callsRow.totalHoldSeconds,
        totalTalkSeconds: callsRow.totalTalkSeconds,
        preferredChannel: callsRow.preferredChannel,
      }),
      ...(usageRow && {
        monthlyDownloadGb: usageRow.monthlyDownloadGb,
        monthlyUploadGb: usageRow.monthlyUploadGb,
      }),
      ...(ceaseRow && { ceaseInsight: ceaseRow.insight }),
    };

    let riskScore = c.riskScore;
    const newShap = [...c.shap];
    if (callsRow && callsRow.loyaltyCalls90d > 0) {
      const impact = Math.min(0.22, callsRow.loyaltyCalls90d * 0.07);
      newShap.unshift({
        feature: "loyalty_calls",
        label: "Loyalty Calls",
        impact: Number(impact.toFixed(3)),
        detail: `${callsRow.loyaltyCalls90d} loyalty call(s) in last 90 days.`,
      });
      riskScore = Math.min(0.98, riskScore + impact);
    }
    if (callsRow && callsRow.totalHoldSeconds > 600) {
      const impact = Math.min(0.12, (callsRow.totalHoldSeconds / 3600) * 0.08);
      newShap.unshift({
        feature: "total_hold_time",
        label: "Total Hold Time",
        impact: Number(impact.toFixed(3)),
        detail: `${Math.round(callsRow.totalHoldSeconds / 60)} minutes on hold across recent calls.`,
      });
      riskScore = Math.min(0.98, riskScore + impact);
    }
    if (ceaseRow?.insight === "CompetitorDeals") {
      newShap.unshift({
        feature: "cease_competitor",
        label: "Cease Pattern · Competitor",
        impact: 0.15,
        detail: "Profile matches historical Competitor Deals cease patterns.",
      });
      riskScore = Math.min(0.98, riskScore + 0.15);
    }
    if (usageRow && usageRow.monthlyDownloadGb > 800 && /Fibre 35|Fibre 65|ADSL|Essentials/i.test(c.package)) {
      newShap.unshift({
        feature: "usage_overflow",
        label: "Usage vs Package",
        impact: 0.08,
        detail: `${Math.round(usageRow.monthlyDownloadGb)} GB/mo on a basic package — capacity-bound.`,
      });
      riskScore = Math.min(0.98, riskScore + 0.08);
    }

    const nbaTrigger = deriveNbaTrigger({
      riskTier: c.riskTier,
      contractStatus: c.contractStatus,
      signals,
      package: c.package,
    });

    return {
      ...c,
      signals,
      riskScore: Number(riskScore.toFixed(3)),
      shap: dedupeShap(newShap),
      nbaTrigger,
    };
  });
}

function dedupeShap<T extends { feature: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x.feature)) continue;
    seen.add(x.feature);
    out.push(x);
  }
  return out;
}

export const useCustomerStore = create<CustomerStore>((set, get) => ({
  hydrated: false,
  customers: defaultCustomers,
  source: { kind: "mock" },
  callsMap: new Map(),
  ceaseMap: new Map(),
  usageMap: new Map(),
  callsSource: null,
  ceaseSource: null,
  usageSource: null,

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    try {
      const { data, error } = await supabase
        .from("active_data_sources")
        .select("kind, origin, label, rows_count, dataset_id, connection_id, remote_name");
      if (error) throw error;
      if (!data || data.length === 0) return;

      const ci = data.find((r) => r.kind === "customer_info");
      if (ci) {
        const detail =
          ci.origin === "live"
            ? `Live integration · ${ci.remote_name ?? ci.label}`
            : `Stored upload · ${ci.label}`;
        set((s) => ({
          source: {
            kind: "uploaded",
            filename: ci.label,
            uploadedAt: new Date().toISOString(),
            origin: ci.origin as SourceOrigin,
            detail,
          },
          // We don't have the parsed rows here; the data page re-activates from
          // storage when the user visits. Keep the existing customers (mock or
          // last-loaded) but expose the source name immediately.
          customers: s.customers,
        }));
      }

      const setEnrichSrc = (
        kind: "calls" | "cease" | "usage",
        row: typeof data[number] | undefined,
      ) => {
        if (!row) return null;
        return {
          filename: row.label,
          rowsAggregated: row.rows_count ?? 0,
          uploadedAt: new Date().toISOString(),
          origin: row.origin as SourceOrigin,
          detail:
            row.origin === "live"
              ? `Live integration · ${row.remote_name ?? row.label}`
              : `Stored upload · ${row.label}`,
        } as EnrichmentSource;
      };

      set({
        callsSource: setEnrichSrc("calls", data.find((r) => r.kind === "calls")),
        ceaseSource: setEnrichSrc("cease", data.find((r) => r.kind === "cease")),
        usageSource: setEnrichSrc("usage", data.find((r) => r.kind === "usage")),
      });
    } catch (e) {
      console.warn("[customerStore] hydrate failed", e);
    }
  },

  setActive: (customers, filename, origin = "upload", detail) => {
    const { callsMap, ceaseMap, usageMap } = get();
    set({
      customers: enrichCustomers(customers, callsMap, ceaseMap, usageMap),
      source: {
        kind: "uploaded",
        filename,
        uploadedAt: new Date().toISOString(),
        origin,
        detail: detail ?? (origin === "live" ? `Live integration · ${filename}` : `Stored upload · ${filename}`),
      },
    });
  },

  reset: () =>
    set({
      customers: enrichCustomers(defaultCustomers, get().callsMap, get().ceaseMap, get().usageMap),
      source: { kind: "mock" },
    }),

  applyCalls: (m, src) => {
    const s = get();
    const base = s.source.kind === "mock" ? defaultCustomers : s.customers;
    set({
      callsMap: m,
      callsSource: src,
      customers: enrichCustomers(base, m, s.ceaseMap, s.usageMap),
    });
  },
  applyCease: (m, src) => {
    const s = get();
    const base = s.source.kind === "mock" ? defaultCustomers : s.customers;
    set({
      ceaseMap: m,
      ceaseSource: src,
      customers: enrichCustomers(base, s.callsMap, m, s.usageMap),
    });
  },
  applyUsage: (m, src) => {
    const s = get();
    const base = s.source.kind === "mock" ? defaultCustomers : s.customers;
    set({
      usageMap: m,
      usageSource: src,
      customers: enrichCustomers(base, s.callsMap, s.ceaseMap, m),
    });
  },
  clearEnrichment: (which) => {
    const s = get();
    const base = s.source.kind === "mock" ? defaultCustomers : s.customers;
    const next = {
      callsMap: which === "calls" ? new Map() : s.callsMap,
      ceaseMap: which === "cease" ? new Map() : s.ceaseMap,
      usageMap: which === "usage" ? new Map() : s.usageMap,
      callsSource: which === "calls" ? null : s.callsSource,
      ceaseSource: which === "cease" ? null : s.ceaseSource,
      usageSource: which === "usage" ? null : s.usageSource,
    };
    set({
      ...next,
      customers: enrichCustomers(base, next.callsMap, next.ceaseMap, next.usageMap),
    });
    // Also clear the persisted record (best-effort, RLS-protected).
    void supabase.from("active_data_sources").delete().eq("kind", which);
  },

  persistActive: async ({ kind, origin, label, rows, datasetId, connectionId, remoteName }) => {
    const payload = {
      kind,
      origin,
      label,
      rows_count: rows,
      dataset_id: datasetId ?? null,
      connection_id: connectionId ?? null,
      remote_name: remoteName ?? null,
      activated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("active_data_sources")
      .upsert(payload, { onConflict: "kind" });
    if (error) console.warn("[customerStore] persistActive failed", error);
  },
}));
