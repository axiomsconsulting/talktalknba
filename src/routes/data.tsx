import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  Trash2,
  Database,
  Settings2,
  RefreshCw,
  AlertTriangle,
  Eye,
  Sparkles,
  Zap,
  Phone,
  XOctagon,
  Activity,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { parseFile } from "@/data/parseFile";
import {
  DEFAULT_MAPPING,
  detectColumns,
  mapCustomers,
  smartMapping,
  detectKindFromColumns,
  aggregateCalls,
  aggregateCease,
  aggregateUsage,
  type FieldMapping,
  type FileKind,
  type RawCustomerRow,
} from "@/data/customerMapping";
import { useCustomerStore } from "@/data/customerStore";
import { allCustomers as defaultCustomers } from "@/data/customers";
import { cn } from "@/lib/utils";


type DatasetRow = {
  id: string;
  filename: string;
  kind: FileKind;
  storage_path: string;
  row_count: number | null;
  byte_size: number | null;
  notes: string | null;
  is_active: boolean;
  uploaded_at: string;
};


export const Route = createFileRoute("/data")({
  head: () => ({
    meta: [
      { title: "Data Library — TalkTalk NBA" },
      {
        name: "description",
        content:
          "Upload customer_info.parquet or CSV extracts to override the mock customer list. Map columns, store raw files, and activate any version on demand.",
      },
      { property: "og:title", content: "Data Library — TalkTalk NBA" },
      {
        property: "og:description",
        content:
          "Centralised dataset library for the TalkTalk NBA showcase. Stores raw uploads and powers the live Explainability search.",
      },
    ],
  }),
  component: DataPage,
});

function DataPage() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { customers, source, setActive, reset } = useCustomerStore();

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from("customer_datasets")
      .select("*")
      .order("uploaded_at", { ascending: false });
    if (!error && data) setDatasets(data as DatasetRow[]);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Data · Library"
        title="Customer dataset library"
        description="Upload real extracts to replace the mock customer list. Files are stored centrally; you can switch between datasets at any time and the Explainability search will reflect the change."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        {/* Active source banner */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Database className="size-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Active customer source
              </div>
              <div className="text-base font-semibold text-foreground mt-0.5">
                {source.kind === "mock" ? (
                  <>Mock dataset · {customers.length} customers (6 personas + 50 generated)</>
                ) : (
                  <>
                    {source.filename} · {customers.length} customers loaded
                  </>
                )}
              </div>
              {source.kind === "uploaded" && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Activated {new Date(source.uploadedAt).toLocaleString("en-GB")}
                </div>
              )}
            </div>
          </div>
          {source.kind !== "mock" && (
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60"
            >
              <RefreshCw className="size-3.5" /> Restore mock dataset
            </button>
          )}
        </div>

        <UploadCard onUploaded={refresh} />

        <DatasetTable
          datasets={datasets}
          loading={loading}
          onChanged={refresh}
          onActivate={setActive}
          activeFilename={source.kind === "uploaded" ? source.filename : null}
        />
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload card with drag-and-drop, parsing, mapping UI
// ─────────────────────────────────────────────────────────────────────────────

