import { useState, useMemo, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Brain,
  Search,
  Sparkles,
  ArrowRight,
  Zap,
  TrendingUp,
  TrendingDown,
  MessageCircleQuestion,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Loader2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CustomerFilterPresetsBar } from "@/components/CustomerFilterPresetsBar";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { featureImportance, featureLabels } from "@/data/nba";
import { personas, type Customer } from "@/data/customers";
import { useCustomerStore } from "@/data/customerStore";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import { hydrateLiveCustomers } from "@/data/liveCustomerHydrator";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_MAPPING, mapCustomers, type RawCustomerRow } from "@/data/customerMapping";
import { cn } from "@/lib/utils";
import { TopImpactedCustomers } from "@/components/TopImpactedCustomers";
import { CustomerDetail } from "@/components/CustomerDetail";
import {
  CustomerFiltersBar,
  EMPTY_FILTERS,
  applyCustomerFilters,
  countActiveFilters,
  filtersToQueryBody,
  useCustomerFacets,
  type CustomerFilters,
} from "@/components/CustomerFiltersBar";

export const Route = createFileRoute("/explainability")({
  head: () => ({
    meta: [
      { title: "Model Explainability — TalkTalk NBA" },
      {
        name: "description",
        content:
          "Transparent AI: global feature importance and per-customer SHAP-style explanations for the TalkTalk churn-prevention model.",
      },
      { property: "og:title", content: "AI Transparency & Feature Drivers — TalkTalk NBA" },
      {
        property: "og:description",
        content:
          "Per-customer churn explanations, ordered by contribution. Built for the data science and risk team.",
      },
    ],
  }),
  component: ExplainabilityPage,
});

