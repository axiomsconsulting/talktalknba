import { Database, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  isLive: boolean;
  className?: string;
  liveLabel?: string;
  sampleLabel?: string;
  title?: string;
};

/**
 * Small inline badge that tells the viewer whether the surrounding numbers
 * came from the connected production pipeline ("Live data") or from the
 * static fallback shipped in the codebase ("Sample data").
 */
export function DataSourceBadge({
  isLive,
  className,
  liveLabel = "Live data",
  sampleLabel = "Sample data",
  title,
}: Props) {
  return (
    <span
      title={
        title ??
        (isLive
          ? "Sourced from the latest successful model run."
          : "Static sample values — connect a live data source under Admin → Connections to replace.")
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        isLive
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      {isLive ? <Database className="size-3" /> : <FlaskConical className="size-3" />}
      {isLive ? liveLabel : sampleLabel}
    </span>
  );
}