type StagedFile = {
  file: File;
  rows: RawCustomerRow[];
  columns: string[];
  kind: FileKind;
};

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>(DEFAULT_MAPPING);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activateAfterUpload, setActivateAfterUpload] = useState(true);
  const [autoMatchedFields, setAutoMatchedFields] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const setActive = useCustomerStore((s) => s.setActive);
  const applyCalls = useCustomerStore((s) => s.applyCalls);
  const applyCease = useCustomerStore((s) => s.applyCease);
  const applyUsage = useCustomerStore((s) => s.applyUsage);

  function detectKind(file: File, columns: string[]): FileKind {
    // Filename hints first, then column-signature fallback.
    const n = file.name.toLowerCase();
    if (n.includes("calls")) return "calls";
    if (n.includes("cease")) return "cease";
    if (n.includes("usage")) return "usage";
    if (n.includes("customer")) return "customer_info";
    return detectKindFromColumns(columns);
  }

  async function handleFile(file: File) {
    setError(null);
    setStaged(null);
    setParsing(true);
    try {
      const { rows, columns } = await parseFile(file);
      if (rows.length === 0) throw new Error("File contains no rows.");
      const kind = detectKind(file, columns);
      setStaged({ file, rows, columns, kind });

      if (kind === "customer_info") {
        // Smart auto-mapping: pre-fill from alias matches against the schema.
        const m = smartMapping(columns);
        setMapping(m);
        const matchCount = (Object.keys(m) as Array<keyof FieldMapping>).filter(
          (k) => m[k] && columns.includes(m[k] as string)
        ).length;
        setAutoMatchedFields(matchCount);
      } else {
        setAutoMatchedFields(0);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function commit() {
    if (!staged) return;
    setUploading(true);
    setError(null);
    try {
      const stamp = Date.now();
      const safeName = staged.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${staged.kind}/${stamp}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("datasets")
        .upload(path, staged.file, { upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("customer_datasets").insert({
        filename: staged.file.name,
        kind: staged.kind,
        storage_path: path,
        row_count: staged.rows.length,
        byte_size: staged.file.size,
        is_active: activateAfterUpload && staged.kind === "customer_info",
        notes: null,
      });
      if (insErr) throw insErr;

      // Apply to the in-memory store based on file kind
      const src = {
        filename: staged.file.name,
        rowsAggregated: staged.rows.length,
        uploadedAt: new Date().toISOString(),
      };
      if (activateAfterUpload && staged.kind === "customer_info") {
        const mapped = mapCustomers(staged.rows, mapping);
        if (mapped.length > 0) setActive(mapped, staged.file.name);
      } else if (staged.kind === "calls") {
        applyCalls(aggregateCalls(staged.rows), src);
      } else if (staged.kind === "cease") {
        applyCease(aggregateCease(staged.rows), src);
      } else if (staged.kind === "usage") {
        applyUsage(aggregateUsage(staged.rows), src);
      }

      setStaged(null);
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }


  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Upload extract
        </div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">
          Add customer_info, calls, cease, usage or any related extract
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Accepts .csv and .parquet up to 50 MB. <span className="font-medium text-foreground">customer_info</span>{" "}
          replaces the live customer base; <span className="font-medium text-foreground">calls</span>,{" "}
          <span className="font-medium text-foreground">cease</span> and{" "}
          <span className="font-medium text-foreground">usage</span> enrich the SHAP drivers and
          NBA triggers without replacing it.
        </p>
      </div>

      <div className="p-5 sm:p-7">
        {!staged && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={cn(
              "rounded-xl border-2 border-dashed border-border p-10 flex flex-col items-center justify-center text-center",
              "bg-[var(--surface-sunken)]/40 transition-colors hover:border-primary/40 hover:bg-primary/5"
            )}
          >
            <div className="size-12 rounded-xl bg-gradient-to-br from-primary to-primary-deep flex items-center justify-center text-primary-foreground shadow-[var(--shadow-glow)]">
              {parsing ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <UploadCloud className="size-6" />
              )}
            </div>
            <div className="mt-4 text-base font-semibold text-foreground">
              {parsing ? "Parsing file…" : "Drag a file here, or browse"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              CSV · Parquet · max 50 MB
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.parquet,text/csv,application/octet-stream"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <FileSpreadsheet className="size-4" /> Browse file
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-md border border-[var(--risk-high)]/30 bg-[var(--risk-high)]/5 text-sm text-[var(--risk-high)] flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {staged && (
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/50 p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="size-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{staged.file.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {staged.rows.length.toLocaleString()} rows · {staged.columns.length} columns ·{" "}
                    {(staged.file.size / 1024).toFixed(1)} KB · detected as{" "}
                    <span className="font-mono text-foreground">{staged.kind}</span>
                  </div>
                  {staged.kind === "customer_info" && autoMatchedFields > 0 && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)] text-[10px] font-semibold uppercase tracking-wider border border-[var(--success)]/20">
                      <Sparkles className="size-3" /> Smart-mapped {autoMatchedFields}/12 fields
                    </div>
                  )}
                  {staged.kind !== "customer_info" && staged.kind !== "other" && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider border border-primary/20">
                      <Zap className="size-3" /> Will enrich active customer base
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setStaged(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            {staged.kind === "customer_info" && (
              <MappingEditor
                columns={staged.columns}
                mapping={mapping}
                onChange={setMapping}
                sampleRow={staged.rows[0]}
              />
            )}

            {staged.kind === "customer_info" && (
              <PreviewMapped
                rows={staged.rows}
                mapping={mapping}
              />
            )}

            {(staged.kind === "calls" || staged.kind === "cease" || staged.kind === "usage") && (
              <EnrichmentPreview kind={staged.kind} columns={staged.columns} rows={staged.rows} />
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={activateAfterUpload}
                  disabled={staged.kind === "other"}
                  onChange={(e) => setActivateAfterUpload(e.target.checked)}
                  className="size-4 accent-primary"
                />
                {staged.kind === "customer_info"
                  ? "Activate as live customer source after upload"
                  : staged.kind === "other"
                    ? "Store as reference only"
                    : `Apply ${staged.kind} enrichment to active customers`}
              </label>
              <button
                onClick={commit}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-gradient-to-r from-primary to-primary-deep text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-70"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {uploading ? "Uploading…" : "Save to library"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping editor — pick which column corresponds to each model field
// ─────────────────────────────────────────────────────────────────────────────

const MAPPING_FIELDS: Array<{ key: keyof FieldMapping; label: string; hint: string }> = [
  { key: "id", label: "Customer ID", hint: "Unique identifier per account" },
  { key: "package", label: "Package name", hint: "Used to derive ARPU" },
  { key: "tenureDays", label: "Tenure (days)", hint: "Strongest single retention signal" },
  { key: "contractStatus", label: "Contract status", hint: "Used to bucket OOC vs in-contract" },
  { key: "oocDays", label: "Days out of contract", hint: "Numeric, can be negative" },
  { key: "ddCancel60", label: "DD cancel (60d)", hint: "1/0 flag" },
  { key: "contractDdCancels", label: "DD cancels (lifetime)", hint: "Count" },
  { key: "speed", label: "Sold speed (Mbps)", hint: "Headline package speed" },
  { key: "lineSpeed", label: "Line speed (Mbps)", hint: "Realised throughput — drives speed deficit" },
  { key: "technology", label: "Technology", hint: "FTTC / FTTP / G.Fast / etc." },
  { key: "arpuOverride", label: "ARPU column (optional)", hint: "Override package-derived ARPU" },
  { key: "riskScoreOverride", label: "Pre-computed risk score (optional)", hint: "0–1 probability if you've trained externally" },
];

function MappingEditor({
  columns,
  mapping,
  onChange,
  sampleRow,
}: {
  columns: string[];
  mapping: FieldMapping;
  onChange: (m: FieldMapping) => void;
  sampleRow: RawCustomerRow;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 bg-[var(--surface-sunken)] border-b border-border flex items-center gap-2">
        <Settings2 className="size-4 text-primary" />
        <div className="text-sm font-semibold text-foreground">Column mapping</div>
        <div className="text-[11px] text-muted-foreground ml-auto">
          {columns.length} columns detected
        </div>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {MAPPING_FIELDS.map((f) => {
          const value = (mapping[f.key] as string | undefined) ?? "";
          const sample = value && sampleRow[value] != null ? String(sampleRow[value]) : "—";
          return (
            <div key={f.key} className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">{f.label}</label>
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={sample}>
                  e.g. {sample}
                </span>
              </div>
              <select
                value={value}
                onChange={(e) =>
                  onChange({ ...mapping, [f.key]: e.target.value || undefined })
                }
                className="w-full h-8 px-2 text-xs rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— not mapped —</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-muted-foreground">{f.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewMapped({
  rows,
  mapping,
}: {
  rows: RawCustomerRow[];
  mapping: FieldMapping;
}) {
  const preview = useMemo(() => mapCustomers(rows.slice(0, 200), mapping).slice(0, 5), [rows, mapping]);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 bg-[var(--surface-sunken)] border-b border-border flex items-center gap-2">
        <Eye className="size-4 text-primary" />
        <div className="text-sm font-semibold text-foreground">Mapping preview · first 5 customers</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">ID</th>
              <th className="px-3 py-2 text-left font-medium">Package</th>
              <th className="px-3 py-2 text-right font-medium">Tenure</th>
              <th className="px-3 py-2 text-right font-medium">OOC days</th>
              <th className="px-3 py-2 text-right font-medium">Risk</th>
              <th className="px-3 py-2 text-left font-medium">Tier</th>
              <th className="px-3 py-2 text-left font-medium">Top driver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {preview.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-mono text-foreground">{c.id}</td>
                <td className="px-3 py-2 text-foreground">{c.package}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(c.tenureDays / 365).toFixed(1)} yrs
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(c.shap.find((s) => s.feature === "ooc_days")?.detail ?? "").match(/-?\d+/)?.[0] ??
                    "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {(c.riskScore * 100).toFixed(0)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
                    style={{
                      background:
                        c.riskTier === "High"
                          ? "var(--risk-high)1a"
                          : c.riskTier === "Medium"
                            ? "var(--risk-medium)1a"
                            : "var(--risk-low)1a",
                      color:
                        c.riskTier === "High"
                          ? "var(--risk-high)"
                          : c.riskTier === "Medium"
                            ? "var(--risk-medium)"
                            : "var(--risk-low)",
                    }}
                  >
                    {c.riskTier}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground truncate max-w-[180px]">
                  {c.shap[0]?.label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset table
// ─────────────────────────────────────────────────────────────────────────────

function DatasetTable({
  datasets,
  loading,
  onChanged,
  onActivate,
  activeFilename,
}: {
  datasets: DatasetRow[];
  loading: boolean;
  onChanged: () => void;
  onActivate: (customers: ReturnType<typeof mapCustomers>, filename: string) => void;
  activeFilename: string | null;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function activate(d: DatasetRow) {
    if (d.kind !== "customer_info") {
      alert("Only customer_info datasets can be activated.");
      return;
    }
    setBusyId(d.id);
    try {
      const { data, error } = await supabase.storage.from("datasets").download(d.storage_path);
      if (error || !data) throw error ?? new Error("Download failed");
      const file = new File([data], d.filename, { type: data.type });
      const { rows } = await parseFile(file);
      const mapped = mapCustomers(rows, DEFAULT_MAPPING);
      if (mapped.length === 0) {
        alert("Could not map any customers from this file with the default mapping. Re-upload with a custom mapping.");
        return;
      }
      onActivate(mapped, d.filename);
    } catch (err) {
      alert(`Activation failed: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(d: DatasetRow) {
    if (!confirm(`Delete "${d.filename}" from the library?`)) return;
    setBusyId(d.id);
    try {
      await supabase.storage.from("datasets").remove([d.storage_path]);
      await supabase.from("customer_datasets").delete().eq("id", d.id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Library
        </div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Stored datasets</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every upload is kept here. Re-activate any version to swap the live customer source.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-medium">File</th>
              <th className="px-5 py-3 text-left font-medium">Kind</th>
              <th className="px-5 py-3 text-right font-medium">Rows</th>
              <th className="px-5 py-3 text-right font-medium">Size</th>
              <th className="px-5 py-3 text-left font-medium">Uploaded</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  <Loader2 className="size-4 animate-spin inline mr-2" /> Loading library…
                </td>
              </tr>
            )}
            {!loading && datasets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  No datasets uploaded yet. Drop a file above to get started.
                </td>
              </tr>
            )}
            {datasets.map((d) => {
              const isActive = activeFilename === d.filename;
              return (
                <tr key={d.id} className={cn("hover:bg-muted/30", isActive && "bg-primary/5")}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="size-4 text-primary shrink-0" />
                      <span className="font-medium text-foreground truncate">{d.filename}</span>
                      {isActive && (
                        <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-primary/10 text-primary border border-primary/20">
                          Active
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{d.kind}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                    {d.row_count?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                    {d.byte_size != null ? `${(d.byte_size / 1024).toFixed(0)} KB` : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground text-xs">
                    {new Date(d.uploaded_at).toLocaleString("en-GB")}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {d.kind === "customer_info" && (
                        <button
                          onClick={() => activate(d)}
                          disabled={busyId === d.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5 disabled:opacity-60"
                        >
                          {busyId === d.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-3" />
                          )}
                          Activate
                        </button>
                      )}
                      <button
                        onClick={() => remove(d)}
                        disabled={busyId === d.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-[var(--risk-high)] hover:bg-[var(--risk-high)]/5"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ensure default mock list is referenced so build doesn't tree-shake the import
void defaultCustomers;
