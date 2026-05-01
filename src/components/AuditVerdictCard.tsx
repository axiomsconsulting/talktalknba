import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Verdict = "ok" | "warn" | "gap";

const meta: Record<Verdict, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  ok:   { label: "Trustable",  icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  warn: { label: "Caveat",     icon: AlertTriangle, cls: "text-amber-700  bg-amber-50  border-amber-200" },
  gap:  { label: "Gap",        icon: XCircle,      cls: "text-red-600    bg-red-50    border-red-200" },
};

export function AuditVerdictCard({
  verdict,
  title,
  finding,
  recommendation,
}: {
  verdict: Verdict;
  title: string;
  finding: string;
  recommendation: string;
}) {
  const m = meta[verdict];
  const Icon = m.icon;
  return (
    <div className={cn("rounded-xl border p-4 flex gap-3", m.cls)}>
      <Icon className="size-5 shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide">{m.label}</span>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        <p className="text-[12.5px] text-foreground/80 leading-snug"><span className="font-medium">Finding:</span> {finding}</p>
        <p className="text-[12.5px] text-foreground/80 leading-snug"><span className="font-medium">Recommendation:</span> {recommendation}</p>
      </div>
    </div>
  );
}
