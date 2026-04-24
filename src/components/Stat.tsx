import { useEffect, useState } from "react";
import { ChevronDown, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProvenanceTag } from "./ProvenanceTag";
import { verifyTally, type Provenance } from "@/data/provenance";

type StatProps = {
  label: string;
  /** The value to display. Pass null/undefined to show the "no source" placeholder. */
  value: string | number | null | undefined;
  /** Provenance of this figure. If null, value is forced to "—". */
  prov: Provenance | null;
  hint?: string;
  className?: string;
  valueClassName?: string;
  /** Show the inline "How this is computed" expander. Default true. */
  showWorking?: boolean;
};

/**
 * Single source-of-truth wrapper for any KPI/stat in the app.
 *
 * - Forces "—" when there is no provenance (= no real source connected).
 * - Renders a provenance tag inline and a "How this is computed" expandable
 *   that lists the inputs + formula. Prevents hallucinated numbers.
 */
export function Stat({
  label,
  value,
  prov,
  hint,
  className,
  valueClassName,
  showWorking = true,
}: StatProps) {
  const [open, setOpen] = useState(false);
  const noSource = !prov || value === null || value === undefined || value === "";

  useEffect(() => {
    if (!noSource && prov) verifyTally(value as number | string, prov, label);
  }, [value, prov, label, noSource]);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5 flex flex-col gap-1.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </div>
        {prov ? (
          <ProvenanceTag prov={prov} compact />
        ) : (
          <span
            title="No source connected — connect a dataset or live integration under Admin → Connections."
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <MinusCircle className="size-2.5" />
            No source
          </span>
        )}
      </div>
      <div
        className={cn(
          "text-lg font-semibold tabular-nums",
          noSource ? "text-muted-foreground/60" : "text-foreground",
          valueClassName,
        )}
      >
        {noSource ? "—" : value}
      </div>
      {hint && !noSource && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
      {showWorking && prov && !noSource && (prov.formula || prov.inputs?.length) && (
        <div className="border-t border-border/60 pt-1.5 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <span>How this is computed</span>
            <ChevronDown
              className={cn("size-3 transition-transform", open && "rotate-180")}
            />
          </button>
          {open && (
            <div className="mt-1.5 space-y-1 text-[10px]">
              {prov.formula && (
                <div className="text-foreground">
                  <span className="text-muted-foreground">Method: </span>
                  {prov.formula}
                </div>
              )}
              {prov.inputs && prov.inputs.length > 0 && (
                <div className="space-y-0.5">
                  {prov.inputs.map((i) => (
                    <div key={i.label} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{i.label}</span>
                      <span className="font-mono text-foreground">{i.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-muted-foreground italic pt-0.5">
                Source: {prov.source}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
