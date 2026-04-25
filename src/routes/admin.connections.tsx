import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  Database,
  Save,
  PlayCircle,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Cpu,
  Plug,
  Download,
  StopCircle,
  Cloud,
  UploadCloud,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/data/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/connections")({
  head: () => ({ meta: [{ title: "Live data connections — TalkTalk NBA" }] }),
  component: ConnectionsAdminPage,
});

type ConnectionKind = "databricks" | "motherduck" | "local_upload" | "sample";
type RunStatus = "pending" | "running" | "success" | "error";

type DatabricksQuery = { kind: string; sql: string };
type DatabricksConfig = {
  host?: string;
  warehouse_id?: string;
  job_id?: string;
  queries?: DatabricksQuery[];
};
type MotherDuckConfig = {
  database?: string;
  schema?: string;
  host?: string;
  port?: number;
  tables?: Partial<Record<"customer_info" | "calls" | "cease" | "usage", string>>;
};

type Connection = {
  id: string;
  kind: ConnectionKind;
  name: string;
  config:
    | DatabricksConfig
    | MotherDuckConfig
    | Record<string, unknown>;
  schedule_cron: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_status: RunStatus | null;
  last_error: string | null;
  updated_at: string;
};

type SourceFile = {
  id: string;
  connection_id: string;
  kind: string;
  remote_id: string;
  remote_name: string | null;
  remote_modified_at: string | null;
  bytes: number | null;
  last_seen_at: string;
  last_ingested_at: string | null;
};

type ModelRun = {
  id: string;
  status: RunStatus;
  triggered_by: string | null;
  databricks_run_id: string | null;
  finished_at: string | null;
  started_at: string;
  error: string | null;
};

type PullJob = {
  id: string;
  status: "queued" | "downloading" | "parsing" | "uploading" | "done" | "error" | "cancelled";
  files_total: number;
  files_done: number;
  current_kind: string | null;
  current_file: string | null;
  current_bytes_total: number | null;
  current_bytes_done: number | null;
  current_rows_read: number | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  summary: Record<string, { rows?: number; bytes: number; format?: string; note?: string }> | null;
  error: string | null;
};


function StatusBadge({ status }: { status: RunStatus | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="size-3" /> Never run
      </Badge>
    );
  }
  const map: Record<RunStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground border-border", Icon: Clock },
    running: { label: "Running", cls: "bg-chart-4/15 text-chart-4 border-chart-4/30", Icon: Loader2 },
    success: { label: "Success", cls: "bg-success/15 text-success border-success/30", Icon: CheckCircle2 },
    error: { label: "Error", cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
  };
  const { label, cls, Icon } = map[status];
  return (
    <Badge variant="outline" className={`gap-1 ${cls}`}>
      <Icon className={`size-3 ${status === "running" ? "animate-spin" : ""}`} /> {label}
    </Badge>
  );
}

