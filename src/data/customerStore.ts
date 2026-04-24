// In-memory store for parsed customer datasets, swappable from the upload page.
// Defaults to mock personas + generated fixtures; can be overridden at runtime
// via setActive(). Optional enrichment (calls / cease / usage) is layered on
// top via applyEnrichment() and re-runs the SHAP + NBA derivation.

import { create } from "zustand";
import { allCustomers as defaultCustomers, type Customer, deriveNbaTrigger } from "./customers";
import type {
  CallEnrichment,
  CeaseEnrichment,
  UsageEnrichment,
} from "./customerMapping";

export type EnrichmentSource = {
  filename: string;
  rowsAggregated: number;
  uploadedAt: string;
};

type CustomerStore = {
  customers: Customer[];
  source: { kind: "mock" } | { kind: "uploaded"; filename: string; uploadedAt: string };
  // The raw enrichment maps so we can re-apply when the customer base changes.
  callsMap: Map<string, CallEnrichment>;
  ceaseMap: Map<string, CeaseEnrichment>;
  usageMap: Map<string, UsageEnrichment>;
  callsSource: EnrichmentSource | null;
  ceaseSource: EnrichmentSource | null;
  usageSource: EnrichmentSource | null;

  setActive: (customers: Customer[], filename: string) => void;
  reset: () => void;

  applyCalls: (m: Map<string, CallEnrichment>, src: EnrichmentSource) => void;
  applyCease: (m: Map<string, CeaseEnrichment>, src: EnrichmentSource) => void;
  applyUsage: (m: Map<string, UsageEnrichment>, src: EnrichmentSource) => void;
  clearEnrichment: (which: "calls" | "cease" | "usage") => void;
};

/** Re-derives signals + SHAP-style contributions on top of a base customer list. */
function enrichCustomers(
  base: Customer[],
  callsMap: Map<string, CallEnrichment>,
  ceaseMap: Map<string, CeaseEnrichment>,
  usageMap: Map<string, UsageEnrichment>
): Customer[] {
  if (callsMap.size === 0 && ceaseMap.size === 0 && usageMap.size === 0) return base;

  return base.map((c) => {
    // Match enrichment by raw id portion of the customer id (TT-XXXXXXXX → XXXXXXXX prefix)
    const idTail = c.id.replace(/^TT-/, "").toLowerCase();
    const findKey = (m: Map<string, unknown>): unknown => {
      for (const [k, v] of m) {
        if (k.toLowerCase().startsWith(idTail) || idTail.startsWith(k.toLowerCase().slice(0, 6))) {
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

    // Bump risk score with the enrichment signals
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

    // Re-derive NBA trigger with the new signals
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
  customers: defaultCustomers,
  source: { kind: "mock" },
  callsMap: new Map(),
  ceaseMap: new Map(),
  usageMap: new Map(),
  callsSource: null,
  ceaseSource: null,
  usageSource: null,

  setActive: (customers, filename) => {
    const { callsMap, ceaseMap, usageMap } = get();
    set({
      customers: enrichCustomers(customers, callsMap, ceaseMap, usageMap),
      source: { kind: "uploaded", filename, uploadedAt: new Date().toISOString() },
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
  },
}));
