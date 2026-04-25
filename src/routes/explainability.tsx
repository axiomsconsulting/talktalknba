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
} from "lucide-react";
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
import { featureImportance, featureLabels, formatGbp } from "@/data/nba";
import { personas, type Customer, type SHAPContribution, NBA_TRIGGERS } from "@/data/customers";
import { useCustomerStore } from "@/data/customerStore";
import { useNbaRulesStore } from "@/data/nbaRulesStore";
import { customerLtv } from "@/data/financials";
import { hydrateLiveCustomers } from "@/data/liveCustomerHydrator";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_MAPPING, mapCustomers, type RawCustomerRow } from "@/data/customerMapping";
import { cn } from "@/lib/utils";
import { TopImpactedCustomers } from "@/components/TopImpactedCustomers";

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

  const PAGE_SIZE = 5;

  // When MotherDuck live mode is on, we run a server-paged search against the
  // online DuckDB. Otherwise we filter the in-memory store as before.
  useEffect(() => {
    if (!mdLiveEnabled) return;
    let cancelled = false;
    setLiveBusy(true);
    setLiveError(null);
    const handle = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/admin/connections/search-motherduck", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ q: query, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
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
    }, 250); // debounce
    return () => { cancelled = true; clearTimeout(handle); };
  }, [mdLiveEnabled, query, page]);

  const filteredCustomers = useMemo(() => {
    if (mdLiveEnabled) return liveRows;
    const q = query.trim().toLowerCase();
    if (!q) return allCustomers;
    return allCustomers.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.package.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q) ||
        (c.persona ?? "").toLowerCase().includes(q)
    );
  }, [query, allCustomers, mdLiveEnabled, liveRows]);

  const totalCustomersForCount = mdLiveEnabled ? liveTotalAll : allCustomers.length;
  const matchesCount = mdLiveEnabled ? liveTotal : filteredCustomers.length;
  const pageCount = mdLiveEnabled
    ? Math.max(1, Math.ceil(liveTotal / PAGE_SIZE))
    : Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE));
  // Reset/clamp page whenever the filtered set changes size.
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);
  // Reset page to 0 on a new search query.
  useEffect(() => { setPage(0); }, [query]);

  const visibleCustomers = useMemo(
    () => mdLiveEnabled
      ? liveRows
      : filteredCustomers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filteredCustomers, page, mdLiveEnabled, liveRows],
  );

  // Auto-select the first real customer once live data lands so the detail
  // panel mirrors the active dataset rather than a stale persona.
  useEffect(() => {
    if (allCustomers.length > 0 && !allCustomers.some((c) => c.id === selectedId)) {
      setSelectedId(allCustomers[0].id);
    }
  }, [allCustomers, selectedId]);

  const selected = allCustomers.find((c) => c.id === selectedId) ?? allCustomers[0] ?? personas[0];

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
        <div className="grid lg:grid-cols-[420px_1fr] gap-5">
          {/* Customer search */}
          <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden flex flex-col max-h-[640px]">
            <div className="px-5 py-4 border-b border-border">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Customer Search
              </div>
              <h3 className="mt-1 text-base font-semibold text-foreground">Local explanations</h3>
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ID, name, package, region…"
                  className="pl-9"
                />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {filteredCustomers.length} of {allCustomers.length} customers ·{" "}
                {source.kind === "uploaded" ? (
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
                    on the Data Library to swap in a real extract
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredCustomers.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No customers match "{query}".
                </div>
              )}
              {visibleCustomers.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
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

          {/* Detail panel */}
          <CustomerDetail customer={selected} rules={rules} />
        </div>
      </div>
    </AppShell>
  );
}

function CustomerRow({
  customer,
  selected,
  onSelect,
}: {
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
}) {
  const tierColor =
    customer.riskTier === "High"
      ? "var(--risk-high)"
      : customer.riskTier === "Medium"
        ? "var(--risk-medium)"
        : "var(--risk-low)";

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-5 py-3 border-b border-border/60 transition-colors",
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
        </div>
      </div>
    </button>
  );
}

