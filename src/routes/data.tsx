import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  
  Cloud,
  ExternalLink,
  PlayCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { parseFile } from "@/data/parseFile";
import {
  DEFAULT_MAPPING,
  detectKindFromColumns,
  mapCustomers,
  smartMapping,
  aggregateCalls,
  aggregateCease,
  aggregateUsage,
  type FieldMapping,
  type FileKind,
  type RawCustomerRow,
} from "@/data/customerMapping";
import { useCustomerStore } from "@/data/customerStore";
import { allCustomers as defaultCustomers } from "@/data/customers";
import { useFullBaseAggregate } from "@/data/fullBaseAggregate";
import { cn } from "@/lib/utils";
import { toast } from "sonner";


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

type ConnectionRow = {
  id: string;
  kind: "databricks" | "motherduck" | "local_upload" | "sample";
  name: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: "pending" | "running" | "success" | "error" | null;
  config: Record<string, unknown>;
};

export const Route = createFileRoute("/data")({
  head: () => ({
    meta: [
      { title: "Data Library — TalkTalk NBA" },
      {
        name: "description",
        content:
          "Pick a customer data source — Sample, Local upload, MotherDuck (live) or Databricks — and configure live integrations. Behavioural enrichment cards show what's currently powering the dashboards.",
      },
      { property: "og:title", content: "Data Library — TalkTalk NBA" },
      {
        property: "og:description",
        content:
          "Centralised data control plane: choose between sample, uploaded, MotherDuck-live or Databricks sources and see which signals are live.",
      },
    ],
  }),
  component: DataPage,
});

type SourceKey = "sample" | "upload" | "motherduck" | "databricks";

function DataPage() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { customers, source, reset } = useCustomerStore();
  const clearAll = useCustomerStore((s) => s.clearAll);
  const [selectedSource, setSelectedSource] = useState<SourceKey>(() => deriveInitialSource(source));
  const fullBase = useFullBaseAggregate();

  async function refresh() {
    setLoading(true);
    const [{ data: dsets }, { data: conns }] = await Promise.all([
      supabase.from("customer_datasets").select("*").order("uploaded_at", { ascending: false }),
      supabase.from("data_connections").select("id, kind, name, enabled, last_run_at, last_status, config"),
    ]);
    if (dsets) setDatasets(dsets as DatasetRow[]);
    if (conns) setConnections(conns as ConnectionRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Keep tabs in sync if the active source changes elsewhere
  useEffect(() => {
    setSelectedSource(deriveInitialSource(source));
  }, [source.kind, (source as { detail?: string }).detail]);

  const dbxConn = connections.find((c) => c.kind === "databricks");
  const mdConn = connections.find((c) => c.kind === "motherduck");
  const localConn = connections.find((c) => c.kind === "local_upload");
  const sampleConn = connections.find((c) => c.kind === "sample");

  // If every connector (incl. sample) is disabled — wipe all data and show empty state.
  // If sample is the only enabled source and the store is currently empty — restore sample.
  const allDisabled =
    connections.length > 0 &&
    !sampleConn?.enabled &&
    !mdConn?.enabled &&
    !dbxConn?.enabled &&
    !localConn?.enabled;

  useEffect(() => {
    if (!connections.length) return;
    if (allDisabled && source.kind !== "empty") {
      void clearAll();
    } else if (
      sampleConn?.enabled &&
      !mdConn?.enabled &&
      !dbxConn?.enabled &&
      !localConn?.enabled &&
      source.kind === "empty"
    ) {
      // Sample re-enabled while everything else is off → restore sample.
      reset();
    }
  }, [
    allDisabled,
    sampleConn?.enabled,
    mdConn?.enabled,
    dbxConn?.enabled,
    localConn?.enabled,
    source.kind,
    connections.length,
    reset,
    clearAll,
  ]);

  // Derive which source is currently powering the customer base.
  // Priority (highest → lowest): MotherDuck → Databricks → Local upload → Sample.
  // The first *enabled* source in this list wins, regardless of which detail
  // string the in-memory store currently carries — so toggling MotherDuck on
  // immediately re-labels every dashboard as "MotherDuck (live)".
  const activeSourceKey: SourceKey | "none" = useMemo(() => {
    if (mdConn?.enabled) return "motherduck";
    if (dbxConn?.enabled) return "databricks";
    if (localConn?.enabled && source.kind === "uploaded" && (source as { origin?: string }).origin !== "live") {
      return "upload";
    }
    if (sampleConn?.enabled) return "sample";
    if (source.kind === "empty") return "none";
    // Fallback: nothing enabled but store still carries something.
    if (source.kind === "uploaded") return "upload";
    return "sample";
  }, [
    source,
    mdConn?.enabled,
    dbxConn?.enabled,
    localConn?.enabled,
    sampleConn?.enabled,
  ]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Data · Control plane"
        title="Customer data sources"
        description="The single place to enable, disable and switch the live data source — sample, local upload, MotherDuck (live) or Databricks. Behavioural enrichment cards show which signals are live. Deep connector credentials live under Admin · Connector setup."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        {/* 1) ACTIVE SOURCES OVERVIEW */}
        <ActiveSourcesOverview
          activeSourceKey={activeSourceKey}
          customerCount={customers.length}
          source={source}
          dbxConn={dbxConn}
          mdConn={mdConn}
          localConn={localConn}
          sampleConn={sampleConn}
          onReset={reset}
          onJump={(k) => setSelectedSource(k)}
          fullBaseTotal={fullBase?.totalCustomers ?? null}
        />

        {/* 2) BEHAVIOURAL ENRICHMENT CARDS (top, always visible) */}
        <EnrichmentStatusPanel />

        {/* 3) SOURCE PICKER + INLINE CONFIGURATION */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 sm:px-7 py-5 border-b border-border">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Configure source
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              Pick a source and configure it
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Each tab below is a self-contained configuration surface. Activating a dataset from
              any source will swap the live customer base and refresh enrichment.
            </p>
          </div>

          <Tabs
            value={selectedSource}
            onValueChange={(v) => setSelectedSource(v as SourceKey)}
            className="px-5 sm:px-7 py-5"
          >
            <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full gap-2 h-auto bg-muted/40 p-1">
              <SourceTab
                value="sample"
                icon={Sparkles}
                label="Sample data"
                active={activeSourceKey === "sample"}
              />
              <SourceTab
                value="upload"
                icon={UploadCloud}
                label="Local upload"
                active={activeSourceKey === "upload"}
              />
              <SourceTab
                value="motherduck"
                icon={Cloud}
                label="MotherDuck (live)"
                active={activeSourceKey === "motherduck"}
                statusOk={!!mdConn?.enabled}
              />
              <SourceTab
                value="databricks"
                icon={Cloud}
                label="Databricks"
                active={activeSourceKey === "databricks"}
                statusOk={!!dbxConn?.enabled}
              />
            </TabsList>

            <TabsContent value="sample" className="mt-5 space-y-4">
              <SampleToggle conn={sampleConn} onChanged={refresh} />
              <SamplePanel
                isActive={activeSourceKey === "sample"}
                onActivate={reset}
                customerCount={customers.length}
                disabled={sampleConn?.enabled === false}
              />
            </TabsContent>

            <TabsContent value="upload" className="mt-5 space-y-4">
              <LocalUploadToggle conn={localConn} onChanged={refresh} />
              {localConn?.enabled !== false && <UploadCard onUploaded={refresh} />}
            </TabsContent>

            <TabsContent value="motherduck" className="mt-5">
              <MotherDuckLivePanel conn={mdConn} onChanged={refresh} />
            </TabsContent>

            <TabsContent value="databricks" className="mt-5">
              <LiveConnectionPanel
                kind="databricks"
                conn={dbxConn}
                onChanged={refresh}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* 4) STORED DATASET LIBRARY (shared by all sources) */}
        <DatasetTable
          datasets={datasets}
          loading={loading}
          onChanged={refresh}
          activeFilename={source.kind === "uploaded" ? source.filename : null}
        />
      </div>
    </AppShell>
  );
}

