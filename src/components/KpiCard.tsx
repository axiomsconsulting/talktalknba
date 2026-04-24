import { cn } from "@/lib/utils";
import { type LucideIcon, TrendingUp, TrendingDown, MinusCircle } from "lucide-react";
import { ProvenanceTag } from "./ProvenanceTag";
import { type Provenance, verifyTally } from "@/data/provenance";
import { useEffect } from "react";

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accent = "primary",
  className,
  prov,
}: {
  label: string;
  value: string | null | undefined;
  sub?: string;
  icon?: LucideIcon;
  trend?: { value: string; direction: "up" | "down" | "neutral" };
  accent?: "primary" | "risk" | "success" | "neutral";
  className?: string;
  /**
   * Provenance of the displayed figure. REQUIRED for production-quality KPIs;
   * pass null only to deliberately render the "no source" state.
   */
  prov: Provenance | null;
}) {
  const accentClasses: Record<string, string> = {
    primary: "from-primary/10 to-primary/0 text-primary",
    risk: "from-[var(--risk-high)]/15 to-transparent text-[var(--risk-high)]",
    success: "from-[var(--success)]/15 to-transparent text-[var(--success)]",
    neutral: "from-muted to-transparent text-muted-foreground",
  };

  const noSource = !prov || value === null || value === undefined || value === "";

  useEffect(() => {
    if (!noSource && prov) verifyTally(value as string, prov, label);
  }, [value, prov, label, noSource]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]",
        className
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-20 bg-gradient-to-b pointer-events-none opacity-80",
          accentClasses[accent]
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {Icon && (
          <div
            className={cn(
              "size-8 rounded-lg flex items-center justify-center",
              accent === "primary" && "bg-primary/10 text-primary",
              accent === "risk" && "bg-[var(--risk-high)]/10 text-[var(--risk-high)]",
              accent === "success" && "bg-[var(--success)]/10 text-[var(--success)]",
              accent === "neutral" && "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div
        className={cn(
          "relative mt-3 text-3xl font-semibold tracking-tight tabular-nums",
          noSource ? "text-muted-foreground/60" : "text-foreground",
        )}
        title={
          prov
            ? `${prov.source}${prov.formula ? ` · ${prov.formula}` : ""}`
            : "No source connected — connect a dataset or live integration."
        }
      >
        {noSource ? "—" : value}
      </div>
      <div className="relative mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          {sub && !noSource && <span className="truncate">{sub}</span>}
          {noSource && (
            <span className="truncate italic">No source connected</span>
          )}
          {trend && !noSource && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                trend.direction === "up" && "text-[var(--success)]",
                trend.direction === "down" && "text-[var(--risk-high)]",
                trend.direction === "neutral" && "text-muted-foreground"
              )}
            >
              {trend.direction === "up" && <TrendingUp className="size-3" />}
              {trend.direction === "down" && <TrendingDown className="size-3" />}
              {trend.value}
            </span>
          )}
        </div>
        {prov ? (
          <ProvenanceTag prov={prov} compact />
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground shrink-0"
            title="No source connected"
          >
            <MinusCircle className="size-2.5" /> No source
          </span>
        )}
      </div>
    </div>
  );
}

