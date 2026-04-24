import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  Database,
  HardDrive,
  Save,
  PlayCircle,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Folder,
  ExternalLink,
  Cpu,
  Plug,
  GitBranch,
  Download,
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

type ConnectionKind = "databricks" | "gdrive" | "azure_repo";
type RunStatus = "pending" | "running" | "success" | "error";

type DatabricksQuery = { kind: string; sql: string };
type GDriveSubfolders = {
  customer_info?: string;
  calls?: string;
  cease?: string;
  usage?: string;
  model_artefacts?: string;
};
type DatabricksConfig = {
  host?: string;
  warehouse_id?: string;
  job_id?: string;
  queries?: DatabricksQuery[];
};
type GDriveConfig = {
  root_folder_id?: string;
  root_folder_url?: string;
  subfolders?: GDriveSubfolders;
};
type AzureRepoConfig = {
  organization?: string;
  project?: string;
  repository?: string;
  branch?: string;
  anonymous?: boolean;
  files?: Record<string, string>;
};

type Connection = {
  id: string;
  kind: ConnectionKind;
  name: string;
  config: DatabricksConfig | GDriveConfig | AzureRepoConfig | Record<string, unknown>;
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

const FIXED_SUBFOLDERS: Array<{ key: keyof GDriveSubfolders; label: string }> = [
  { key: "customer_info", label: "customer_info/" },
  { key: "calls", label: "calls/" },
  { key: "cease", label: "cease/" },
  { key: "usage", label: "usage/" },
  { key: "model_artefacts", label: "model_artefacts/" },
];

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
        : kind === "gdrive"
          ? "Google Drive"
          : "Azure DevOps";
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

  const pullAzure = async () => {
    setBusy("azure_repo-pull");
    try {
      const res = (await callServer(`/api/admin/connections/pull-azure`, {})) as {
        message?: string;
        summary?: Record<string, { rows?: number; bytes: number; skipped?: string }>;
      } | null;
      toast.success(res?.message ?? "Azure DevOps data pulled");
      await reload();
    } catch (e) {
      toast.error(`Pull failed: ${(e as Error).message}`);
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

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="Live data connections"
        description="Configure where the platform pulls customer, usage, calls, cease and model artefact data from. All connectors are optional — without them, the dashboard shows the bundled sample data."
      />

      <Tabs defaultValue="azure_repo" className="mt-6">
        <TabsList>
          <TabsTrigger value="azure_repo" className="gap-2">
            <GitBranch className="size-4" /> Azure DevOps
          </TabsTrigger>
          <TabsTrigger value="databricks" className="gap-2">
            <Database className="size-4" /> Databricks
          </TabsTrigger>
          <TabsTrigger value="gdrive" className="gap-2">
            <HardDrive className="size-4" /> Google Drive
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
            onIngest={() => ingest("azure_repo")}
            onPull={pullAzure}
          />
        </TabsContent>

        <TabsContent value="databricks" className="mt-4">
          <DatabricksPanel
            conn={dbx}
            busy={busy}
            onSave={(patch) => upsert("databricks", patch)}
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
            onTest={() => test("gdrive")}
            onIngest={() => ingest("gdrive")}
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
  onTest,
  onIngest,
  onRetrain,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
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
            <Switch checked={enabled} onCheckedChange={setEnabled} />
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
  onTest,
  onIngest,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
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
            <Switch checked={enabled} onCheckedChange={setEnabled} />
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
          <div className="text-xs font-medium text-muted-foreground mb-2">Expected subfolders</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FIXED_SUBFOLDERS.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-xs">
                <Folder className="size-3 text-muted-foreground" />
                <span className="font-mono">{s.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            CSV / Parquet / .duckdb files supported. The poller hashes each file and only re-imports
            when content changes.
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
  onIngest,
  onPull,
}: {
  conn?: Connection;
  busy: string | null;
  onSave: (patch: Partial<Connection>) => void;
  onIngest: () => void;
  onPull: () => void;
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

  useEffect(() => {
    const cfg = (conn?.config as AzureRepoConfig | undefined) ?? {};
    setOrganization(cfg.organization ?? "tt-insight-analytics");
    setProject(cfg.project ?? "ds-tech-test");
    setRepository(cfg.repository ?? "tech-test");
    setBranch(cfg.branch ?? "main");
    setAnonymous(cfg.anonymous ?? true);
    setEnabled(conn?.enabled ?? true);
    setFilesJson(JSON.stringify(cfg.files ?? initialFiles, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id]);

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
          <Switch id="az-enabled" checked={enabled} onCheckedChange={setEnabled} />
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
          <Button onClick={onPull} disabled={!conn || !!busy}>
            {busy === "azure_repo-pull" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Pull data now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
