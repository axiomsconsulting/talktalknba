import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Brain, Search, Sparkles, ArrowRight, Zap } from "lucide-react";
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
import { allCustomers, personas, type Customer } from "@/data/customers";
import { cn } from "@/lib/utils";

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
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(personas[0].id);

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

  const filteredCustomers = useMemo(() => {
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
  }, [query]);

  const selected = allCustomers.find((c) => c.id === selectedId) ?? personas[0];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Data Science · Transparent AI"
        title="AI Transparency & Feature Drivers"
        description="Two views of the same gradient-boosted model: the global feature importance learned during training, and the local SHAP-style contributions explaining any individual customer's score."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
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
                {filteredCustomers.length} of {allCustomers.length} customers · Upload{" "}
                <code className="px-1 py-0.5 rounded bg-muted text-foreground/80 font-mono text-[10px]">
                  customer_info.parquet
                </code>{" "}
                to load real extract
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredCustomers.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No customers match "{query}".
                </div>
              )}
              {filteredCustomers.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail panel */}
          <CustomerDetail customer={selected} />
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
          <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{customer.id}</div>
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

function CustomerDetail({ customer }: { customer: Customer }) {
  const tierColor =
    customer.riskTier === "High"
      ? "var(--risk-high)"
      : customer.riskTier === "Medium"
        ? "var(--risk-medium)"
        : "var(--risk-low)";

  // Compute base score and final by walking contributions
  const baseScore = 0.5;
  const positives = customer.shap.filter((s) => s.impact > 0);
  const negatives = customer.shap.filter((s) => s.impact < 0);
  const totalImpact = customer.shap.reduce((s, c) => s + c.impact, 0);
  const finalScore = Math.max(0, Math.min(1, baseScore + totalImpact));
  const maxAbs = Math.max(...customer.shap.map((s) => Math.abs(s.impact)));

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
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="size-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">SHAP value waterfall</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Each bar shows how that feature pushed the customer's score up (magenta) or down (teal)
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
          {customer.shap.map((s) => (
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
          <div className="mt-2 text-sm text-foreground leading-relaxed">
            {recommendAction(customer)}
          </div>
        </div>
      </div>
    </div>
  );
}

function recommendAction(c: Customer): string {
  if (c.riskTier === "High" && c.contractStatus === "Out of contract")
    return "Proactive save call from a senior agent within 48h. Authorised to offer 20% loyalty discount and a 24-month re-contract.";
  if (c.riskTier === "High")
    return "Triage to retention squad. Lead with a service-quality fix (engineer dispatch / speed review), then pivot to value reinforcement.";
  if (c.riskTier === "Medium" && c.package.includes("Fibre 65"))
    return "Email-led upgrade campaign to Fibre 150 / Full Fibre. Include speed comparison and price hold for 12 months.";
  if (c.riskTier === "Medium")
    return "Personalised retention email — annual account review with usage insights and bill explainer.";
  return "Suppress from outbound. Maintain in nurture sequences only — outbound contact would erode satisfaction.";
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card border border-border px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium text-foreground mt-0.5 truncate">{value}</div>
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
