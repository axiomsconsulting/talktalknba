// Shared customer profile / SHAP / Next-Best-Action panel.
//
// Used by:
//   - The Explainability page inline list and right-side drawer
//   - The Top-50 most-impacted customers drawer
//
// Owns the per-customer expected-save breakdown (computeCustomerExpectedSave)
// so all three places agree on the £ numbers.

import {
  ArrowRight,
  MessageCircleQuestion,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGbp } from "@/data/nba";
import { NBA_TRIGGERS, type Customer, type SHAPContribution } from "@/data/customers";
import type { NbaRule } from "@/data/nbaRulesStore";
import { computeCustomerExpectedSave } from "@/data/financials";

export function CustomerDetail({
  customer,
  rules,
}: {
  customer: Customer;
  rules: NbaRule[];
}) {
  const tierColor =
    customer.riskTier === "High"
      ? "var(--risk-high)"
      : customer.riskTier === "Medium"
        ? "var(--risk-medium)"
        : "var(--risk-low)";

  // ── Per-customer expected save ───────────────────────────────────────────
  // Replaces the old `ltv − dilution − cost` pills which (a) did not weight
  // by churn probability at the individual level and (b) ignored flat
  // credits / engineer dispatch costs.
  const econ = computeCustomerExpectedSave(customer, rules);

  // Behavioural risk drivers lead the SHAP waterfall.
  const BEHAVIOURAL_ORDER = [
    "loyalty_calls",
    "loyalty_calls_90d",
    "total_hold_time",
    "avg_hold_seconds",
    "ooc_days",
    "speed_deficit",
    "speed",
    "line_speed",
    "usage_overflow",
    "avg_download_mbs",
    "cease_competitor",
    "dd_cancel_60_day",
    "contract_dd_cancels",
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
  const maxAbs = Math.max(0.0001, ...orderedShap.map((s) => Math.abs(s.impact)));

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div
        className="px-5 sm:px-7 py-5 border-b border-border"
        style={{ background: `linear-gradient(135deg, ${tierColor}10, transparent 60%)` }}
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="text-[11px] font-mono text-muted-foreground break-all">{customer.id}</div>
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
          <Pill
            label="ARPU"
            value={`£${econ.arpuMonthly.toFixed(2)}/mo`}
            footnote={
              econ.arpuSource === "line-speed-match" && econ.matchedProduct
                ? `closest match · ${econ.matchedProduct.name} @ ${econ.matchedProduct.speedMbps} Mbps`
                : "from customer record"
            }
          />
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

        {/* Per-customer expected save — full breakdown */}
        <div className="mt-5 rounded-lg border border-border bg-card/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Expected save (this customer)
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                churn × ARPU × {econ.horizonMonths}mo − discount − credit − cost-to-serve
              </div>
            </div>
            <div
              className="text-2xl font-semibold tabular-nums"
              style={{ color: econ.expectedSaveGbp >= 0 ? "var(--success)" : "var(--risk-high)" }}
            >
              {formatGbp(econ.expectedSaveGbp)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Pill
              label="Gross retained"
              value={formatGbp(econ.grossRetainedGbp)}
              footnote={`${(econ.churnProb * 100).toFixed(0)}% × £${econ.arpuMonthly.toFixed(2)} × ${econ.horizonMonths}mo`}
            />
            <Pill
              label={`Discount · ${econ.discountPct.toFixed(0)}%`}
              value={`−${formatGbp(econ.discountDilutionGbp)}`}
              tone={econ.discountDilutionGbp > 0 ? "warn" : undefined}
            />
            <Pill
              label={`Flat credit · ${formatGbp(econ.flatCreditGbp)}`}
              value={`−${formatGbp(econ.flatCreditWeightedGbp)}`}
              tone={econ.flatCreditWeightedGbp > 0 ? "warn" : undefined}
              footnote={econ.flatCreditGbp > 0 ? "weighted by churn prob" : "no credit"}
            />
            <Pill
              label="Cost to serve"
              value={`−${formatGbp(econ.costToServeGbp)}`}
              tone={econ.costToServeGbp > 0 ? "warn" : undefined}
              footnote={
                econ.engineerCostGbp > 0
                  ? `${formatGbp(econ.costPerContactGbp)} contact + ${formatGbp(econ.engineerCostGbp)} engineer`
                  : `${formatGbp(econ.costPerContactGbp)} per contact`
              }
            />
          </div>
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

function Pill({
  label,
  value,
  tone,
  footnote,
}: {
  label: string;
  value: string;
  tone?: "warn";
  footnote?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "warn"
          ? "bg-[var(--risk-high)]/5 border-[var(--risk-high)]/30"
          : "bg-card border-border",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-medium mt-0.5 truncate",
          tone === "warn" ? "text-[var(--risk-high)]" : "text-foreground",
        )}
        title={value}
      >
        {value}
      </div>
      {footnote && (
        <div className="text-[10px] text-muted-foreground/80 mt-0.5 truncate" title={footnote}>
          {footnote}
        </div>
      )}
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
  const computedWidth =
    barWidth !== undefined ? barWidth : Math.min(60, (Math.abs(impact) / maxAbs) * 60);
  const sign = impact > 0 ? "+" : impact < 0 ? "−" : "";
  const labelText = valueLabel ?? `${sign}${(Math.abs(impact) * 100).toFixed(1)} ppt`;

  return (
    <div className="grid grid-cols-[180px_1fr_70px] sm:grid-cols-[220px_1fr_80px] items-center gap-3">
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm truncate",
            isBase || isFinal ? "font-semibold text-foreground" : "font-medium text-foreground",
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

const PLAIN_ENGLISH: Record<string, { up: string; down: string }> = {
  tenure_days: {
    up: "Short tenure — customers under ~2 years churn at 2-3× the long-tenure rate.",
    down: "Long-tenure customer — every additional year roughly halves the propensity to leave.",
  },
  loyalty_calls: {
    up: "Recent calls into the loyalty / save desk are the single strongest behavioural signal of intent to leave.",
    down: "No retention contact in months — happy enough not to call.",
  },
  loyalty_calls_90d: {
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
  avg_talk_seconds: {
    up: "Average call length is high — issues take a long time to resolve.",
    down: "Calls are short — issues resolve quickly.",
  },
  total_hold_time: {
    up: "Extended hold time signals frustration even if the call resolved — a high-impact churn precursor.",
    down: "Calls have been answered quickly when made — friction is low.",
  },
  avg_hold_seconds: {
    up: "Hold time per call is high — frustration accumulates even on resolved tickets.",
    down: "Calls are answered quickly — no hold-time fatigue.",
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
  speed: {
    up: "Sold speed is at the lower end — customer may be tempted by a faster competitor offer.",
    down: "Customer is on a top-tier speed plan — competitor offers are less compelling.",
  },
  line_speed: {
    up: "Realised line speed is low in absolute terms — service quality drives churn risk.",
    down: "Realised line speed is healthy — service quality is not a driver.",
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