function deriveInitialSource(source: ReturnType<typeof useCustomerStore.getState>["source"]): SourceKey {
  if (source.kind === "mock") return "sample";
  const detail = (source as { detail?: string }).detail ?? "";
  if (detail.toLowerCase().includes("motherduck")) return "motherduck";
  if (detail.toLowerCase().includes("databricks")) return "databricks";
  return "upload";
}

// ─────────────────────────────────────────────────────────────────────────────
// Active sources overview — quick status of all 4 sources at a glance
// ─────────────────────────────────────────────────────────────────────────────

function ActiveSourcesOverview({
  activeSourceKey,
  customerCount,
  source,
  dbxConn,
  mdConn,
  localConn,
  sampleConn,
  onReset,
  onJump,
  fullBaseTotal,
}: {
  activeSourceKey: SourceKey | "none";
  customerCount: number;
  source: ReturnType<typeof useCustomerStore.getState>["source"];
  dbxConn: ConnectionRow | undefined;
  mdConn: ConnectionRow | undefined;
  localConn: ConnectionRow | undefined;
  sampleConn: ConnectionRow | undefined;
  onReset: () => void;
  onJump: (k: SourceKey) => void;
  /** Full-population customer total for MotherDuck (computed server-side). */
  fullBaseTotal: number | null;
}) {
  const cards: Array<{
    key: SourceKey;
    icon: typeof Sparkles;
    title: string;
    subtitle: string;
    status: "active" | "configured" | "available" | "not_configured";
  }> = [
    {
      key: "motherduck",
      icon: Cloud,
      title: "MotherDuck (live)",
      subtitle: mdConn?.enabled
        ? `Primary live source · ${mdConn.name}`
        : mdConn
          ? "Configured · disabled"
          : "Not configured",
      status:
        activeSourceKey === "motherduck"
          ? "active"
          : mdConn?.enabled
            ? "configured"
            : "not_configured",
    },
    {
      key: "databricks",
      icon: Cloud,
      title: "Databricks",
      subtitle: dbxConn?.enabled
        ? `Connected · ${dbxConn.name}`
        : "Not configured",
      status:
        activeSourceKey === "databricks"
          ? "active"
          : dbxConn?.enabled
            ? "configured"
            : "not_configured",
    },
    {
      key: "upload",
      icon: UploadCloud,
      title: "Local upload",
      subtitle:
        activeSourceKey === "upload" && source.kind === "uploaded"
          ? source.filename
          : localConn?.enabled === false
            ? "Disabled — toggle in Connections"
            : "CSV / Parquet, drop & map",
      status:
        activeSourceKey === "upload"
          ? "active"
          : localConn?.enabled
            ? "configured"
            : "not_configured",
    },
    {
      key: "sample",
      icon: Sparkles,
      title: "Sample data",
      subtitle: "6 personas + 50 generated customers (fallback)",
      status:
        activeSourceKey === "sample"
          ? "active"
          : sampleConn?.enabled
            ? "configured"
            : "not_configured",
    },
  ];

  const activeLabel =
    activeSourceKey === "none"
      ? "No source enabled"
      : activeSourceKey === "sample"
        ? "Sample data"
        : activeSourceKey === "upload"
          ? "Local upload"
          : activeSourceKey === "motherduck"
            ? "MotherDuck (live)"
            : "Databricks";

  const isEmpty = activeSourceKey === "none";

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "size-10 rounded-lg flex items-center justify-center shrink-0",
              isEmpty
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-primary/10 text-primary",
            )}
          >
            {isEmpty ? <AlertTriangle className="size-5" /> : <Database className="size-5" />}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Active customer source
            </div>
            <div className="text-base font-semibold text-foreground mt-0.5">
              {isEmpty
                ? `${activeLabel} · 0 customers loaded`
                : activeSourceKey === "motherduck" && fullBaseTotal && fullBaseTotal > customerCount
                  ? `${activeLabel} · ${customerCount.toLocaleString()} of ${fullBaseTotal.toLocaleString()} customers in working sample`
                  : `${activeLabel} · ${customerCount.toLocaleString()} customers loaded`}
            </div>
            {isEmpty ? (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Every connector — sample, local upload, MotherDuck and Databricks
                — is disabled. Enable at least one below to populate the dashboards.
              </div>
            ) : activeSourceKey === "motherduck" && fullBaseTotal ? (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Uniform random sample of the full {fullBaseTotal.toLocaleString()}-customer
                base. Headline KPIs (revenue-at-risk, segment counts) are computed
                server-side against the full population — sampling only affects the
                drill-down list and per-customer SHAP. Use the customer search on
                Explainability to look up any of the {fullBaseTotal.toLocaleString()} customers individually.
              </div>
            ) : source.kind === "uploaded" ? (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {(source as { detail?: string }).detail ?? source.filename} · activated{" "}
                {new Date(source.uploadedAt).toLocaleString("en-GB")}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Showing bundled sample dataset — switch to a real source below to override.
              </div>
            )}
          </div>
        </div>
        {activeSourceKey !== "sample" && activeSourceKey !== "none" && (
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60"
          >
            <RefreshCw className="size-3.5" /> Restore sample
          </button>
        )}
      </div>

      <div className="p-5 sm:p-7 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          const isActive = c.status === "active";
          return (
            <button
              key={c.key}
              onClick={() => onJump(c.key)}
              className={cn(
                "text-left rounded-lg border p-3 flex flex-col gap-2 transition-colors",
                isActive
                  ? "border-primary/40 bg-primary/5 shadow-[var(--shadow-sm)]"
                  : "border-border hover:border-primary/30 hover:bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "size-8 rounded-md flex items-center justify-center",
                    isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="text-sm font-semibold text-foreground truncate">{c.title}</div>
              </div>
              <div className="text-[11px] text-muted-foreground line-clamp-2">{c.subtitle}</div>
              <SourceStatusPill status={c.status} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SourceStatusPill({
  status,
}: {
  status: "active" | "configured" | "available" | "not_configured";
}) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    active: {
      label: "Active",
      cls: "border-primary/40 bg-primary/10 text-primary",
    },
    configured: {
      label: "Connected",
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    available: {
      label: "Available",
      cls: "border-border bg-muted/40 text-muted-foreground",
    },
    not_configured: {
      label: "Not configured",
      cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
  };
  const v = map[status];
  return (
    <span
      className={cn(
        "self-start inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border",
        v.cls,
      )}
    >
      {v.label}
    </span>
  );
}

function SourceTab({
  value,
  icon: Icon,
  label,
  active,
  statusOk,
}: {
  value: SourceKey;
  icon: typeof Sparkles;
  label: string;
  active: boolean;
  statusOk?: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className="data-[state=active]:bg-card data-[state=active]:shadow-[var(--shadow-sm)] data-[state=active]:text-foreground gap-2 py-2.5"
    >
      <Icon className="size-4" />
      <span className="font-medium">{label}</span>
      {active && (
        <span className="ml-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-primary/15 text-primary border border-primary/30">
          Active
        </span>
      )}
      {!active && statusOk && (
        <span className="ml-1 size-1.5 rounded-full bg-emerald-500 shrink-0" />
      )}
    </TabsTrigger>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample panel
// ─────────────────────────────────────────────────────────────────────────────

function SamplePanel({
  isActive,
  onActivate,
  customerCount,
  disabled = false,
}: {
  isActive: boolean;
  onActivate: () => void;
  customerCount: number;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/40 p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Sparkles className="size-5" />
        </div>
        <div>
          <div className="text-base font-semibold text-foreground">Bundled sample dataset</div>
          <p className="text-sm text-muted-foreground mt-0.5">
            6 hand-crafted personas plus 50 procedurally generated customers covering OOC,
            speed-deficit, loyalty-call and DD-cancel cohorts. Use this as a safe playground
            for the dashboards before connecting real data.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Personas", value: "6" },
          { label: "Generated", value: "50" },
          { label: "Total loaded", value: customerCount.toLocaleString() },
          { label: "Cost", value: "Free" },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
            <div className="mt-0.5 text-base font-semibold text-foreground tabular-nums">
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onActivate}
          disabled={isActive || disabled}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold",
            isActive || disabled
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-gradient-to-r from-primary to-primary-deep text-primary-foreground shadow-[var(--shadow-glow)]",
          )}
        >
          <CheckCircle2 className="size-4" />
          {disabled
            ? "Sample data disabled"
            : isActive
              ? "Sample data is active"
              : "Activate sample data"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample data connection toggle — mirrors the local-upload / live integration
// switches so admins can disable the bundled dataset entirely.
// ─────────────────────────────────────────────────────────────────────────────

function SampleToggle({
  conn,
  onChanged,
}: {
  conn: ConnectionRow | undefined;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const reset = useCustomerStore((s) => s.reset);
  const clearAll = useCustomerStore((s) => s.clearAll);
  useEffect(() => { setEnabled(conn?.enabled ?? true); }, [conn?.id, conn?.enabled]);

  async function toggle(value: boolean) {
    if (!conn) {
      toast.error("Sample connection row missing — please refresh");
      return;
    }
    setBusy(true);
    setEnabled(value);
    const { error } = await supabase
      .from("data_connections")
      .update({ enabled: value })
      .eq("id", conn.id);
    setBusy(false);
    if (error) {
      setEnabled(!value);
      toast.error(`Could not ${value ? "enable" : "disable"}: ${error.message}`);
      return;
    }
    if (value) {
      // Re-enabling sample restores the bundled personas immediately.
      reset();
    } else if (useCustomerStore.getState().source.kind === "mock") {
      // Disabling while sample was active → wipe so dashboards reflect reality.
      await clearAll();
    }
    toast.success(`Sample data ${value ? "enabled" : "disabled"}`);
    onChanged();
  }

  return (
    <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/40 p-4 sm:p-5 flex items-start gap-3">
      <div className="size-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold text-foreground">Sample data</div>
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border",
              enabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          The bundled 6 personas + 50 generated customers used as a safe playground when no
          live source is wired. Disable to force the dashboards to reflect only real data.
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <span>{enabled ? "On" : "Off"}</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local upload connection toggle — makes the dataset library behave like the
// other live integrations (enable/disable persists in data_connections).
// ─────────────────────────────────────────────────────────────────────────────

function LocalUploadToggle({
  conn,
  onChanged,
}: {
  conn: ConnectionRow | undefined;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEnabled(conn?.enabled ?? true); }, [conn?.id, conn?.enabled]);

  async function toggle(value: boolean) {
    if (!conn) {
      toast.error("Local upload connection row missing — please refresh");
      return;
    }
    setBusy(true);
    setEnabled(value);
    const { error } = await supabase
      .from("data_connections")
      .update({ enabled: value })
      .eq("id", conn.id);
    setBusy(false);
    if (error) {
      setEnabled(!value);
      toast.error(`Could not ${value ? "enable" : "disable"}: ${error.message}`);
      return;
    }
    if (!value) {
      // Disabling local upload also wipes any active upload-origin selection
      // so the dashboards stop reporting it as live.
      await useCustomerStore.getState().clearAllUploads();
    }
    toast.success(`Local upload ${value ? "enabled" : "disabled"}`);
    onChanged();
  }

  return (
    <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/40 p-4 sm:p-5 flex items-start gap-3">
      <div className="size-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <UploadCloud className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold text-foreground">Local upload</div>
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border",
              enabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Drag-and-drop CSV / Parquet files into the dataset library. Disable to hide the
          upload surface and clear any active upload-origin selection.
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <span>{enabled ? "On" : "Off"}</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live connection panel — Databricks
// ─────────────────────────────────────────────────────────────────────────────

function LiveConnectionPanel({
  kind,
  conn,
  onChanged,
}: {
  kind: "databricks";
  conn: ConnectionRow | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"test" | "ingest" | null>(null);
  const Icon = Cloud;
  const label = "Databricks";

  async function run(action: "test" | "ingest") {
    setBusy(action);
    try {
      const path = action === "test" ? "/api/admin/connections/test" : "/api/admin/connections/ingest";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = (await res.json()) as { error?: string; message?: string; files?: number };
      if (!res.ok) throw new Error(json.error ?? `${action} failed`);
      toast.success(
        action === "test"
          ? `${label} connection ok`
          : json.message ?? `Ingested ${json.files ?? 0} file(s) from ${label}`,
      );
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!conn) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-[var(--surface-sunken)]/40 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">{label} not configured</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Connect a Databricks workspace with a SQL warehouse so the platform can probe and pull your churn tables.
            </p>
          </div>
        </div>
        <Link
          to="/admin/connections"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-gradient-to-r from-primary to-primary-deep text-primary-foreground shadow-[var(--shadow-glow)]"
        >
          <Settings2 className="size-4" /> Configure {label}
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
    );
  }

  const lastRun = conn.last_run_at ? new Date(conn.last_run_at).toLocaleString("en-GB") : "Never";
  const cfgSummary = `Workspace: ${(conn.config as { host?: string }).host ?? "—"} · warehouse ${
    (conn.config as { warehouse_id?: string }).warehouse_id ?? "—"
  }`;

  return (
    <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/40 p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-base font-semibold text-foreground">{conn.name}</div>
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border",
                conn.enabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {conn.enabled ? "Enabled" : "Disabled"}
            </span>
            {conn.last_status && (
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border",
                  conn.last_status === "success"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : conn.last_status === "error"
                      ? "border-[var(--risk-high)]/40 bg-[var(--risk-high)]/10 text-[var(--risk-high)]"
                      : "border-border bg-muted/40 text-muted-foreground",
                )}
              >
                Last: {conn.last_status}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 break-all">{cfgSummary}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Last run: {lastRun}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <button
          onClick={() => run("test")}
          disabled={!!busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 disabled:opacity-60"
        >
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          Test connection
        </button>
        <button
          onClick={() => run("ingest")}
          disabled={!!busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5 disabled:opacity-60"
        >
          {busy === "ingest" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Pull now
        </button>
        <Link
          to="/admin/connections"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 ml-auto"
        >
          <Settings2 className="size-3.5" /> Advanced configure
          <ExternalLink className="size-3" />
        </Link>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Pulled files land in the <span className="font-medium text-foreground">Stored datasets</span>{" "}
        library below — activate any version to swap the live customer base or refresh enrichment.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MotherDuck live panel — query the online DB directly without pulling
// ─────────────────────────────────────────────────────────────────────────────

type LiveQueryResult = {
  results: Record<string, { headers: string[]; rows: unknown[][]; count: number }>;
  customerLimit: number;
};

function MotherDuckLivePanel({
  conn,
  onChanged,
}: {
  conn: ConnectionRow | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"test" | "query" | "toggle" | null>(null);
  const [limit, setLimit] = useState(50);
  const [enabled, setEnabled] = useState(conn?.enabled ?? false);
  const [lastResult, setLastResult] = useState<LiveQueryResult | null>(null);
  const setActive = useCustomerStore((s) => s.setActive);
  const applyCalls = useCustomerStore((s) => s.applyCalls);
  const applyCease = useCustomerStore((s) => s.applyCease);
  const applyUsage = useCustomerStore((s) => s.applyUsage);

  useEffect(() => {
    setEnabled(conn?.enabled ?? false);
  }, [conn?.id, conn?.enabled]);

  async function toggle(value: boolean) {
    if (!conn) {
      toast.error("Configure MotherDuck in Admin → Connections first");
      return;
    }
    setBusy("toggle");
    setEnabled(value); // optimistic
    const { error } = await supabase
      .from("data_connections")
      .update({ enabled: value })
      .eq("id", conn.id);
    setBusy(null);
    if (error) {
      setEnabled(!value);
      toast.error(`Could not ${value ? "enable" : "disable"}: ${error.message}`);
      return;
    }
    toast.success(`MotherDuck ${value ? "enabled" : "disabled"}`);
    onChanged();
  }

  async function callJson(path: string, body: unknown) {
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
      const msg = (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string")
        ? (json as { error: string }).error
        : text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async function testConnection() {
    setBusy("test");
    try {
      await callJson("/api/admin/connections/test", { kind: "motherduck" });
      toast.success("MotherDuck connection ok");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runLiveQuery() {
    setBusy("query");
    try {
      const res = (await callJson("/api/admin/connections/query-motherduck", {
        customerLimit: limit,
      })) as LiveQueryResult;
      setLastResult(res);

      // Hydrate the in-memory store directly — no Storage round-trip.
      const detail = `MotherDuck (live) · ${conn?.name ?? "MotherDuck"}`;
      const stamp = new Date().toISOString();

      const ci = res.results.customer_info;
      if (ci && ci.rows.length > 0) {
        const objects = ci.rows.map((r) => {
          const o: RawCustomerRow = {};
          ci.headers.forEach((h, i) => { o[h] = r[i] as RawCustomerRow[string]; });
          return o;
        });
        const mapped = mapCustomers(objects, DEFAULT_MAPPING);
        if (mapped.length > 0) {
          setActive(mapped, "MotherDuck (live)", "live", detail);
        }
      }

      const enrichFor = (kind: "calls" | "cease" | "usage") => {
        const r = res.results[kind];
        if (!r || r.rows.length === 0) return;
        const objects = r.rows.map((row) => {
          const o: RawCustomerRow = {};
          r.headers.forEach((h, i) => { o[h] = row[i] as RawCustomerRow[string]; });
          return o;
        });
        const src = {
          filename: `MotherDuck (live) · ${kind}`,
          rowsAggregated: objects.length,
          uploadedAt: stamp,
          origin: "live" as const,
          detail,
        };
        if (kind === "calls") applyCalls(aggregateCalls(objects), src);
        else if (kind === "cease") applyCease(aggregateCease(objects), src);
        else applyUsage(aggregateUsage(objects), src);
      };
      enrichFor("calls");
      enrichFor("cease");
      enrichFor("usage");

      toast.success(
        `Live query ok · ${ci?.count ?? 0} customers loaded directly from MotherDuck`,
      );
      onChanged();
    } catch (e) {
      toast.error(`Live query failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  if (!conn) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-[var(--surface-sunken)]/40 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">MotherDuck not configured</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Connect a MotherDuck database (online DuckDB) to query customer_info, calls, cease and
              usage tables directly — no pulls, no Storage round-trip.
            </p>
          </div>
        </div>
        <Link
          to="/admin/connections"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-gradient-to-r from-primary to-primary-deep text-primary-foreground shadow-[var(--shadow-glow)]"
        >
          <Settings2 className="size-4" /> Configure MotherDuck
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
    );
  }

  const cfg = conn.config as { database?: string; schema?: string; host?: string };
  const lastRun = conn.last_run_at ? new Date(conn.last_run_at).toLocaleString("en-GB") : "Never";

  return (
    <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/40 p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Cloud className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-base font-semibold text-foreground">{conn.name}</div>
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border",
                enabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {enabled ? "Enabled" : "Disabled"}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border border-primary/30 bg-primary/10 text-primary">
              Live query
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 break-all">
            {cfg.database ?? "—"} · {cfg.schema ?? "main"} · {cfg.host ?? "pg.us-east-1-aws.motherduck.com"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Last run: {lastRun}</div>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <span>{enabled ? "On" : "Off"}</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy === "toggle"}
            onChange={(e) => toggle(e.target.checked)}
            className="size-4 accent-primary"
          />
        </label>
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
        <strong>Live mode</strong> — when enabled, the dashboard queries MotherDuck on demand
        instead of pulling snapshots into Storage. Click <em>Run live query</em> to refresh the
        in-memory customer base directly from the online DuckDB.
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <label htmlFor="md-live-limit" className="text-[11px] font-medium text-foreground">
            Customer sample size
          </label>
          <input
            id="md-live-limit"
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="w-28 h-8 px-2 text-xs rounded-md border border-border bg-card"
          />
        </div>
        <div className="text-[11px] text-muted-foreground max-w-[320px]">
          1–500 random customer_info rows, with calls / cease / usage scoped to the same IDs.
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <button
          onClick={testConnection}
          disabled={!!busy || !enabled}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 disabled:opacity-60"
        >
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          Test connection
        </button>
        <button
          onClick={runLiveQuery}
          disabled={!!busy || !enabled}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5 disabled:opacity-60"
        >
          {busy === "query" ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          Run live query
        </button>
        <Link
          to="/admin/connections"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 ml-auto"
        >
          <Settings2 className="size-3.5" /> Advanced configure
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {lastResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          {(["customer_info", "calls", "cease", "usage"] as const).map((k) => {
            const r = lastResult.results[k];
            return (
              <div key={k} className="rounded-md border border-border bg-card px-2 py-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {k}
                </div>
                <div className="text-xs font-semibold text-foreground tabular-nums">
                  {r?.count?.toLocaleString() ?? 0} rows
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!enabled && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300">
          Live mode is off — toggle the switch above to enable querying.
        </div>
      )}
    </div>
  );
}

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
        const m = smartMapping(columns);
        setMapping(m);
        const matchCount = (Object.keys(m) as Array<keyof FieldMapping>).filter(
          (k) => m[k] && columns.includes(m[k] as string),
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

      const src = {
        filename: staged.file.name,
        rowsAggregated: staged.rows.length,
        uploadedAt: new Date().toISOString(),
        origin: "upload" as const,
        detail: `Stored upload · ${staged.file.name}`,
      };
      const persist = useCustomerStore.getState().persistActive;
      if (activateAfterUpload && staged.kind === "customer_info") {
        const mapped = mapCustomers(staged.rows, mapping);
        if (mapped.length > 0) {
          setActive(mapped, staged.file.name, "upload", `Stored upload · ${staged.file.name}`);
          await persist({ kind: "customer_info", origin: "upload", label: staged.file.name, rows: mapped.length });
        }
      } else if (staged.kind === "calls") {
        applyCalls(aggregateCalls(staged.rows), src);
        await persist({ kind: "calls", origin: "upload", label: staged.file.name, rows: staged.rows.length });
      } else if (staged.kind === "cease") {
        applyCease(aggregateCease(staged.rows), src);
        await persist({ kind: "cease", origin: "upload", label: staged.file.name, rows: staged.rows.length });
      } else if (staged.kind === "usage") {
        applyUsage(aggregateUsage(staged.rows), src);
        await persist({ kind: "usage", origin: "upload", label: staged.file.name, rows: staged.rows.length });
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
    <div className="rounded-lg border border-border bg-[var(--surface-sunken)]/40 overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-border">
        <div className="text-sm font-semibold text-foreground">
          Upload customer_info, calls, cease, usage or a related extract
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Accepts .csv and .parquet up to 50 MB.{" "}
          <span className="font-medium text-foreground">customer_info</span> replaces the live
          customer base; <span className="font-medium text-foreground">calls</span>,{" "}
          <span className="font-medium text-foreground">cease</span> and{" "}
          <span className="font-medium text-foreground">usage</span> enrich the SHAP drivers
          and NBA triggers without replacing it.
        </p>
      </div>

      <div className="p-5 sm:p-6">
        {!staged && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={cn(
              "rounded-xl border-2 border-dashed border-border p-10 flex flex-col items-center justify-center text-center",
              "bg-card transition-colors hover:border-primary/40 hover:bg-primary/5",
            )}
          >
            <div className="size-12 rounded-xl bg-gradient-to-br from-primary to-primary-deep flex items-center justify-center text-primary-foreground shadow-[var(--shadow-glow)]">
              {parsing ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
            </div>
            <div className="mt-4 text-base font-semibold text-foreground">
              {parsing ? "Parsing file…" : "Drag a file here, or browse"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">CSV · Parquet · max 50 MB</div>
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
            <div className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-3">
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
              <PreviewMapped rows={staged.rows} mapping={mapping} />
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
// Enrichment preview — small summary for calls / cease / usage uploads
// ─────────────────────────────────────────────────────────────────────────────

function EnrichmentPreview({
  kind,
  columns,
  rows,
}: {
  kind: "calls" | "cease" | "usage";
  columns: string[];
  rows: RawCustomerRow[];
}) {
  const summary = useMemo(() => {
    if (kind === "calls") {
      const m = aggregateCalls(rows);
      let totalLoyalty = 0;
      let totalHold = 0;
      for (const v of m.values()) {
        totalLoyalty += v.loyaltyCalls90d;
        totalHold += v.totalHoldSeconds;
      }
      return [
        { label: "Unique customers", value: m.size.toLocaleString() },
        { label: "Loyalty calls (sum)", value: totalLoyalty.toLocaleString() },
        { label: "Total hold time", value: `${Math.round(totalHold / 60).toLocaleString()} min` },
      ];
    }
    if (kind === "cease") {
      const m = aggregateCease(rows);
      const insights: Record<string, number> = {};
      for (const v of m.values()) insights[v.insight ?? "Other"] = (insights[v.insight ?? "Other"] ?? 0) + 1;
      const top = Object.entries(insights).sort((a, b) => b[1] - a[1])[0];
      return [
        { label: "Unique customers", value: m.size.toLocaleString() },
        { label: "Distinct insights", value: Object.keys(insights).length.toString() },
        { label: "Top reason", value: top ? `${top[0]} · ${top[1]}` : "—" },
      ];
    }
    const m = aggregateUsage(rows);
    let totalDl = 0;
    for (const v of m.values()) totalDl += v.monthlyDownloadGb;
    return [
      { label: "Unique customers", value: m.size.toLocaleString() },
      { label: "Avg download / mo", value: m.size ? `${Math.round(totalDl / m.size)} GB` : "0 GB" },
      { label: "Aggregated rows", value: rows.length.toLocaleString() },
    ];
  }, [kind, rows]);

  const Icon = kind === "calls" ? Phone : kind === "cease" ? XOctagon : Activity;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 bg-[var(--surface-sunken)] border-b border-border flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <div className="text-sm font-semibold text-foreground capitalize">{kind} aggregation preview</div>
        <div className="text-[11px] text-muted-foreground ml-auto">
          {columns.length} columns · {rows.length.toLocaleString()} rows
        </div>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.map((r) => (
          <div key={r.label} className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {r.label}
            </div>
            <div className="mt-0.5 text-base font-semibold text-foreground tabular-nums">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Behavioural enrichment status — calls / cease / usage tiles
// ─────────────────────────────────────────────────────────────────────────────

function EnrichmentStatusPanel() {
  const callsSource = useCustomerStore((s) => s.callsSource);
  const ceaseSource = useCustomerStore((s) => s.ceaseSource);
  const usageSource = useCustomerStore((s) => s.usageSource);
  const callsMap = useCustomerStore((s) => s.callsMap);
  const ceaseMap = useCustomerStore((s) => s.ceaseMap);
  const usageMap = useCustomerStore((s) => s.usageMap);
  const clear = useCustomerStore((s) => s.clearEnrichment);

  const callsStats = useMemo(() => {
    let totalLoyalty = 0;
    let totalHold = 0;
    let totalTalk = 0;
    for (const v of callsMap.values()) {
      totalLoyalty += v.loyaltyCalls90d;
      totalHold += v.totalHoldSeconds;
      totalTalk += v.totalTalkSeconds;
    }
    return { totalLoyalty, totalHold, totalTalk };
  }, [callsMap]);

  const ceaseStats = useMemo(() => {
    const insights: Record<string, number> = {};
    for (const v of ceaseMap.values()) insights[v.insight ?? "Other"] = (insights[v.insight ?? "Other"] ?? 0) + 1;
    const top = Object.entries(insights).sort((a, b) => b[1] - a[1])[0];
    return { distinct: Object.keys(insights).length, top };
  }, [ceaseMap]);

  const usageStats = useMemo(() => {
    let totalDl = 0;
    let totalUl = 0;
    for (const v of usageMap.values()) {
      totalDl += v.monthlyDownloadGb;
      totalUl += v.monthlyUploadGb;
    }
    const n = usageMap.size || 1;
    return { avgDl: Math.round(totalDl / n), avgUl: Math.round(totalUl / n) };
  }, [usageMap]);

  const tiles = [
    {
      kind: "calls" as const,
      icon: Phone,
      title: "Calls extract",
      description: "Loyalty calls, hold time, talk time, preferred channel",
      source: callsSource,
      size: callsMap.size,
      metrics: callsSource
        ? [
            { label: "Loyalty calls (sum)", value: callsStats.totalLoyalty.toLocaleString() },
            { label: "Hold time", value: `${Math.round(callsStats.totalHold / 60).toLocaleString()} min` },
            { label: "Talk time", value: `${Math.round(callsStats.totalTalk / 60).toLocaleString()} min` },
          ]
        : [],
    },
    {
      kind: "cease" as const,
      icon: XOctagon,
      title: "Cease extract",
      description: "Reason-description insight (e.g. CompetitorDeals)",
      source: ceaseSource,
      size: ceaseMap.size,
      metrics: ceaseSource
        ? [
            { label: "Distinct insights", value: ceaseStats.distinct.toString() },
            { label: "Top reason", value: ceaseStats.top ? `${ceaseStats.top[0]}` : "—" },
            { label: "Top count", value: ceaseStats.top ? ceaseStats.top[1].toLocaleString() : "—" },
          ]
        : [],
    },
    {
      kind: "usage" as const,
      icon: Activity,
      title: "Usage extract",
      description: "Monthly download / upload vs package capacity",
      source: usageSource,
      size: usageMap.size,
      metrics: usageSource
        ? [
            { label: "Avg download / mo", value: `${usageStats.avgDl} GB` },
            { label: "Avg upload / mo", value: `${usageStats.avgUl} GB` },
            { label: "Customers", value: usageMap.size.toLocaleString() },
          ]
        : [],
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Behavioural enrichment
        </div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Calls · cease · usage signals</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          These signals are layered on top of whichever source is active. Activate an extract from
          the library below — or pull a fresh one from a live integration — and it will be aggregated
          by customer ID and folded into the SHAP waterfall and NBA trigger derivation.
        </p>
      </div>
      <div className="p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          const active = !!t.source;
          return (
            <div
              key={t.kind}
              className={cn(
                "rounded-lg border p-4 flex flex-col gap-2",
                active ? "border-primary/30 bg-primary/5" : "border-dashed border-border bg-[var(--surface-sunken)]/40",
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "size-9 rounded-md flex items-center justify-center",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{t.description}</div>
                </div>
                {active && (
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border shrink-0",
                      t.source!.origin === "live"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {t.source!.origin === "live" ? "Live · Active" : "Upload · Active"}
                  </span>
                )}
              </div>
              {active ? (
                <>
                  <div className="text-[11px] text-foreground truncate">
                    <span className="font-mono text-primary">{t.source!.filename}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.source!.detail ?? (t.source!.origin === "live" ? "Live integration" : "Stored upload")} ·{" "}
                    {t.size.toLocaleString()} customers enriched · activated{" "}
                    {new Date(t.source!.uploadedAt).toLocaleString("en-GB")}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {t.metrics.map((m) => (
                      <div key={m.label} className="rounded-md border border-border bg-card px-2 py-1.5">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                          {m.label}
                        </div>
                        <div
                          className="text-xs font-semibold text-foreground tabular-nums truncate"
                          title={m.value}
                        >
                          {m.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => clear(t.kind)}
                    className="mt-1 text-[11px] text-muted-foreground hover:text-[var(--risk-high)] inline-flex items-center gap-1 self-start"
                  >
                    <Trash2 className="size-3" /> Clear enrichment
                  </button>
                </>
              ) : (
                <div className="text-[11px] text-muted-foreground italic">
                  No {t.kind} extract loaded — upload one or activate a stored {t.kind} file from the library.
                </div>
              )}
            </div>
          );
        })}
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
  {
    key: "riskScoreOverride",
    label: "Pre-computed risk score (optional)",
    hint: "0–1 probability if you've trained externally",
  },
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
                onChange={(e) => onChange({ ...mapping, [f.key]: e.target.value || undefined })}
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
                  {(c.shap.find((s) => s.feature === "ooc_days")?.detail ?? "").match(/-?\d+/)?.[0] ?? "—"}
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
  activeFilename,
}: {
  datasets: DatasetRow[];
  loading: boolean;
  onChanged: () => void;
  activeFilename: string | null;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const setActive = useCustomerStore((s) => s.setActive);
  const applyCalls = useCustomerStore((s) => s.applyCalls);
  const applyCease = useCustomerStore((s) => s.applyCease);
  const applyUsage = useCustomerStore((s) => s.applyUsage);
  const callsSource = useCustomerStore((s) => s.callsSource);
  const ceaseSource = useCustomerStore((s) => s.ceaseSource);
  const usageSource = useCustomerStore((s) => s.usageSource);

  function isActiveFor(d: DatasetRow): boolean {
    if (d.kind === "customer_info") return activeFilename === d.filename;
    if (d.kind === "calls") return callsSource?.filename === d.filename;
    if (d.kind === "cease") return ceaseSource?.filename === d.filename;
    if (d.kind === "usage") return usageSource?.filename === d.filename;
    return false;
  }

  async function activate(d: DatasetRow) {
    if (d.kind === "other") {
      alert("Reference files cannot be activated.");
      return;
    }
    setBusyId(d.id);
    try {
      const { data, error } = await supabase.storage.from("datasets").download(d.storage_path);
      if (error || !data) throw error ?? new Error("Download failed");
      const file = new File([data], d.filename, { type: data.type });
      const { rows } = await parseFile(file);

      const persist = useCustomerStore.getState().persistActive;
      if (d.kind === "customer_info") {
        const mapped = mapCustomers(rows, DEFAULT_MAPPING);
        if (mapped.length === 0) {
          alert(
            "Could not map any customers from this file with the default mapping. Re-upload with a custom mapping.",
          );
          return;
        }
        setActive(mapped, d.filename, "upload", `Stored upload · ${d.filename}`);
        await persist({
          kind: "customer_info",
          origin: "upload",
          label: d.filename,
          rows: mapped.length,
          datasetId: d.id,
        });
      } else {
        const src = {
          filename: d.filename,
          rowsAggregated: rows.length,
          uploadedAt: new Date().toISOString(),
          origin: "upload" as const,
          detail: `Stored upload · ${d.filename}`,
        };
        if (d.kind === "calls") {
          applyCalls(aggregateCalls(rows), src);
          await persist({ kind: "calls", origin: "upload", label: d.filename, rows: rows.length, datasetId: d.id });
        } else if (d.kind === "cease") {
          applyCease(aggregateCease(rows), src);
          await persist({ kind: "cease", origin: "upload", label: d.filename, rows: rows.length, datasetId: d.id });
        } else if (d.kind === "usage") {
          applyUsage(aggregateUsage(rows), src);
          await persist({ kind: "usage", origin: "upload", label: d.filename, rows: rows.length, datasetId: d.id });
        }
      }
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

      // If the file we just removed was powering an active enrichment or the
      // live customer base, drop it from the persisted active sources too so
      // the dashboards stop pretending it's still loaded.
      const wasActive = isActiveFor(d);
      if (wasActive) {
        await supabase.from("active_data_sources").delete().eq("kind", d.kind);
      }

      // After delete, check whether the dataset library is now empty. If so,
      // wipe every upload-origin selection and auto-disable the "Local upload"
      // connection so the UI stops advertising it as a live source.
      const { data: remaining } = await supabase
        .from("customer_datasets")
        .select("id")
        .limit(1);
      if (!remaining || remaining.length === 0) {
        await useCustomerStore.getState().clearAllUploads();
        await supabase
          .from("data_connections")
          .update({ enabled: false })
          .eq("kind", "local_upload");
        toast.success("Library cleared — local upload deactivated, sample data restored");
      } else if (wasActive) {
        // Library still has files but we just removed the active one — fall
        // back to sample until the user activates another.
        useCustomerStore.getState().reset();
        toast.success("Active dataset removed — restored sample data");
      }

      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 sm:px-7 py-5 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Library</div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Stored datasets</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every upload — or pull from a live integration — is kept here. Activate any version to
          swap the live customer source or refresh the calls / cease / usage enrichment.
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
                  No datasets uploaded yet. Drop a file in the Local upload tab or pull from a
                  live integration to get started.
                </td>
              </tr>
            )}
            {datasets.map((d) => {
              const isActive = isActiveFor(d);
              const canActivate = d.kind !== "other";
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
                      {canActivate && !isActive && (
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