function ExplainabilityPage() {
  const allCustomers = useCustomerStore((s) => s.customers);
  const source = useCustomerStore((s) => s.source);
  const { rules, loaded, load } = useNbaRulesStore();
  useEffect(() => { if (!loaded) load(); }, [loaded, load]);
  // Pull active datasets from storage into the store on mount so the page
  // shows real customers (not the bundled personas) after a hard refresh.
  useEffect(() => { void hydrateLiveCustomers(); }, []);

  // Detect whether MotherDuck is the active live source — if so, the
  // customer search runs against the online DuckDB instead of the in-memory
  // store, so we can browse / search the full customer base.
  const [mdLiveEnabled, setMdLiveEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("data_connections")
        .select("enabled")
        .eq("kind", "motherduck")
        .maybeSingle();
      if (alive) setMdLiveEnabled(!!data?.enabled);
    })();
    return () => { alive = false; };
  }, []);

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string>(allCustomers[0]?.id ?? personas[0].id);
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const facets = useCustomerFacets({ customers: allCustomers, liveEnabled: mdLiveEnabled });
  const [drawerOpenId, setDrawerOpenId] = useState<string | null>(null);

  // The query/filters the user has typed/picked vs what we've actually
  // submitted. Search runs only when the user clicks "Search" (or hits Enter)
  // — this keeps MotherDuck quiet while the analyst dials in a complex
  // multi-filter scenario, instead of hammering it on every keystroke /
  // slider tick.
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const hasPendingChanges = useMemo(
    () =>
      query !== appliedQuery ||
      JSON.stringify(filters) !== JSON.stringify(appliedFilters),
    [query, appliedQuery, filters, appliedFilters],
  );
  const runSearch = () => {
    setAppliedQuery(query);
    setAppliedFilters(filters);
    setPage(0);
  };

  // Live MotherDuck search state.
  const [liveRows, setLiveRows] = useState<Customer[]>([]);
  const [liveTotal, setLiveTotal] = useState(0);
  const [liveTotalAll, setLiveTotalAll] = useState(0);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const importanceData = useMemo(
    () =>
      featureImportance
        .map((f) => ({
          name: featureLabels[f.feature]?.label ?? f.feature,
          raw: f.feature,
          value: f.importance,
        }))
        .sort((a, b) => a.value - b.value), // ascending so largest is at top of horizontal chart
    []
  );

  // (filteredCustomers is declared below — handles both live MotherDuck and
  // in-memory mode.)

  // Pre-populate the customer list with at least 50 customers from MotherDuck
  // so the analyst lands on a useful sample, not 5 rows. Server caps at 200.
  const PAGE_SIZE = 50;

  // When MotherDuck live mode is on, we run a server-paged search against the
  // online DuckDB. Otherwise we filter the in-memory store as before.
  // The query depends on `appliedQuery`/`appliedFilters` (not raw inputs) so
  // the user controls when it fires via the Search button.
  const filtersBody = useMemo(() => filtersToQueryBody(appliedFilters), [appliedFilters]);
  useEffect(() => {
    if (!mdLiveEnabled) return;
    let cancelled = false;
    setLiveBusy(true);
    setLiveError(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/admin/connections/search-motherduck", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            q: appliedQuery,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
            filters: filtersBody,
          }),
        });
        const json = (await res.json()) as {
          headers?: string[]; rows?: unknown[][]; total?: number; totalAll?: number; error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        const objects = (json.rows ?? []).map((r) => {
          const o: RawCustomerRow = {};
          (json.headers ?? []).forEach((h, i) => { o[h] = r[i] as RawCustomerRow[string]; });
          return o;
        });
        setLiveRows(mapCustomers(objects, DEFAULT_MAPPING));
        setLiveTotal(json.total ?? 0);
        setLiveTotalAll(json.totalAll ?? 0);
      } catch (e) {
        if (!cancelled) setLiveError((e as Error).message);
      } finally {
        if (!cancelled) setLiveBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mdLiveEnabled, appliedQuery, page, filtersBody]);

  const filteredCustomers = useMemo(() => {
    if (mdLiveEnabled) return liveRows;
    const filtered = applyCustomerFilters(allCustomers, appliedFilters);
    const q = appliedQuery.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.package.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q) ||
        (c.persona ?? "").toLowerCase().includes(q)
    );
  }, [appliedQuery, allCustomers, mdLiveEnabled, liveRows, appliedFilters]);

  // ── MotherDuck single-ID fallback ────────────────────────────────────────
  // If the user pastes a UUID-like identifier and nothing matches locally
  // (or in the live search result set), look it up directly against the full
  // 3.5M base via customer-detail-motherduck. Surface a "data is limited"
  // banner so the analyst knows the row came from a partial lookup.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const [fallbackRow, setFallbackRow] = useState<Customer | null>(null);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const trimmedQuery = appliedQuery.trim();
  const shouldFallback =
    !!trimmedQuery &&
    UUID_RE.test(trimmedQuery) &&
    !liveBusy &&
    filteredCustomers.length === 0;
  useEffect(() => {
    if (!shouldFallback) {
      setFallbackRow(null);
      setFallbackError(null);
      return;
    }
    let cancelled = false;
    setFallbackBusy(true);
    setFallbackError(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/admin/connections/customer-detail-motherduck", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ customerId: trimmedQuery }),
        });
        const json = (await res.json()) as {
          kinds?: { customer_info?: { headers: string[]; rows: unknown[][] } };
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const ci = json.kinds?.customer_info;
        if (!ci || ci.rows.length === 0) {
          if (!cancelled) setFallbackRow(null);
          return;
        }
        const o: RawCustomerRow = {};
        ci.headers.forEach((h, i) => { o[h] = ci.rows[0][i] as RawCustomerRow[string]; });
        const mapped = mapCustomers([o], DEFAULT_MAPPING)[0] ?? null;
        if (!cancelled) setFallbackRow(mapped);
      } catch (e) {
        if (!cancelled) setFallbackError((e as Error).message);
      } finally {
        if (!cancelled) setFallbackBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shouldFallback, trimmedQuery]);

  const totalCustomersForCount = mdLiveEnabled ? liveTotalAll : allCustomers.length;
  const matchesCount = mdLiveEnabled ? liveTotal : filteredCustomers.length;
  const pageCount = mdLiveEnabled
    ? Math.max(1, Math.ceil(liveTotal / PAGE_SIZE))
    : Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE));
  // Reset/clamp page whenever the filtered set changes size.
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);

  const visibleCustomers = useMemo(
    () => mdLiveEnabled
      ? liveRows
      : filteredCustomers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filteredCustomers, page, mdLiveEnabled, liveRows],
  );

  // Pool of customers we can pick "selected" from — live rows in MotherDuck
  // mode, otherwise the in-memory store.
  const pool = mdLiveEnabled ? liveRows : allCustomers;
  // Auto-select the first real customer once live data lands so the detail
  // panel mirrors the active dataset rather than a stale persona.
  useEffect(() => {
    if (pool.length > 0 && !pool.some((c) => c.id === selectedId)) {
      setSelectedId(pool[0].id);
    }
  }, [pool, selectedId]);

  


  return (
    <AppShell>
      <PageHeader
        eyebrow="Data Science · Transparent AI"
        title="AI Transparency & Feature Drivers"
        description="Two views of the same gradient-boosted model: the global feature importance learned during training, and the local SHAP-style contributions explaining any individual customer's score."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        <TopImpactedCustomers />

        {/* Global feature importance */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 sm:px-7 py-5 border-b border-border flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <Brain className="size-3.5" />
                Global model · 9 features
              </div>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Feature importance</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Mean decrease in impurity across the trained ensemble. Tenure dominates — but the
                next four features collectively explain ~37% of churn signal.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-success/10 text-[var(--success)] text-xs font-medium border border-[var(--success)]/20">
              <Sparkles className="size-3.5" />
              AUC 0.87
            </div>
          </div>
          <div className="p-5 sm:p-7">
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={importanceData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fill: "oklch(0.5 0.02 285)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    tick={{ fill: "oklch(0.18 0.025 285)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "oklch(0.58 0.24 350 / 0.05)" }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: "var(--shadow-md)",
                    }}
                    formatter={(v: number) => [`${(v * 100).toFixed(2)}%`, "Importance"]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {importanceData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={`oklch(${0.45 + (i / importanceData.length) * 0.25} 0.24 350)`}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Local explainability */}
        <div className="grid grid-cols-1 gap-5">
          {/* Customer search */}
          <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden flex flex-col max-h-[820px]">
            <div className="px-5 py-4 border-b border-border">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Customer Search
              </div>
              <h3 className="mt-1 text-base font-semibold text-foreground">Local explanations</h3>
              <div className="mt-3 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runSearch();
                      }
                    }}
                    placeholder="Search ID (unique_customer_identifier), name, package, region…"
                    className="pl-9"
                  />
                </div>
                <button
                  type="button"
                  onClick={runSearch}
                  disabled={liveBusy}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors shrink-0",
                    hasPendingChanges
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                    liveBusy && "opacity-60 cursor-not-allowed",
                  )}
                  title={
                    hasPendingChanges
                      ? "Apply filters and search"
                      : "Re-run the current search"
                  }
                >
                  <Search className="size-3.5" />
                  {liveBusy ? "Searching…" : "Search"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <CustomerFilterPresetsBar filters={filters} onLoad={setFilters} />
                <CustomerFiltersBar
                  filters={filters}
                  onChange={setFilters}
                  facets={facets}
                  liveEnabled={mdLiveEnabled}
                />
                {hasPendingChanges && (
                  <div className="text-[10px] text-primary/80 italic">
                    Pending changes — click Search to apply.
                  </div>
                )}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {matchesCount.toLocaleString()} of {totalCustomersForCount.toLocaleString()} customers ·{" "}
                {mdLiveEnabled ? (
                  <>
                    live source{" "}
                    <code className="px-1 py-0.5 rounded bg-primary/10 text-primary font-mono text-[10px]">
                      MotherDuck (live)
                    </code>
                    {liveBusy && <span className="ml-1 italic">searching…</span>}
                    {liveError && <span className="ml-1 text-[var(--risk-high)]">{liveError}</span>}
                  </>
                ) : source.kind === "uploaded" ? (
                  <>
                    live source{" "}
                    <code className="px-1 py-0.5 rounded bg-primary/10 text-primary font-mono text-[10px]">
                      {source.filename}
                    </code>
                  </>
                ) : (
                  <>
                    using mock data — upload{" "}
                    <code className="px-1 py-0.5 rounded bg-muted text-foreground/80 font-mono text-[10px]">
                      customer_info.parquet
                    </code>{" "}
                    on the Data Library, or enable MotherDuck for live search
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto relative">
              {(liveBusy || fallbackBusy) && (
                <div className="absolute inset-0 z-10 bg-card/70 backdrop-blur-[1px] flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    {fallbackBusy ? "Looking up ID in MotherDuck…" : "Searching MotherDuck…"}
                  </div>
                </div>
              )}
              {filteredCustomers.length === 0 && !fallbackRow && !fallbackBusy && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No customers match {appliedQuery ? `"${appliedQuery}"` : "the current filters"}.
                  {fallbackError && (
                    <div className="mt-2 text-[11px] text-[var(--risk-high)]">
                      MotherDuck lookup failed: {fallbackError}
                    </div>
                  )}
                </div>
              )}
              {fallbackRow && filteredCustomers.length === 0 && (
                <>
                  <div className="px-5 py-2 text-[11px] bg-amber-500/10 border-b border-amber-500/30 text-amber-700">
                    Data is limited — single-row lookup against the full MotherDuck base. Behavioural signals may be incomplete.
                  </div>
                  <CustomerRow
                    key={fallbackRow.id}
                    customer={fallbackRow}
                    selected={selectedId === fallbackRow.id}
                    onSelect={() => setSelectedId(fallbackRow.id)}
                    onExpand={() => {
                      setSelectedId(fallbackRow.id);
                      setDrawerOpenId(fallbackRow.id);
                    }}
                  />
                </>
              )}
              {visibleCustomers.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                  onExpand={() => {
                    setSelectedId(c.id);
                    setDrawerOpenId(c.id);
                  }}
                />
              ))}
            </div>
            {filteredCustomers.length > 0 && (
              <div className="border-t border-border bg-muted/20 px-4 py-2 flex items-center justify-between gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="size-3" /> Prev
                </button>
                <div className="text-muted-foreground tabular-nums">
                  Page <span className="font-semibold text-foreground">{page + 1}</span> of{" "}
                  <span className="font-semibold text-foreground">{pageCount}</span>{" "}
                  <span className="text-muted-foreground/70">
                    · showing {visibleCustomers.length} of {filteredCustomers.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="size-3" />
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Right-side drawer with the same full profile, surfaced from the
          search row's "Profile" button. Useful when running a wide table
          search and not wanting to lose the inline panel context. */}
      <Sheet
        open={drawerOpenId !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerOpenId(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[640px] p-0 overflow-y-auto"
        >
          {(() => {
            const drawerCustomer = drawerOpenId
              ? pool.find((c) => c.id === drawerOpenId) ?? null
              : null;
            if (!drawerCustomer) return null;
            return (
              <>
                <SheetHeader className="px-5 sm:px-7 pt-6 pb-2 text-left">
                  <SheetTitle className="text-base font-semibold">
                    Customer profile
                  </SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    Full attributes, behavioural signals, SHAP drivers and the
                    computed Next Best Action.
                  </SheetDescription>
                </SheetHeader>
                <div className="p-3 sm:p-5">
                  <CustomerDetail customer={drawerCustomer} rules={rules} />
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function CustomerRow({
  customer,
  selected,
  onSelect,
  onExpand,
}: {
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
  onExpand?: () => void;
}) {
  const tierColor =
    customer.riskTier === "High"
      ? "var(--risk-high)"
      : customer.riskTier === "Medium"
        ? "var(--risk-medium)"
        : "var(--risk-low)";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative w-full text-left px-5 py-3 border-b border-border/60 transition-colors cursor-pointer",
        selected ? "bg-primary/5" : "hover:bg-muted/40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{customer.name}</span>
            {customer.persona && (
              <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
                Persona
              </span>
            )}
          </div>
          <div
            className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all line-clamp-3 leading-snug"
            title={customer.id}
          >
            {customer.id}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {customer.package} · {customer.region}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div
            className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
            style={{ background: `${tierColor}1a`, color: tierColor }}
          >
            {customer.riskTier}
          </div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {(customer.riskScore * 100).toFixed(0)}
          </div>
          {onExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              className="mt-1 inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Open full profile for ${customer.name}`}
              title="Open full profile"
            >
              <Maximize2 className="size-3" />
              Profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