function CustomerDetail({ customer, rules }: { customer: Customer; rules: import("@/data/nbaRulesStore").NbaRule[] }) {
  const tierColor =
    customer.riskTier === "High"
      ? "var(--risk-high)"
      : customer.riskTier === "Medium"
        ? "var(--risk-medium)"
        : "var(--risk-low)";

  // Customer LTV + dilution from the matched NBA rule
  const matchedRule = rules.find((r) => r.triggerKey === (customer.nbaTrigger ?? "nurture"));
  const ltv = customerLtv(customer.monthlyArpu, customer.riskTier);
  const horizonMonths = matchedRule && matchedRule.contractMonths > 0 ? matchedRule.contractMonths : 24;
  const discountPct = matchedRule?.discountPct ?? 0;
  const dilutionGbp = customer.monthlyArpu * horizonMonths * (discountPct / 100);
  const costToServe = matchedRule?.costPerContactGbp ?? 0;
  const netRetainedGbp = ltv - dilutionGbp - costToServe;

  // Compute base score and final by walking contributions.
  // Behavioural risk drivers (loyalty calls, hold time, OOC days, speed deficit,
  // usage vs package) lead the waterfall — these are the most actionable signals.
  const BEHAVIOURAL_ORDER = [
    "loyalty_calls",
    "total_hold_time",
    "ooc_days",
    "speed_deficit",
    "usage_overflow",
    "avg_download_mbs",
    "cease_competitor",
  ];
  const orderedShap = [...customer.shap].sort((a, b) => {
    const ai = BEHAVIOURAL_ORDER.indexOf(a.feature);
    const bi = BEHAVIOURAL_ORDER.indexOf(b.feature);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return Math.abs(b.impact) - Math.abs(a.impact);
  });
  const baseScore = 0.5;
  const positives = orderedShap.filter((s) => s.impact > 0);
  const negatives = orderedShap.filter((s) => s.impact < 0);
  const totalImpact = orderedShap.reduce((s, c) => s + c.impact, 0);
  const finalScore = Math.max(0, Math.min(1, baseScore + totalImpact));
  const maxAbs = Math.max(...orderedShap.map((s) => Math.abs(s.impact)));

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div
        className="px-5 sm:px-7 py-5 border-b border-border"
        style={{ background: `linear-gradient(135deg, ${tierColor}10, transparent 60%)` }}
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="text-[11px] font-mono text-muted-foreground">{customer.id}</div>
            <h3 className="text-xl font-semibold text-foreground mt-1">{customer.name}</h3>
            {customer.persona && (
              <div className="mt-1 text-sm text-primary">{customer.persona}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Churn probability
            </div>
            <div
              className="text-3xl font-semibold tabular-nums mt-1"
              style={{ color: tierColor }}
            >
              {(finalScore * 100).toFixed(0)}%
            </div>
            <div
              className="inline-block mt-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
              style={{ background: `${tierColor}1a`, color: tierColor }}
            >
              {customer.riskTier} risk
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Pill label="Tenure" value={`${(customer.tenureDays / 365).toFixed(1)} yrs`} />
          <Pill label="Package" value={customer.package} />
          <Pill label="Contract" value={customer.contractStatus} />
          <Pill label="ARPU" value={`£${customer.monthlyArpu}/mo`} />
        </div>

        {customer.signals && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <Pill
              label="Loyalty calls (90d)"
              value={`${customer.signals.loyaltyCalls90d}`}
              tone={customer.signals.loyaltyCalls90d >= 2 ? "warn" : undefined}
            />
            <Pill
              label="Total hold"
              value={`${Math.round(customer.signals.totalHoldSeconds / 60)} min`}
              tone={customer.signals.totalHoldSeconds > 1800 ? "warn" : undefined}
            />
            <Pill
              label="OOC days"
              value={`${customer.signals.oocDays}`}
              tone={customer.signals.oocDays > 60 ? "warn" : undefined}
            />
            <Pill
              label="Line vs sold"
              value={
                customer.signals.soldSpeedMbps > 0
                  ? `${customer.signals.lineSpeedMbps}/${customer.signals.soldSpeedMbps} Mbps`
                  : "—"
              }
              tone={
                customer.signals.soldSpeedMbps > 0 &&
                (customer.signals.soldSpeedMbps - customer.signals.lineSpeedMbps) /
                  customer.signals.soldSpeedMbps >
                  0.25
                  ? "warn"
                  : undefined
              }
            />
            <Pill
              label="Usage / mo"
              value={`${customer.signals.monthlyDownloadGb} GB`}
              tone={customer.signals.monthlyDownloadGb > 800 ? "warn" : undefined}
            />
          </div>
        )}

        {/* Customer LTV + dilution economics for the matched rule */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Pill label="Customer LTV" value={formatGbp(ltv)} />
          <Pill label="Proposed discount" value={`${discountPct.toFixed(0)}% · ${horizonMonths}mo`} />
          <Pill label="Revenue dilution" value={`−${formatGbp(dilutionGbp)}`} tone={dilutionGbp > 0 ? "warn" : undefined} />
          <Pill label="Net retained value" value={formatGbp(netRetainedGbp)} />
        </div>
      </div>

      {/* Why this customer — plain-English drill-down of top + and − drivers */}
      <WhyThisCustomerPanel shap={orderedShap} />

      <div className="p-5 sm:p-7 border-t border-border">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="size-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">SHAP value waterfall</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Each bar shows how that feature pushed the customer's score up (coral) or down (teal)
          from the base rate of {(baseScore * 100).toFixed(0)}%.
        </p>

        <div className="space-y-2.5">
          {/* Base */}
          <WaterfallStep
            label="Base rate"
            detail="Population average churn probability"
            impact={0}
            barWidth={baseScore * 100}
            barColor="oklch(0.78 0.02 285)"
            valueLabel={`${(baseScore * 100).toFixed(0)}%`}
            isBase
            maxAbs={maxAbs}
          />
          {orderedShap.map((s) => (
            <WaterfallStep
              key={s.feature}
              label={s.label}
              detail={s.detail}
              impact={s.impact}
              barColor={s.impact > 0 ? "oklch(0.58 0.24 350)" : "oklch(0.55 0.13 200)"}
              maxAbs={maxAbs}
            />
          ))}
          {/* Final */}
          <div className="pt-3 mt-3 border-t border-border">
            <WaterfallStep
              label="Final score"
              detail={`${positives.length} factor(s) up · ${negatives.length} factor(s) down`}
              impact={0}
              barWidth={finalScore * 100}
              barColor={tierColor}
              valueLabel={`${(finalScore * 100).toFixed(0)}%`}
              isFinal
              maxAbs={maxAbs}
            />
          </div>
        </div>

        <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <ArrowRight className="size-3.5" />
            Recommended Next Best Action
          </div>
          {(() => {
            const triggerKey = customer.nbaTrigger ?? "nurture";
            const t = NBA_TRIGGERS[triggerKey];
            return (
              <div className="mt-2 space-y-2">
                <div className="text-sm font-semibold text-foreground">{t.label}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-card border border-border text-muted-foreground">
                    {t.channel}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-primary/10 border border-primary/20 text-primary">
                    {t.offer}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "warn"
          ? "bg-[var(--risk-high)]/5 border-[var(--risk-high)]/30"
          : "bg-card border-border"
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-medium mt-0.5 truncate",
          tone === "warn" ? "text-[var(--risk-high)]" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function WaterfallStep({
  label,
  detail,
  impact,
  barWidth,
  barColor,
  valueLabel,
  isBase,
  isFinal,
  maxAbs,
}: {
  label: string;
  detail?: string;
  impact: number;
  barWidth?: number;
  barColor: string;
  valueLabel?: string;
  isBase?: boolean;
  isFinal?: boolean;
  maxAbs: number;
}) {
  // For impact rows, scale relative to the max absolute impact, but cap to 60% width.
  const computedWidth =
    barWidth !== undefined ? barWidth : Math.min(60, (Math.abs(impact) / maxAbs) * 60);
  const sign = impact > 0 ? "+" : impact < 0 ? "−" : "";
  const labelText = valueLabel ?? `${sign}${(Math.abs(impact) * 100).toFixed(1)} ppt`;

  return (
    <div className="grid grid-cols-[200px_1fr_70px] sm:grid-cols-[220px_1fr_80px] items-center gap-3">
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm truncate",
            isBase || isFinal ? "font-semibold text-foreground" : "font-medium text-foreground"
          )}
        >
          {label}
        </div>
        {detail && (
          <div className="text-[11px] text-muted-foreground truncate" title={detail}>
            {detail}
          </div>
        )}
      </div>
      <div className="h-6 relative bg-muted/40 rounded">
        <div
          className="h-full rounded transition-all"
          style={{
            width: `${computedWidth}%`,
            background: barColor,
            opacity: isBase ? 0.5 : 1,
          }}
        />
      </div>
      <div
        className="text-xs font-semibold tabular-nums text-right"
        style={{
          color:
            isBase || isFinal
              ? "var(--foreground)"
              : impact > 0
                ? "var(--risk-high)"
                : "var(--success)",
        }}
      >
        {labelText}
      </div>
    </div>
  );
}

// Plain-English explanations for each SHAP feature, separated for the case
// where the feature is pushing risk up vs. pulling it down. Keeps the panel
// readable for a Head of Finance who isn't reading the model card.
const PLAIN_ENGLISH: Record<string, { up: string; down: string }> = {
  tenure_days: {
    up: "Short tenure — customers under ~2 years churn at 2-3× the long-tenure rate.",
    down: "Long-tenure customer — every additional year roughly halves the propensity to leave.",
  },
  loyalty_calls: {
    up: "Recent calls into the loyalty / save desk are the single strongest behavioural signal of intent to leave.",
    down: "No retention contact in months — happy enough not to call.",
  },
  ooc_days: {
    up: "Out of contract — there is no early-termination fee in the way of a switch.",
    down: "Comfortably mid-contract — switching cost stays high.",
  },
  total_talk_time: {
    up: "Long inbound support time means unresolved friction; complaint volume correlates strongly with churn.",
    down: "Quiet account — customer is not engaging support.",
  },
  total_hold_time: {
    up: "Extended hold time signals frustration even if the call resolved — a high-impact churn precursor.",
    down: "Calls have been answered quickly when made — friction is low.",
  },
  avg_download_mbs: {
    up: "Heavy bandwidth use on a basic package — the line throttles and the experience suffers.",
    down: "Plenty of headroom on the package; service experience is comfortable.",
  },
  contract_dd_cancels: {
    up: "Past direct-debit cancellations indicate billing friction or affordability strain.",
    down: "Clean payment history — no historic billing breakage.",
  },
  speed_deficit: {
    up: "Delivered line speed is well below what was sold — root-cause issue, not a price one.",
    down: "Line is hitting or beating the sold speed — no engineering issue.",
  },
  dd_cancel_60_day: {
    up: "Direct debit cancelled in the last 60 days — strongest near-term churn precursor in the model.",
    down: "No recent payment events.",
  },
};

function explanationFor(s: SHAPContribution): string {
  const entry = PLAIN_ENGLISH[s.feature];
  if (!entry) return s.detail;
  return s.impact > 0 ? entry.up : entry.down;
}

function WhyThisCustomerPanel({ shap }: { shap: SHAPContribution[] }) {
  // Top 3 positive (push risk UP) and top 3 negative (pull risk DOWN) drivers.
  const positives = [...shap]
    .filter((s) => s.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);
  const negatives = [...shap]
    .filter((s) => s.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 3);

  return (
    <div className="p-5 sm:p-7 border-t border-border bg-gradient-to-b from-muted/40 to-transparent">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircleQuestion className="size-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Why this customer</h4>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The top features moving this customer's score, translated into plain English. Read this
        before opening the SHAP waterfall below.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <DriverList
          title="Pushing risk UP"
          accent="up"
          drivers={positives}
          empty="Nothing material is increasing this customer's churn probability."
        />
        <DriverList
          title="Pulling risk DOWN"
          accent="down"
          drivers={negatives}
          empty="Nothing material is protecting this customer from churn."
        />
      </div>
    </div>
  );
}

function DriverList({
  title,
  accent,
  drivers,
  empty,
}: {
  title: string;
  accent: "up" | "down";
  drivers: SHAPContribution[];
  empty: string;
}) {
  const isUp = accent === "up";
  const Icon = isUp ? TrendingUp : TrendingDown;
  const accentColor = isUp ? "var(--risk-high)" : "var(--success)";

  return (
    <div
      className="rounded-lg border bg-card p-4"
      style={{ borderColor: `${accentColor}33` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center justify-center size-6 rounded-md"
          style={{ background: `${accentColor}1a`, color: accentColor }}
        >
          <Icon className="size-3.5" />
        </span>
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: accentColor }}
        >
          {title}
        </span>
      </div>

      {drivers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{empty}</p>
      ) : (
        <ol className="space-y-3">
          {drivers.map((d, i) => {
            const sign = d.impact > 0 ? "+" : "−";
            return (
              <li key={d.feature} className="flex gap-3">
                <span className="text-[10px] font-mono text-muted-foreground pt-0.5 shrink-0 w-4">
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{d.label}</span>
                    <span
                      className="text-[11px] font-semibold tabular-nums shrink-0"
                      style={{ color: accentColor }}
                    >
                      {sign}
                      {(Math.abs(d.impact) * 100).toFixed(1)} ppt
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                    {explanationFor(d)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
