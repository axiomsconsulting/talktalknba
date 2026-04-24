import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useScenarioStore } from "@/data/scenarioStore";
import { generateExecSummaryPdf, downloadBlob } from "@/data/execSummaryPdf";
import { cn } from "@/lib/utils";

export function ExportPdfButton({ className }: { className?: string }) {
  const { budget, successRate, callCost, view } = useScenarioStore();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await generateExecSummaryPdf({ budget, successRate, callCost, view });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `talktalk-nba-exec-summary-${stamp}.pdf`);
    } catch (err) {
      console.error("PDF generation failed", err);
      alert("Could not generate PDF. See console for details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold",
        "bg-gradient-to-r from-primary to-primary-deep text-primary-foreground",
        "shadow-[var(--shadow-glow)] hover:shadow-[var(--shadow-md)] transition-shadow",
        "disabled:opacity-70 disabled:cursor-wait",
        className
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {busy ? "Building PDF…" : "Export exec summary"}
    </button>
  );
}