async function callServer(path: string, body: unknown) {
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
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : null) ?? text ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function ConnectionsAdminPage() {
  const { isAdmin, loading } = useAuth();
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    const [{ data: c }, { data: f }, { data: r }] = await Promise.all([
      supabase.from("data_connections").select("*").order("kind"),
      supabase.from("data_source_files").select("*").order("last_seen_at", { ascending: false }).limit(50),
      supabase.from("model_runs").select("*").order("started_at", { ascending: false }).limit(10),
    ]);
    setConns((c as Connection[]) ?? []);
    setFiles((f as SourceFile[]) ?? []);
    setRuns((r as ModelRun[]) ?? []);
  };

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin]);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" />;

  const upsert = async (kind: ConnectionKind, patch: Partial<Connection>) => {
    setBusy(kind);
    const existing = conns?.find((c) => c.kind === kind);
    const defaultName =
      kind === "databricks"
        ? "Databricks"
        : kind === "motherduck"
          ? "MotherDuck"
          : kind === "local_upload"
            ? "Local upload"
            : "Sample data";
    const payload = {
      kind,
      name: patch.name ?? existing?.name ?? defaultName,
      config: (patch.config ?? existing?.config ?? {}) as never,
      schedule_cron: patch.schedule_cron ?? existing?.schedule_cron ?? null,
      enabled: patch.enabled ?? existing?.enabled ?? true,
    };
    const { error } = existing
      ? await supabase.from("data_connections").update(payload).eq("id", existing.id)
      : await supabase.from("data_connections").insert(payload);
    setBusy(null);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success(`${defaultName} connection saved`);
    await reload();
  };

  /** Persist just the enabled flag immediately when the toggle changes. */
  const toggleEnabled = async (kind: ConnectionKind, value: boolean) => {
    const existing = conns?.find((c) => c.kind === kind);
    if (!existing) {
      // No row yet — fall back to a full upsert so the toggle still persists.
      await upsert(kind, { enabled: value });
      return;
    }
    // Optimistic local update
    setConns((prev) =>
      (prev ?? []).map((c) => (c.id === existing.id ? { ...c, enabled: value } : c)),
    );
    const { error } = await supabase
      .from("data_connections")
      .update({ enabled: value })
      .eq("id", existing.id);
    if (error) {
      toast.error(`Could not ${value ? "enable" : "disable"}: ${error.message}`);
      await reload();
      return;
    }
    toast.success(`${existing.name} ${value ? "enabled" : "disabled"}`);
  };

  const test = async (kind: ConnectionKind) => {
    setBusy(`${kind}-test`);
    try {
      await callServer(`/api/admin/connections/test`, { kind });
      toast.success("Connection test ok");
      await reload();
    } catch (e) {
      toast.error(`Test failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const ingest = async (kind: ConnectionKind) => {
    setBusy(`${kind}-ingest`);
    try {
      const res = (await callServer(`/api/admin/connections/ingest`, { kind })) as {
        files?: number;
        message?: string;
      } | null;
      toast.success(res?.message ?? `Ingested ${res?.files ?? 0} file(s)`);
      await reload();
    } catch (e) {
      toast.error(`Ingest failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const [pullJob, setPullJob] = useState<PullJob | null>(null);

  const refreshPullJob = async (jobId?: string) => {
    try {
      const res = (await callServer(`/api/admin/connections/pull-status`, jobId ? { jobId } : {})) as {
        job: PullJob | null;
      } | null;
      setPullJob(res?.job ?? null);
      return res?.job ?? null;
    } catch {
      return null;
    }
  };

  // Poll while a job is active
  useEffect(() => {
    if (!pullJob) return;
    const active = ["queued", "downloading", "parsing", "uploading"].includes(pullJob.status);
    if (!active) return;
    const t = setInterval(() => {
      void refreshPullJob(pullJob.id);
    }, 2000);
    return () => clearInterval(t);
  }, [pullJob?.id, pullJob?.status]);

  // On mount: hydrate latest job (so progress survives a refresh)
  useEffect(() => {
    if (isAdmin) void refreshPullJob();
  }, [isAdmin]);

  const pullAzure = async () => {
    setBusy("azure_repo-pull");
    try {
      const res = (await callServer(`/api/admin/connections/pull-azure`, {})) as {
        jobId?: string;
        filesTotal?: number;
      } | null;
      if (res?.jobId) {
        toast.success(`Queued — ${res.filesTotal ?? 0} file(s) to pull`);
        await refreshPullJob(res.jobId);
      }
      await reload();
    } catch (e) {
      toast.error(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const pullMotherduck = async (customerLimit?: number) => {
    setBusy("motherduck-pull");
    try {
      const res = (await callServer(`/api/admin/connections/pull-motherduck`, {
        customerLimit: customerLimit ?? null,
      })) as {
        jobId?: string;
        filesTotal?: number;
      } | null;
      if (res?.jobId) {
        toast.success(`Queued — ${res.filesTotal ?? 0} table(s) to pull`);
        await refreshPullJob(res.jobId);
      }
      await reload();
    } catch (e) {
      toast.error(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const cancelPull = async () => {
    if (!pullJob) return;
    setBusy("azure_repo-cancel");
    try {
      await callServer(`/api/admin/connections/cancel-pull`, { jobId: pullJob.id });
      toast.success("Pull cancelled");
      await refreshPullJob(pullJob.id);
    } catch (e) {
      toast.error(`Cancel failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const trigger = async () => {
    setBusy("retrain");
    try {
      const res = (await callServer(`/api/admin/connections/retrain`, {})) as {
        run_id?: string;
        databricks_run_id?: string;
        message?: string;
      } | null;
      toast.success(res?.message ?? `Training run queued (${res?.databricks_run_id ?? res?.run_id ?? "ok"})`);
      await reload();
    } catch (e) {
      toast.error(`Retrain failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const dbx = (conns ?? []).find((c) => c.kind === "databricks");
  const gdr = (conns ?? []).find((c) => c.kind === "gdrive");
  const azr = (conns ?? []).find((c) => c.kind === "azure_repo");
  const mdr = (conns ?? []).find((c) => c.kind === "motherduck");
  const lup = (conns ?? []).find((c) => c.kind === "local_upload");
  const smp = (conns ?? []).find((c) => c.kind === "sample");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin · Advanced setup"
        title="Connector configuration"
        description={
          <>
            Deep configuration for each data connector — credentials, schemas, file paths and pull
            jobs. For day-to-day source switching and toggles, use the{" "}
            <Link to="/data" className="text-primary underline-offset-2 hover:underline">
              Data control plane
            </Link>
            .
          </>
        }
      />

      <Tabs defaultValue="azure_repo" className="mt-6">
        <TabsList>
          <TabsTrigger value="azure_repo" className="gap-2">
            <GitBranch className="size-4" /> Azure DevOps
          </TabsTrigger>
          <TabsTrigger value="motherduck" className="gap-2">
            <Cloud className="size-4" /> MotherDuck
          </TabsTrigger>
          <TabsTrigger value="databricks" className="gap-2">
            <Database className="size-4" /> Databricks
          </TabsTrigger>
          <TabsTrigger value="gdrive" className="gap-2">
            <HardDrive className="size-4" /> Google Drive
          </TabsTrigger>
          <TabsTrigger value="local_upload" className="gap-2">
            <UploadCloud className="size-4" /> Local upload
          </TabsTrigger>
          <TabsTrigger value="sample" className="gap-2">
            <Sparkles className="size-4" /> Sample data
          </TabsTrigger>
          <TabsTrigger value="status" className="gap-2">
            <Cpu className="size-4" /> Status & runs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="azure_repo" className="mt-4">
          <AzurePanel
            conn={azr}
            busy={busy}
            onSave={(patch) => upsert("azure_repo", patch)}
            onToggleEnabled={(v) => toggleEnabled("azure_repo", v)}
            onIngest={() => ingest("azure_repo")}
            onPull={pullAzure}
            onCancel={cancelPull}
            pullJob={pullJob}
          />
        </TabsContent>

        <TabsContent value="motherduck" className="mt-4">
          <MotherDuckPanel
            conn={mdr}
            busy={busy}
            onSave={(patch) => upsert("motherduck", patch)}
            onToggleEnabled={(v) => toggleEnabled("motherduck", v)}
            onTest={() => test("motherduck")}
            onPull={pullMotherduck}
            onCancel={cancelPull}
            pullJob={pullJob}
          />
        </TabsContent>

        <TabsContent value="databricks" className="mt-4">
          <DatabricksPanel
            conn={dbx}
            busy={busy}
            onSave={(patch) => upsert("databricks", patch)}
            onToggleEnabled={(v) => toggleEnabled("databricks", v)}
            onTest={() => test("databricks")}
            onIngest={() => ingest("databricks")}
            onRetrain={trigger}
          />
        </TabsContent>

        <TabsContent value="gdrive" className="mt-4">
          <GDrivePanel
            conn={gdr}
            busy={busy}
            onSave={(patch) => upsert("gdrive", patch)}
            onToggleEnabled={(v) => toggleEnabled("gdrive", v)}
            onTest={() => test("gdrive")}
            onIngest={() => ingest("gdrive")}
          />
        </TabsContent>

        <TabsContent value="local_upload" className="mt-4">
          <LocalUploadAdminPanel
            conn={lup}
            busy={busy}
            onToggleEnabled={(v) => toggleEnabled("local_upload", v)}
          />
        </TabsContent>

        <TabsContent value="sample" className="mt-4">
          <SampleAdminPanel
            conn={smp}
            busy={busy}
            onToggleEnabled={(v) => toggleEnabled("sample", v)}
          />
        </TabsContent>

        <TabsContent value="status" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCcw className="size-4" /> Recent ingestion (last 50 files)
              </CardTitle>
              <CardDescription>
                Files spotted in the source connections, with the last time each was re-fetched.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No files seen yet. Save a connection and run "Ingest now" to populate this list.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/60">
                        <th className="text-left py-2 font-medium">Kind</th>
                        <th className="text-left py-2 font-medium">Remote name</th>
                        <th className="text-left py-2 font-medium">Bytes</th>
                        <th className="text-left py-2 font-medium">Last seen</th>
                        <th className="text-left py-2 font-medium">Last ingested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr key={f.id} className="border-b border-border/30">
                          <td className="py-2"><Badge variant="outline">{f.kind}</Badge></td>
                          <td className="py-2 font-mono text-xs">{f.remote_name ?? f.remote_id}</td>
                          <td className="py-2">{f.bytes ? `${(f.bytes / 1024 / 1024).toFixed(1)} MB` : "—"}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {new Date(f.last_seen_at).toLocaleString()}
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {f.last_ingested_at ? new Date(f.last_ingested_at).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4" /> Model training runs
              </CardTitle>
              <CardDescription>
                Each row is a Databricks job run. The dashboard always shows the latest{" "}
                <code className="font-mono">success</code> row.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No training runs yet. Once a Databricks job posts results to{" "}
                  <code className="font-mono">/api/public/ingest/artefacts</code>, runs appear here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/60">
                        <th className="text-left py-2 font-medium">Status</th>
                        <th className="text-left py-2 font-medium">Triggered by</th>
                        <th className="text-left py-2 font-medium">Databricks run</th>
                        <th className="text-left py-2 font-medium">Started</th>
                        <th className="text-left py-2 font-medium">Finished</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id} className="border-b border-border/30">
                          <td className="py-2"><StatusBadge status={r.status} /></td>
                          <td className="py-2 text-xs">{r.triggered_by ?? "—"}</td>
                          <td className="py-2 font-mono text-xs">{r.databricks_run_id ?? "—"}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {new Date(r.started_at).toLocaleString()}
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground flex items-center gap-2">
              <Plug className="size-4" />
              Looking for the file library / one-off uploads?{" "}
              <Link to="/data" className="text-primary hover:underline">Open Data Library</Link>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// ---------- Databricks panel ----------

function DatabricksPanel({
  conn,
  busy,
  onSave,
  onToggleEnabled,
  onTest,
  onIngest,
  onRetrain,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
  onToggleEnabled: (value: boolean) => void;
  onTest: () => void;
  onIngest: () => void;
  onRetrain: () => void;
}) {
  const cfg = (conn?.config as DatabricksConfig | undefined) ?? {};
  const [host, setHost] = useState(cfg.host ?? "");
  const [warehouseId, setWarehouseId] = useState(cfg.warehouse_id ?? "");
  const [jobId, setJobId] = useState(cfg.job_id ?? "");
  const [schedule, setSchedule] = useState(conn?.schedule_cron ?? "0 */6 * * *");
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);
  const [queries, setQueries] = useState<DatabricksQuery[]>(
    cfg.queries ?? [
      { kind: "customer_info", sql: "SELECT * FROM main.churn.customer_info" },
      { kind: "calls", sql: "SELECT * FROM main.churn.calls" },
      { kind: "cease", sql: "SELECT * FROM main.churn.cease" },
      { kind: "usage", sql: "SELECT * FROM main.churn.usage" },
    ],
  );

  useEffect(() => {
    const cfg = (conn?.config as DatabricksConfig | undefined) ?? {};
    setHost(cfg.host ?? "");
    setWarehouseId(cfg.warehouse_id ?? "");
    setJobId(cfg.job_id ?? "");
    setSchedule(conn?.schedule_cron ?? "0 */6 * * *");
    setEnabled(conn?.enabled ?? true);
    if (cfg.queries) setQueries(cfg.queries);
  }, [conn?.id]);

  const save = () =>
    onSave({
      name: "Databricks",
      schedule_cron: schedule || null,
      enabled,
      config: {
        host: host || undefined,
        warehouse_id: warehouseId || undefined,
        job_id: jobId || undefined,
        queries,
      },
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" /> Databricks SQL Warehouse
            </CardTitle>
            <CardDescription>
              Pulls big customer / usage / calls / cease tables straight from a SQL Warehouse and
              lands them in Storage as the active dataset.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={conn?.last_status ?? null} />
            <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); onToggleEnabled(v); }} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dbx-host">Workspace host</Label>
            <Input
              id="dbx-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="dbc-abc123.cloud.databricks.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dbx-wh">SQL Warehouse ID</Label>
            <Input
              id="dbx-wh"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              placeholder="abcd1234efgh5678"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dbx-job">Training Job ID</Label>
            <Input
              id="dbx-job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="123456789"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dbx-cron">Ingestion schedule (cron)</Label>
          <Input
            id="dbx-cron"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 */6 * * *"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Cron is enforced server-side via pg_cron. Default: every 6 hours.
          </p>
        </div>

        <div className="space-y-2">
          <Label>SQL queries (one per data kind)</Label>
          {queries.map((q, i) => (
            <div key={i} className="grid grid-cols-[160px_1fr] gap-2">
              <Input
                value={q.kind}
                onChange={(e) =>
                  setQueries((qs) => qs.map((row, j) => (j === i ? { ...row, kind: e.target.value } : row)))
                }
              />
              <Textarea
                rows={2}
                value={q.sql}
                onChange={(e) =>
                  setQueries((qs) => qs.map((row, j) => (j === i ? { ...row, sql: e.target.value } : row)))
                }
                className="font-mono text-xs"
              />
            </div>
          ))}
        </div>

        {conn?.last_error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Last error: {conn.last_error}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={busy === "databricks"}>
            {busy === "databricks" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
          <Button variant="outline" onClick={onTest} disabled={!conn || !!busy}>
            <PlayCircle className="size-4" /> Test connection
          </Button>
          <Button variant="outline" onClick={onIngest} disabled={!conn || !!busy}>
            <RefreshCcw className="size-4" /> Ingest now
          </Button>
          <Button variant="secondary" onClick={onRetrain} disabled={!conn || !jobId || !!busy}>
            <Cpu className="size-4" /> Trigger retraining job
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Google Drive panel ----------

function GDrivePanel({
  conn,
  busy,
  onSave,
  onToggleEnabled,
  onTest,
  onIngest,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
  onToggleEnabled: (value: boolean) => void;
  onTest: () => void;
  onIngest: () => void;
}) {
  const cfg = (conn?.config as GDriveConfig | undefined) ?? {};
  const [rootUrl, setRootUrl] = useState(cfg.root_folder_url ?? "");
  const [rootId, setRootId] = useState(cfg.root_folder_id ?? "");
  const [schedule, setSchedule] = useState(conn?.schedule_cron ?? "*/15 * * * *");
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);

  useEffect(() => {
    const cfg = (conn?.config as GDriveConfig | undefined) ?? {};
    setRootUrl(cfg.root_folder_url ?? "");
    setRootId(cfg.root_folder_id ?? "");
    setSchedule(conn?.schedule_cron ?? "*/15 * * * *");
    setEnabled(conn?.enabled ?? true);
  }, [conn?.id]);

  const extractId = (val: string) => {
    const m = val.match(/folders\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : val.trim();
  };

  const save = () =>
    onSave({
      name: "Google Drive (admin)",
      schedule_cron: schedule || null,
      enabled,
      config: {
        root_folder_url: rootUrl || undefined,
        root_folder_id: extractId(rootUrl || rootId),
      },
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4" /> Google Drive root folder
            </CardTitle>
            <CardDescription>
              Authenticated as the system admin. Files dropped into the fixed subfolders below are
              picked up automatically and registered in the Data Library.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={conn?.last_status ?? null} />
            <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); onToggleEnabled(v); }} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="gd-root">Root folder link or ID</Label>
          <Input
            id="gd-root"
            value={rootUrl}
            onChange={(e) => setRootUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/0AABBCC..."
          />
          {rootUrl ? (
            <a
              href={rootUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open in Drive <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Expected file names (single shared folder — no subfolders)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FIXED_SUBFOLDERS.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-xs">
                <Folder className="size-3 text-muted-foreground" />
                <span className="font-mono">{String(s.key)}*</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Drop all CSV / Parquet / .duckdb / model artefact files into the same shared folder.
            Files are classified by name (e.g. <span className="font-mono">customer_info.parquet</span>,{" "}
            <span className="font-mono">loyalty_calls.csv</span>,{" "}
            <span className="font-mono">cease_2024.parquet</span>,{" "}
            <span className="font-mono">usage_speedtest.parquet</span>,{" "}
            <span className="font-mono">model_metrics.json</span>). The poller hashes each file and
            only re-imports when content changes.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gd-cron">Polling schedule (cron)</Label>
          <Input
            id="gd-cron"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="*/15 * * * *"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Default: every 15 minutes.</p>
        </div>

        {conn?.last_error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Last error: {conn.last_error}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={busy === "gdrive"}>
            {busy === "gdrive" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
          <Button variant="outline" onClick={onTest} disabled={!conn || !!busy}>
            <PlayCircle className="size-4" /> Test connection
          </Button>
          <Button variant="outline" onClick={onIngest} disabled={!conn || !!busy}>
            <RefreshCcw className="size-4" /> Poll now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Azure DevOps panel ----------

function AzurePanel({
  conn,
  busy,
  onSave,
  onToggleEnabled,
  onIngest,
  onPull,
  onCancel,
  pullJob,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
  onToggleEnabled: (value: boolean) => void;
  onIngest: () => void;
  onPull: () => void;
  onCancel: () => void;
  pullJob: PullJob | null;
}) {
  const cfg = (conn?.config as AzureRepoConfig | undefined) ?? {};
  const initialFiles = cfg.files ?? {
    cease: "cease.csv",
    customer_info: "customer_info.parquet",
    calls: "calls.csv",
    usage: "usage.parquet",
  };
  const [organization, setOrganization] = useState(cfg.organization ?? "tt-insight-analytics");
  const [project, setProject] = useState(cfg.project ?? "ds-tech-test");
  const [repository, setRepository] = useState(cfg.repository ?? "tech-test");
  const [branch, setBranch] = useState(cfg.branch ?? "main");
  const [anonymous, setAnonymous] = useState(cfg.anonymous ?? true);
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);
  const [filesJson, setFilesJson] = useState(JSON.stringify(initialFiles, null, 2));

  type PreviewResult = {
    path: string;
    format: "csv" | "parquet" | "raw";
    bytes: number;
    total_rows?: number;
    column_count?: number;
    headers?: string[];
    sample_rows?: unknown[][];
    note?: string;
  };
  const [previews, setPreviews] = useState<Record<string, PreviewResult>>({});
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);

  useEffect(() => {
    const cfg = (conn?.config as AzureRepoConfig | undefined) ?? {};
    setOrganization(cfg.organization ?? "tt-insight-analytics");
    setProject(cfg.project ?? "ds-tech-test");
    setRepository(cfg.repository ?? "tech-test");
    setBranch(cfg.branch ?? "main");
    setAnonymous(cfg.anonymous ?? true);
    setEnabled(conn?.enabled ?? true);
    setFilesJson(JSON.stringify(cfg.files ?? initialFiles, null, 2));
    setPreviews({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id]);

  const previewFile = async (kind: string) => {
    setPreviewBusy(kind);
    try {
      const res = (await callServer(`/api/admin/connections/preview-azure`, {
        kind,
        limit: 5,
      })) as PreviewResult;
      setPreviews((p) => ({ ...p, [kind]: res }));
    } catch (e) {
      toast.error(`Preview failed: ${(e as Error).message}`);
    } finally {
      setPreviewBusy(null);
    }
  };

  let parsedFilesPreview: Record<string, string> = {};
  try {
    parsedFilesPreview = JSON.parse(filesJson) as Record<string, string>;
  } catch {
    /* keep empty */
  }

  const save = () => {
    let parsedFiles: Record<string, string>;
    try {
      parsedFiles = JSON.parse(filesJson) as Record<string, string>;
    } catch (e) {
      toast.error(`Files JSON is not valid: ${(e as Error).message}`);
      return;
    }
    const config: AzureRepoConfig = {
      organization: organization.trim(),
      project: project.trim(),
      repository: repository.trim(),
      branch: branch.trim() || undefined,
      anonymous,
      files: parsedFiles,
    };
    onSave({ config, enabled, name: `Azure DevOps · ${organization}/${repository}` });
  };

  const repoUrl = organization && project && repository
    ? `https://dev.azure.com/${organization}/${project}/_git/${repository}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4" /> Azure DevOps Repos
        </CardTitle>
        <CardDescription>
          Pull <code>cease.csv</code>, <code>calls.csv</code>, <code>customer_info.parquet</code>{" "}
          and <code>usage.parquet</code> directly from a Git repo on{" "}
          <span className="font-medium">dev.azure.com</span>. CSVs and Parquet files are both
          parsed in-app (Parquet via the <code>hyparquet</code> pure-JS decoder) and snapshotted
          to the datasets bucket — no Databricks round-trip required for the live store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="az-org">Organization</Label>
            <Input
              id="az-org"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="tt-insight-analytics"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="az-project">Project</Label>
            <Input
              id="az-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="ds-tech-test"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="az-repo">Repository</Label>
            <Input
              id="az-repo"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="tech-test"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="az-branch">Branch</Label>
            <Input
              id="az-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-md border p-3">
          <Switch id="az-anon" checked={anonymous} onCheckedChange={setAnonymous} />
          <div className="flex-1">
            <Label htmlFor="az-anon" className="cursor-pointer">
              Anonymous read
            </Label>
            <p className="text-xs text-muted-foreground">
              Leave on for public Azure DevOps projects. Turn off and add a PAT to your
              project secrets to read private repos.
            </p>
          </div>
          <Switch id="az-enabled" checked={enabled} onCheckedChange={(v) => { setEnabled(v); onToggleEnabled(v); }} />
          <Label htmlFor="az-enabled">Enabled</Label>
        </div>

        <div className="space-y-1">
          <Label htmlFor="az-files">File map (dataset kind → repo path)</Label>
          <Textarea
            id="az-files"
            value={filesJson}
            onChange={(e) => setFilesJson(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Paths are relative to the repo root, e.g. <code>cease.csv</code> or{" "}
            <code>data/usage.parquet</code>.
          </p>
        </div>

        {repoUrl ? (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            Open repo on dev.azure.com <ExternalLink className="size-3" />
          </a>
        ) : null}

        {conn?.last_status === "error" && conn.last_error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            Last error: {conn.last_error}
          </div>
        ) : null}

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">File preview</div>
              <p className="text-xs text-muted-foreground">
                Inspect the detected row count, column names and a 5-row sample for each mapped
                file before running <span className="font-medium">Pull data now</span>.
              </p>
            </div>
          </div>

          {Object.keys(parsedFilesPreview).length === 0 ? (
            <p className="text-xs text-muted-foreground">No file map saved yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(parsedFilesPreview).map(([kind, path]) => {
                const p = previews[kind];
                const isBusy = previewBusy === kind;
                return (
                  <div key={kind} className="rounded-md border bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {kind}
                        </Badge>
                        <span className="font-mono text-xs truncate">{path}</span>
                        {p?.format ? (
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            {p.format}
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => previewFile(kind)}
                        disabled={!conn || !!previewBusy}
                      >
                        {isBusy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <PlayCircle className="size-3" />
                        )}
                        {p ? "Refresh" : "Preview"}
                      </Button>
                    </div>

                    {p ? (
                      p.note && !p.headers ? (
                        <p className="mt-2 text-xs text-muted-foreground">{p.note}</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>
                              Rows:{" "}
                              <span className="font-mono text-foreground">
                                {p.total_rows?.toLocaleString() ?? "—"}
                              </span>
                            </span>
                            <span>
                              Cols:{" "}
                              <span className="font-mono text-foreground">
                                {p.column_count ?? p.headers?.length ?? "—"}
                              </span>
                            </span>
                            <span>
                              Bytes:{" "}
                              <span className="font-mono text-foreground">
                                {(p.bytes / 1024).toFixed(1)} KB
                              </span>
                            </span>
                          </div>
                          {p.headers && p.headers.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {p.headers.map((h) => (
                                <span
                                  key={h}
                                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                                >
                                  {h}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {p.sample_rows && p.sample_rows.length > 0 && p.headers ? (
                            <div className="overflow-x-auto rounded border">
                              <table className="w-full text-[11px]">
                                <thead className="bg-muted/40">
                                  <tr>
                                    {p.headers.map((h) => (
                                      <th
                                        key={h}
                                        className="text-left px-2 py-1 font-medium font-mono"
                                      >
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.sample_rows.map((row, i) => (
                                    <tr key={i} className="border-t">
                                      {row.map((cell, j) => (
                                        <td
                                          key={j}
                                          className="px-2 py-1 font-mono align-top max-w-[200px] truncate"
                                          title={cell == null ? "" : String(cell)}
                                        >
                                          {cell == null ? (
                                            <span className="text-muted-foreground italic">
                                              null
                                            </span>
                                          ) : (
                                            String(cell)
                                          )}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <PullProgress job={pullJob} disabled={!!busy} />

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={busy === "azure_repo"}>
            {busy === "azure_repo" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </Button>
          <Button variant="outline" onClick={onIngest} disabled={!conn || !!busy}>
            <RefreshCcw className="size-4" /> Index files
          </Button>
          <Button onClick={onPull} disabled={!conn || !!busy || isPullActive(pullJob)}>
            {busy === "azure_repo-pull" || isPullActive(pullJob) ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {isPullActive(pullJob) ? "Pulling…" : "Pull data now"}
          </Button>
          {isPullActive(pullJob) ? (
            <Button
              variant="destructive"
              onClick={onCancel}
              disabled={busy === "azure_repo-cancel"}
            >
              {busy === "azure_repo-cancel" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <StopCircle className="size-4" />
              )}
              Stop pull
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Pull progress meter ----------

function isPullActive(job: PullJob | null): boolean {
  if (!job) return false;
  return ["queued", "downloading", "parsing", "uploading"].includes(job.status);
}

function fmtBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtRows(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function PullProgress({ job, disabled }: { job: PullJob | null; disabled: boolean }) {
  if (!job) return null;
  const active = isPullActive(job);
  const failed = job.status === "error";
  const cancelled = job.status === "cancelled";
  const done = job.status === "done";

  // Per-file percentage = bytes_done / bytes_total (only meaningful while parsing/uploading)
  const filePct =
    job.current_bytes_total && job.current_bytes_done
      ? Math.min(100, Math.round((job.current_bytes_done / job.current_bytes_total) * 100))
      : null;

  // Overall percentage = files_done / files_total (per-file fraction folded in)
  const overall = job.files_total
    ? Math.min(
        100,
        Math.round(
          ((job.files_done + (filePct != null ? filePct / 100 : 0)) / job.files_total) * 100,
        ),
      )
    : 0;

  const elapsedMs = Date.now() - new Date(job.started_at).getTime();
  const etaMs =
    overall > 0 && active && overall < 100 ? Math.round((elapsedMs / overall) * (100 - overall)) : null;

  const summary = job.summary ?? {};
  const summaryEntries = Object.entries(summary).filter(([k]) => !k.startsWith("_"));

  // Build a friendly real-time status line
  const fileNum = job.files_done + (active ? 1 : 0);
  const liveLine = active
    ? `Step ${fileNum}/${job.files_total} · ${job.status} ${job.current_kind ?? ""}${
        job.current_file ? ` · ${job.current_file.split("/").pop()}` : ""
      }`
    : null;

  return (
    <div
      className={`mt-3 rounded-lg border ${
        failed
          ? "border-destructive/30 bg-destructive/5"
          : cancelled
            ? "border-amber-500/30 bg-amber-500/5"
            : done
              ? "border-success/30 bg-success/5"
              : "border-primary/30 bg-primary/5"
      } p-4 space-y-3`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Pull job · {new Date(job.started_at).toLocaleTimeString()}
          </div>
          <div className="text-sm font-medium mt-0.5">
            {failed
              ? `Failed: ${job.error ?? "unknown error"}`
              : cancelled
                ? `Cancelled — ${job.files_done}/${job.files_total} files completed`
                : done
                  ? `Completed — ${job.files_done}/${job.files_total} files`
                  : liveLine}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground tabular-nums">
          <div>{overall}% overall</div>
          <div>elapsed {fmtDuration(elapsedMs)}</div>
          {etaMs != null && <div>eta ~{fmtDuration(etaMs)}</div>}
        </div>
      </div>

      {/* Overall bar */}
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${
              failed ? "bg-destructive" : cancelled ? "bg-amber-500" : done ? "bg-success" : "bg-primary"
            }`}
            style={{ width: `${overall}%` }}
          />
        </div>
        <div className="text-[11px] text-muted-foreground flex justify-between">
          <span>{job.files_done} / {job.files_total} files done</span>
          {active && job.current_kind && (
            <span>
              {fmtRows(job.current_rows_read)} rows · {fmtBytes(job.current_bytes_done)}
              {job.current_bytes_total ? ` / ${fmtBytes(job.current_bytes_total)}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Per-file bar (only while a file is in flight) */}
      {active && filePct != null && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary/60 transition-all" style={{ width: `${filePct}%` }} />
        </div>
      )}

      {/* Per-file summary once done */}
      {summaryEntries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          {summaryEntries.map(([kind, info]) => (
            <div key={kind} className="rounded border border-border bg-background/60 p-2">
              <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{kind}</div>
              <div className="text-xs font-medium tabular-nums">{fmtRows(info.rows)} rows</div>
              <div className="text-[10.5px] text-muted-foreground">{fmtBytes(info.bytes)} · {info.format ?? "—"}</div>
              {info.note && <div className="text-[10.5px] text-amber-600 mt-0.5">{info.note}</div>}
            </div>
          ))}
        </div>
      )}

      {!active && !done && !failed && (
        <div className="text-[11px] text-muted-foreground">Waiting for next worker tick…</div>
      )}
      {disabled && active && (
        <div className="text-[11px] text-muted-foreground">Polling every 2s…</div>
      )}
    </div>
  );
}

// ---------- MotherDuck panel ----------

function MotherDuckPanel({
  conn,
  busy,
  onSave,
  onToggleEnabled,
  onTest,
  onPull,
  onCancel,
  pullJob,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
  onToggleEnabled: (value: boolean) => void;
  onTest: () => void;
  onPull: (customerLimit?: number) => void;
  onCancel: () => void;
  pullJob: PullJob | null;
}) {
  const cfg = (conn?.config as MotherDuckConfig | undefined) ?? {};
  const [database, setDatabase] = useState(cfg.database ?? "file");
  const [schema, setSchema] = useState(cfg.schema ?? "main");
  const [host, setHost] = useState(cfg.host ?? "pg.us-east-1-aws.motherduck.com");
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);
  const [customerLimit, setCustomerLimit] = useState<number>(50);

  useEffect(() => {
    const c = (conn?.config as MotherDuckConfig | undefined) ?? {};
    setDatabase(c.database ?? "file");
    setSchema(c.schema ?? "main");
    setHost(c.host ?? "pg.us-east-1-aws.motherduck.com");
    setEnabled(conn?.enabled ?? true);
  }, [conn?.id]);

  const save = () =>
    onSave({
      name: "MotherDuck",
      enabled,
      schedule_cron: null,
      config: {
        database: database || "file",
        schema: schema || "main",
        host: host || undefined,
      },
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="size-4" /> MotherDuck (online DuckDB)
            </CardTitle>
            <CardDescription>
              Queries customer_info, calls, cease and usage tables from a MotherDuck database via the
              Postgres endpoint. The token is read from the <code className="font-mono">MOTHERDUCK_TOKEN</code> secret.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={conn?.last_status ?? null} />
            <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); onToggleEnabled(v); }} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="md-db">Database</Label>
            <Input id="md-db" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="file" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="md-schema">Schema</Label>
            <Input id="md-schema" value={schema} onChange={(e) => setSchema(e.target.value)} placeholder="main" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="md-host">Host</Label>
            <Input
              id="md-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="pg.us-east-1-aws.motherduck.com"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          Expected tables (resolved as <span className="font-mono">{schema || "main"}.&lt;name&gt;</span>):{" "}
          <span className="font-mono">customer_info</span>, <span className="font-mono">calls</span>,{" "}
          <span className="font-mono">cease</span>, <span className="font-mono">usage</span>. All four
          must include <span className="font-mono">unique_customer_identifier</span> for the random
          customer sampling to keep cross-table rows consistent.
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="md-limit">Customer limit (random sample)</Label>
          <Input
            id="md-limit"
            type="number"
            min={1}
            max={100}
            value={customerLimit}
            onChange={(e) => setCustomerLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="w-32"
          />
          <p className="text-[11px] text-muted-foreground">
            1–100. The pull samples this many customer_info rows, then constrains calls / cease / usage
            to the same IDs. Stored in the same shared pull-job card as the other connectors.
          </p>
        </div>

        {conn?.last_error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Last error: {conn.last_error}
          </div>
        ) : null}

        <PullProgress job={pullJob} disabled={!!busy} />

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={busy === "motherduck"}>
            {busy === "motherduck" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
          <Button variant="outline" onClick={onTest} disabled={!conn || !!busy}>
            <PlayCircle className="size-4" /> Test connection
          </Button>
          <Button onClick={() => onPull(customerLimit)} disabled={!conn || !!busy || isPullActive(pullJob)}>
            {busy === "motherduck-pull" || isPullActive(pullJob) ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {isPullActive(pullJob) ? "Pulling…" : "Pull data now"}
          </Button>
          {isPullActive(pullJob) ? (
            <Button variant="destructive" onClick={onCancel} disabled={busy === "azure_repo-cancel"}>
              <StopCircle className="size-4" /> Stop pull
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function LocalUploadAdminPanel({
  conn,
  busy,
  onToggleEnabled,
}: {
  conn?: Connection;
  busy: string | null;
  onToggleEnabled: (value: boolean) => void;
}) {
  const enabled = conn?.enabled ?? true;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UploadCloud className="size-4" /> Local upload
            </CardTitle>
            <CardDescription>
              Drag-and-drop CSV / Parquet files into the dataset library on the{" "}
              <Link to="/data" className="text-primary underline-offset-2 hover:underline">
                Data control plane
              </Link>
              . Disable to hide the upload surface and clear any active upload-origin selection.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={enabled ? "border-success/30 text-success bg-success/10" : "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10"}>
              {enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => onToggleEnabled(v)}
              disabled={busy === "local_upload"}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          When disabled the dashboard ignores any previously uploaded files and reverts to the
          next configured live source (or the bundled sample data). Re-enabling restores access
          to the dataset library so analysts can drop fresh files.
        </div>
      </CardContent>
    </Card>
  );
}

function SampleAdminPanel({
  conn,
  busy,
  onToggleEnabled,
}: {
  conn?: Connection;
  busy: string | null;
  onToggleEnabled: (value: boolean) => void;
}) {
  const enabled = conn?.enabled ?? true;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Sample data
            </CardTitle>
            <CardDescription>
              The bundled 6 personas + 50 generated customers used as a safe playground when no
              live source is wired. Disable to force the dashboards to reflect only real data —
              when every connector is off, the customer base is wiped.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={enabled ? "border-success/30 text-success bg-success/10" : "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10"}>
              {enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={(v: boolean) => onToggleEnabled(v)}
              disabled={busy === "sample"}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          Toggle this from either the{" "}
          <Link to="/data" className="text-primary underline-offset-2 hover:underline">
            Data control plane
          </Link>{" "}
          or here. The state is persisted in <span className="font-mono">data_connections</span>.
        </div>
      </CardContent>
    </Card>
  );
}
