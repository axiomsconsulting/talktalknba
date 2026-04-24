import { useEffect, useState } from "react";
import { Download, Upload, FileCode, FileJson, Database, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/data/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TRAIN_IPYNB, SCORE_IPYNB, README_MD } from "@/data/trainingScripts";

type SignedLinks = Record<string, { url: string; filename: string } | null>;

async function callServer<T = unknown>(path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : null) ?? text ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExternalTrainingKit() {
  const { isAdmin } = useAuth();
  const [links, setLinks] = useState<SignedLinks | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [importing, setImporting] = useState(false);
  const [metricsFile, setMetricsFile] = useState<File | null>(null);
  const [topFile, setTopFile] = useState<File | null>(null);
  const [topCount, setTopCount] = useState<number | null>(null);

  const refreshTopCount = async () => {
    const { count } = await supabase
      .from("top_customers")
      .select("id", { count: "exact", head: true });
    setTopCount(count ?? 0);
  };

  useEffect(() => {
    void refreshTopCount();
  }, []);

  if (!isAdmin) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        External training kit is admin-only.
      </section>
    );
  }

  const fetchLinks = async () => {
    setLoadingLinks(true);
    try {
      const res = await callServer<{ links: SignedLinks }>("/api/admin/training/kit", {});
      setLinks(res.links);
    } catch (e) {
      toast.error(`Failed to refresh download links: ${(e as Error).message}`);
    } finally {
      setLoadingLinks(false);
    }
  };

  const submitImport = async () => {
    if (!metricsFile && !topFile) {
      toast.error("Pick at least one file (metrics or top-50 customers)");
      return;
    }
    setImporting(true);
    try {
      // NaN/Infinity are not legal JSON. Replace bare tokens with null so
      // notebooks that emitted them (older runs) still import cleanly.
      const safeParse = (raw: string) =>
        JSON.parse(
          raw.replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null"),
        );
      const payload: Record<string, unknown> = {};
      if (metricsFile) payload.metrics = safeParse(await metricsFile.text());
      if (topFile) {
        const top = safeParse(await topFile.text());
        // Accept either { customers: [...] } or a bare array
        payload.top_customers = Array.isArray(top) ? top : (top.customers ?? []);
      }
      const res = await callServer<{ message?: string }>("/api/admin/training/import", payload);
      toast.success(res.message ?? "Imported.");
      setMetricsFile(null);
      setTopFile(null);
      await refreshTopCount();
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const linkRows = [
    { kind: "customer_info", label: "Customer info" },
    { kind: "calls", label: "Calls" },
    { kind: "cease", label: "Cease" },
    { kind: "usage", label: "Usage" },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <FileCode className="size-3.5" /> External training · ML based
        </div>
        <h2 className="mt-1 text-base font-semibold text-foreground">External training kit (VS Code)</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Lovable Cloud cannot run scikit-learn or XGBoost in its edge runtime. Train on your laptop, then
          upload the resulting JSON files to populate the model metrics and the top-50 highest-risk customers
          shown in the Explainability page.
        </p>
      </header>

      {/* Step 1: scripts */}
      <div className="rounded-xl border border-border bg-background/40 p-4 mb-4">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          1 · Download the scripts
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadText("train.ipynb", TRAIN_IPYNB, "application/x-ipynb+json")}>
            <FileCode className="size-3.5" /> train.ipynb
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadText("score_top50.ipynb", SCORE_IPYNB, "application/x-ipynb+json")}>
            <FileCode className="size-3.5" /> score_top50.ipynb
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadText("README.md", README_MD, "text/markdown")}>
            <FileJson className="size-3.5" /> README.md
          </Button>
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Setup: <code className="font-mono px-1 py-0.5 rounded bg-muted">pip install pandas numpy scikit-learn pyarrow fastparquet xgboost</code>{" "}
          (macOS also: <code className="font-mono px-1 py-0.5 rounded bg-muted">brew install libomp</code>). Drop the four pulled data files
          into the same folder as the notebooks, then run <code className="font-mono px-1 py-0.5 rounded bg-muted">train.ipynb</code> followed by{" "}
          <code className="font-mono px-1 py-0.5 rounded bg-muted">score_top50.ipynb</code>.
        </p>
      </div>

      {/* Step 2: data download links */}
      <div className="rounded-xl border border-border bg-background/40 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            2 · Download the latest pulled data
          </div>
          <Button size="sm" variant="ghost" onClick={fetchLinks} disabled={loadingLinks}>
            {loadingLinks ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
            {links ? "Refresh links" : "Get download links"}
          </Button>
        </div>
        {!links ? (
          <p className="text-[12px] text-muted-foreground">
            Each link is a 1-hour signed URL to the file pulled from Azure DevOps. Save all four files into the{" "}
            <strong>same folder as the notebooks</strong> (the notebooks default to <code className="font-mono px-1 rounded bg-muted">DATA = '.'</code>).
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {linkRows.map(({ kind, label }) => {
              const link = links[kind];
              return (
                <li key={kind} className="py-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {link?.filename ?? "— not pulled yet —"}
                    </div>
                  </div>
                  {link ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={link.url} download={link.filename} target="_blank" rel="noreferrer">
                        <Download className="size-3.5" /> Download
                      </a>
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Run a pull first</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Step 3: import results */}
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            3 · Import results
          </div>
          {topCount != null && topCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-success font-medium">
              <CheckCircle2 className="size-3" /> {topCount} top customer{topCount === 1 ? "" : "s"} stored
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="rounded-lg border border-dashed border-border p-3 hover:bg-muted/40 cursor-pointer">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              model_metrics.json
            </div>
            <div className="text-xs text-muted-foreground mb-1">From <code className="font-mono">train.ipynb</code></div>
            <input
              type="file"
              accept="application/json,.json"
              className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:px-2 file:py-1"
              onChange={(e) => setMetricsFile(e.target.files?.[0] ?? null)}
            />
            {metricsFile && <div className="mt-1 text-[11px] font-mono">✓ {metricsFile.name}</div>}
          </label>

          <label className="rounded-lg border border-dashed border-border p-3 hover:bg-muted/40 cursor-pointer">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              top_50_customers.json
            </div>
            <div className="text-xs text-muted-foreground mb-1">From <code className="font-mono">score_top50.ipynb</code></div>
            <input
              type="file"
              accept="application/json,.json"
              className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:px-2 file:py-1"
              onChange={(e) => setTopFile(e.target.files?.[0] ?? null)}
            />
            {topFile && <div className="mt-1 text-[11px] font-mono">✓ {topFile.name}</div>}
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 mt-3">
          <p className="text-[11.5px] text-muted-foreground">
            Imported metrics light up the model KPIs above. Top-50 customers appear in{" "}
            <a href="/explainability" className="underline">
              Explainability
              <ExternalLink className="inline size-3 ml-0.5" />
            </a>
            .
          </p>
          <Button onClick={submitImport} disabled={importing || (!metricsFile && !topFile)}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Import
          </Button>
        </div>
      </div>
    </section>
  );
}
