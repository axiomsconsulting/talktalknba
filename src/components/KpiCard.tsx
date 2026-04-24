import { cn } from "@/lib/utils";
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accent = "primary",
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  trend?: { value: string; direction: "up" | "down" | "neutral" };
  accent?: "primary" | "risk" | "success" | "neutral";
  className?: string;
}) {
  const accentClasses: Record<string, string> = {
    primary: "from-primary/10 to-primary/0 text-primary",
    risk: "from-[var(--risk-high)]/15 to-transparent text-[var(--risk-high)]",
    success: "from-[var(--success)]/15 to-transparent text-[var(--success)]",
    neutral: "from-muted to-transparent text-muted-foreground",
  };

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
      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      <div className="relative mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {sub && <span>{sub}</span>}
        {trend && (
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
    </div>
  );
}
