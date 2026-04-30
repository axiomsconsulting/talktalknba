import { useEffect, useMemo, useState } from "react";
import { Crown, Sparkles, RefreshCcw, Loader2, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ProvenanceTag } from "@/components/ProvenanceTag";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CustomerDetail } from "@/components/CustomerDetail";
import { useCustomerStore } from "@/data/customerStore";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import { DEFAULT_MAPPING, mapCustomers, type RawCustomerRow } from "@/data/customerMapping";
import type { Customer } from "@/data/customers";

type Reason = { feature: string; impact: number };
type TopCustomer = {
  id: string;
  customer_id: string;
  rank: number;
  churn_prob: number;
  reason_codes: Reason[] | null;
  recommended_nba: string | null;
  expected_save_gbp: number | null;
  created_at: string;
  model_run_id: string | null;
};

const FEATURE_LABEL: Record<string, string> = {
  loyalty_calls_90d: "Loyalty calls (90d)",
  avg_hold_seconds: "Avg hold time",
  ooc_days: "Out of contract",
  speed_deficit_pct: "Speed deficit",
  monthly_download_gb: "Monthly GB",
  tenure_months: "Tenure",
  monthly_arpu: "ARPU",
  package_tier: "Package",
  n_devices: "Devices",
};

function gbp(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

export function TopImpactedCustomers() {
  const [rows, setRows] = useState<TopCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 5;

  // Drawer state for the per-customer profile.
  const [drawerOpenId, setDrawerOpenId] = useState<string | null>(null);
  const [drawerCustomer, setDrawerCustomer] = useState<Customer | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerLimited, setDrawerLimited] = useState(false);

  const allCustomers = useCustomerStore((s) => s.customers);
  const { rules, loaded: rulesLoaded, load: loadRules } = useNbaRulesStore();
  useEffect(() => { if (!rulesLoaded) loadRules(); }, [rulesLoaded, loadRules]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("top_customers")
      .select("*")
      .order("rank", { ascending: true })
      .limit(50);
    const list = (data ?? []) as TopCustomer[];
    setRows(list);
    setLastImport(list[0]?.created_at ?? null);
    setPage(0);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const openProfile = async (customerId: string) => {
    setDrawerOpenId(customerId);
    setDrawerError(null);
    setDrawerLimited(false);

    // Try in-memory first.
    const local = allCustomers.find((c) => c.id === customerId);
    if (local) {
      setDrawerCustomer(local);
      return;
    }

    // Fall back to MotherDuck single-row lookup.
    setDrawerCustomer(null);
    setDrawerBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/connections/customer-detail-motherduck", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ customerId }),
      });
      const json = (await res.json()) as {
        kinds?: { customer_info?: { headers: string[]; rows: unknown[][] } };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const ci = json.kinds?.customer_info;
      if (!ci || ci.rows.length === 0) {
        setDrawerError("Customer not found in MotherDuck base.");
        return;
      }
      const o: RawCustomerRow = {};
      ci.headers.forEach((h, i) => { o[h] = ci.rows[0][i] as RawCustomerRow[string]; });
      const mapped = mapCustomers([o], DEFAULT_MAPPING)[0] ?? null;
      setDrawerCustomer(mapped);
      setDrawerLimited(true);
    } catch (e) {
      setDrawerError((e as Error).message);
    } finally {
      setDrawerBusy(false);
    }
  };

  const empty = !loading && rows.length === 0;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [rows, page],
  );

  return (
    <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Crown className="size-3.5" /> Top 50 most impacted customers
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Highest churn probability · ranked</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Produced offline by <code className="font-mono px-1 rounded bg-muted">score_top50.py</code>, then
            imported via Model → External training kit. Reason codes use SHAP when available, otherwise weighted
            feature importance.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <ProvenanceTag prov={{ kind: "ml", source: "External training · score_top50.py" }} />
          <button
            onClick={load}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted"
            disabled={loading}
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCcw className="size-3" />}
            Refresh
          </button>
        </div>
      </div>

      {empty && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No top-50 imported yet. Go to <a href="/model" className="underline">Model → External training kit</a> to
          download the script, run it on your laptop, and import <code className="font-mono">top_50_customers.json</code>.
        </div>
      )}

      {!empty && (
        <>
          {lastImport && (
            <div className="px-5 sm:px-7 py-2 text-[11px] text-muted-foreground border-b border-border bg-muted/30 flex items-center justify-between gap-3">
              <span>
                Imported {new Date(lastImport).toLocaleString()} · {rows.length} customers
              </span>
              <span>
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left w-[120px]">Customer</th>
                  <th className="px-3 py-2 text-right">Churn prob</th>
                  <th className="px-3 py-2 text-left">Top reasons</th>
                  <th className="px-3 py-2 text-left">Recommended NBA</th>
                  <th className="px-3 py-2 text-right">Expected save</th>
                  <th className="px-3 py-2 text-right w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const id = r.customer_id ?? "";
                  const chunk = Math.ceil(id.length / 3) || 1;
                  const idLines = [
                    id.slice(0, chunk),
                    id.slice(chunk, chunk * 2),
                    id.slice(chunk * 2),
                  ].filter(Boolean);
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/30 align-top">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.rank}</td>
                      <td className="px-3 py-2 font-mono text-[11px] leading-tight w-[120px] break-all">
                        <button
                          type="button"
                          onClick={() => openProfile(id)}
                          className="text-left text-primary hover:underline"
                          title="Open customer profile"
                        >
                          {idLines.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={
                            r.churn_prob >= 0.7
                              ? "text-destructive font-semibold"
                              : r.churn_prob >= 0.4
                                ? "text-amber-600 font-medium"
                                : "text-foreground"
                          }
                        >
                          {(r.churn_prob * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(r.reason_codes ?? []).slice(0, 3).map((c, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                            >
                              <Sparkles className="size-2.5" />
                              {FEATURE_LABEL[c.feature] ?? c.feature}
                            </span>
                          ))}
                          {(!r.reason_codes || r.reason_codes.length === 0) && (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[12px]">{r.recommended_nba ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(r.expected_save_gbp)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openProfile(id)}
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          title="Open full profile"
                        >
                          <Maximize2 className="size-3" />
                          Profile
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 sm:px-7 py-3 border-t border-border bg-muted/20 flex items-center justify-between gap-3">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="size-3" /> Prev
            </button>
            <span className="text-[11px] text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="size-3" />
            </button>
          </div>
        </>
      )}

      <Sheet
        open={drawerOpenId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerOpenId(null);
            setDrawerCustomer(null);
            setDrawerError(null);
            setDrawerLimited(false);
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[640px] p-0 overflow-y-auto">
          <SheetHeader className="px-5 sm:px-7 pt-6 pb-2 text-left">
            <SheetTitle className="text-base font-semibold">Customer profile</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Top-50 ranked customer · full attributes, behavioural signals, SHAP drivers and the
              computed Next Best Action.
            </SheetDescription>
          </SheetHeader>
          {drawerLimited && drawerCustomer && (
            <div className="mx-5 sm:mx-7 mt-2 px-3 py-2 text-[11px] bg-amber-500/10 border border-amber-500/30 rounded text-amber-700">
              Data is limited — single-row lookup against the full MotherDuck base. Behavioural
              signals may be incomplete.
            </div>
          )}
          <div className="p-3 sm:p-5">
            {drawerBusy && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                Loading profile from MotherDuck…
              </div>
            )}
            {drawerError && !drawerBusy && (
              <div className="px-4 py-6 text-sm text-[var(--risk-high)] text-center">
                {drawerError}
              </div>
            )}
            {drawerCustomer && !drawerBusy && (
              <CustomerDetail customer={drawerCustomer} rules={rules} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
