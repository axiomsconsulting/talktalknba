import { useState } from "react";
import { Loader2, Send, Search, Copy, Database, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { scoreCustomer, type ScoringInput, type ScoringResult } from "@/data/scoring";
import { allCustomers } from "@/data/customers";
import { useCustomerStore } from "@/data/customerStore";

type ApiResponse =
  | {
      ok: true;
      source: "top_customers" | "live_snapshots" | "in_app_sample" | "local_upload";
      source_detail: string;
      input: ScoringInput;
      result: ScoringResult;
    }
  | {
      ok: false;
      source: "not_found";
      error: string;
      hint?: string;
    };

const SAMPLES = allCustomers.slice(0, 4).map((c) => c.id);

function fmtPct(v: number) {
  return `${(v * 100).toFixed(0)}%`;
}

function ShapWaterfall({ shap, score }: { shap: ScoringResult["shap"]; score: number }) {
  const max = Math.max(0.32, ...shap.map((c) => Math.abs(c.impact)));
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          SHAP waterfall · base 0.50 → final {score.toFixed(2)}
        </div>
        <div className="text-[11px] text-muted-foreground">Sorted by absolute impact</div>
      </div>
      <ul className="space-y-2">
        {shap.map((c) => {
          const pct = (Math.abs(c.impact) / max) * 100;
          const positive = c.impact >= 0;
          return (
            <li key={c.feature} className="grid grid-cols-[160px_1fr_70px] items-center gap-3">
              <div className="text-[12px] font-medium text-foreground truncate" title={c.label}>
                {c.label}
              </div>
              <div className="relative h-5 rounded bg-muted/40 overflow-hidden">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className={`absolute inset-y-0 ${positive ? "left-1/2" : "right-1/2"} ${
                    positive
                      ? "bg-[var(--risk-high,oklch(0.66_0.22_15))]/70"
                      : "bg-[var(--success,oklch(0.65_0.18_150))]/70"
                  }`}
                  style={{ width: `${pct / 2}%` }}
                />
              </div>
              <div
                className={`text-[12px] font-mono tabular-nums text-right ${
                  positive ? "text-[var(--risk-high,oklch(0.55_0.22_15))]" : "text-[var(--success,oklch(0.45_0.18_150))]"
                }`}
              >
                {positive ? "+" : ""}
                {c.impact.toFixed(3)}
              </div>
              <div className="col-span-3 -mt-1 ml-[160px] pl-3 text-[11px] text-muted-foreground leading-snug">
                {c.detail}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ApiTesterCard() {
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [showJson, setShowJson] = useState(false);
  const customers = useCustomerStore((s) => s.customers);
  const source = useCustomerStore((s) => s.source);

  const findLocal = (cid: string): ApiResponse | null => {
    const lower = cid.toLowerCase();
    const tail = lower.replace(/^tt-/, "");
    const c = customers.find((x) => {
      const xid = x.id.toLowerCase();
      const xtail = xid.replace(/^tt-/, "");
      return xid === lower || xtail === tail || xid.startsWith(lower) || xtail.startsWith(tail);
    });
    if (!c) return null;
    const s = c.signals;
    const input: ScoringInput = {
      id: c.id,
      name: c.name,
      package: c.package,
      tenureDays: c.tenureDays,
      contractStatusRaw: c.contractStatus,
      oocDays: s?.oocDays ?? 0,
      ddCancel60: 0,
      contractDdCancels: 0,
      soldSpeedMbps: s?.soldSpeedMbps ?? 0,
      lineSpeedMbps: s?.lineSpeedMbps ?? 0,
      technology: s?.technology,
      loyaltyCalls90d: s?.loyaltyCalls90d,
      totalHoldSeconds: s?.totalHoldSeconds,
      totalTalkSeconds: s?.totalTalkSeconds,
      monthlyDownloadGb: s?.monthlyDownloadGb,
      monthlyUploadGb: s?.monthlyUploadGb,
      ceaseInsight: s?.ceaseInsight,
      preferredChannel: s?.preferredChannel,
      riskScoreOverride: c.riskScore,
    };
    const result = scoreCustomer(input);
    const isUpload = source.kind === "uploaded";
    return {
      ok: true,
      source: isUpload ? "local_upload" : "in_app_sample",
      source_detail: isUpload
        ? `Local upload · ${source.detail ?? source.filename}`
        : "In-app personas / generated customers",
      input,
      result,
    };
  };

  const submit = async (id?: string) => {
    const cid = (id ?? customerId).trim();
    if (!cid) {
      toast.error("Enter a customer id");
      return;
    }
    setLoading(true);
    setResp(null);
    try {
      // 1) Check the active in-browser dataset first (covers local uploads
      //    that the server endpoint cannot see).
      const local = findLocal(cid);
      if (local) {
        setResp(local);
        if (id) setCustomerId(cid);
        return;
      }
      // 2) Fall back to the server endpoint (top_customers / live snapshots / personas).
      const r = await fetch("/api/score-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: cid }),
      });
      const json = (await r.json()) as ApiResponse;
      setResp(json);
      if (id) setCustomerId(cid);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copyCurl = () => {
    const cmd = `curl -X POST ${window.location.origin}/api/score-customer \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ customer_id: customerId || "TT-2048771" })}'`;
    void navigator.clipboard.writeText(cmd);
    toast.success("curl command copied");
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3.5" /> API tester · same algorithm as the app
        </div>
        <h2 className="mt-1 text-base font-semibold text-foreground">
          Score one customer — <code className="font-mono text-[12.5px] px-1 py-0.5 rounded bg-muted">POST /api/score-customer</code>
        </h2>
        <p className="text-[12.5px] text-muted-foreground">
          Resolves the id against (1) the active in-browser dataset (local upload), then (2) live model output in <code className="font-mono">top_customers</code>,
          then (3) the active live data snapshots, then (4) in-app personas. Returns the same risk score,
          SHAP waterfall and Next Best Action that the Explainability page renders for that customer.
        </p>
      </header>

      {/* Input row */}
      <div className="rounded-xl border border-border bg-background/40 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
              Customer id
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                placeholder="TT-2048771 or unique_customer_identifier UUID"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
          <Button onClick={() => void submit()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Score customer
          </Button>
          <Button variant="outline" size="sm" onClick={copyCurl}>
            <Copy className="size-3.5" /> Copy curl
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Try:</span>
          {SAMPLES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => void submit(id)}
              className="text-[11px] font-mono px-2 py-1 rounded border border-border bg-muted/40 hover:bg-muted text-foreground"
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {resp && resp.ok === false && (
        <div className="rounded-xl border border-[var(--risk-high)]/30 bg-[var(--risk-high)]/5 p-4 text-sm">
          <div className="flex items-center gap-2 text-[var(--risk-high)] font-semibold">
            <AlertCircle className="size-4" />
            Not found
          </div>
          <p className="mt-1 text-[12.5px] text-foreground">{resp.error}</p>
          {resp.hint && <p className="mt-1 text-[11.5px] text-muted-foreground">{resp.hint}</p>}
        </div>
      )}

      {resp && resp.ok && (
        <div className="space-y-4">
          {/* Source banner */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 text-success px-2 py-0.5 font-semibold">
              <CheckCircle2 className="size-3" /> Resolved
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
              <Database className="size-3" /> {resp.source_detail}
            </span>
          </div>

          {/* Header — customer + NBA */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                Customer
              </div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {resp.result.customer.name} <span className="font-mono text-[12.5px] text-muted-foreground">({resp.result.customer.id})</span>
              </div>
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                {resp.result.customer.package} · tenure {Math.round(resp.result.customer.tenureDays / 365 * 10) / 10} yrs · {resp.result.customer.contractStatus}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    resp.result.riskTier === "High"
                      ? "text-[var(--risk-high,oklch(0.55_0.22_15))]"
                      : resp.result.riskTier === "Medium"
                        ? "text-[oklch(0.55_0.14_60)]"
                        : "text-success"
                  }`}
                >
                  {fmtPct(resp.result.riskScore)}
                </div>
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                    resp.result.riskTier === "High"
                      ? "bg-[var(--risk-high)]/15 text-[var(--risk-high)]"
                      : resp.result.riskTier === "Medium"
                        ? "bg-[oklch(0.78_0.14_75)]/15 text-[oklch(0.55_0.14_60)]"
                        : "bg-success/15 text-success"
                  }`}
                >
                  {resp.result.riskTier} risk
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-primary">Next Best Action</div>
              <div className="mt-1 text-base font-semibold text-foreground">{resp.result.nba.label}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">{resp.result.nba.channel}</div>
              <div className="mt-2 text-[12.5px] text-foreground/90 leading-snug">
                <span className="font-semibold">Offer:</span> {resp.result.nba.offer}
              </div>
            </div>
          </div>

          {/* Why narratives */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                Why this customer
              </div>
              <p className="mt-1.5 text-[13px] text-foreground leading-relaxed">{resp.result.whyThisCustomer}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                Why this NBA
              </div>
              <p className="mt-1.5 text-[13px] text-foreground leading-relaxed">{resp.result.whyThisNba}</p>
            </div>
          </div>

          {/* SHAP waterfall */}
          <ShapWaterfall shap={resp.result.shap} score={resp.result.riskScore} />

          {/* Raw JSON */}
          <div className="rounded-xl border border-border bg-background/40">
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <span>Raw API response (JSON)</span>
              <span className="text-[11px]">{showJson ? "Hide" : "Show"}</span>
            </button>
            {showJson && (
              <pre className="px-4 pb-4 pt-0 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[360px] text-foreground">
                {JSON.stringify(resp, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
