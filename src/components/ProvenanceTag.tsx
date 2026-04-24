import { Database, Cpu, Brain, Sparkles, Ruler, FileSpreadsheet, Cable } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROVENANCE_DESCRIPTIONS,
  PROVENANCE_LABELS,
  type Provenance,
  type ProvenanceKind,
} from "@/data/provenance";

const ICONS: Record<ProvenanceKind, typeof Database> = {
  raw: Database,
  upload: FileSpreadsheet,
  live: Cable,
  model: Cpu,
  ml: Brain,
  rule: Ruler,
  ai: Sparkles,
};

const STYLES: Record<ProvenanceKind, string> = {
  raw: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  upload: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  model: "border-primary/40 bg-primary/10 text-primary",
  ml: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  rule: "border-cyan-600/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  ai: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
};

type Props = {
  prov: Provenance;
  className?: string;
  compact?: boolean;
};

/** Compact provenance label — one tag per figure, hover for the source detail. */
export function ProvenanceTag({ prov, className, compact = false }: Props) {
  const Icon = ICONS[prov.kind];
  const detail = [
    PROVENANCE_DESCRIPTIONS[prov.kind],
    `Source: ${prov.source}`,
    prov.formula ? `Method: ${prov.formula}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <span
      title={detail}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium uppercase tracking-wide",
        compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]",
        STYLES[prov.kind],
        className,
      )}
    >
      <Icon className={compact ? "size-2.5" : "size-3"} />
      {PROVENANCE_LABELS[prov.kind]}
    </span>
  );
}
