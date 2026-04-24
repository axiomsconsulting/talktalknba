import { useEffect, useState } from "react";
import { Loader2, Download, StopCircle, Users, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type PullSourceKind = "gdrive" | "azure_repo";

export type PullJob = {
  id: string;
  status:
    | "queued"
    | "downloading"
    | "parsing"
    | "uploading"
    | "done"
    | "error"
    | "cancelled";
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
  summary:
    | (Record<string, { rows?: number; bytes: number; format?: string; note?: string }> & {
        _config?: { customerLimit?: number | null };
      })
    | null;
  error: string | null;
};

const SOURCE_LABELS: Record<PullSourceKind, string> = {
  gdrive: "Google Drive",
  azure_repo: "Azure DevOps Repo",
};

const START_PATH: Record<PullSourceKind, string> = {
  gdrive: "/api/admin/connections/pull-drive",
  azure_repo: "/api/admin/connections/pull-azure",
};

async function callServer(path: string, body: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
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
        : null) ?? text ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function isActive(job: PullJob | null): boolean {
  return !!job && ["queued", "downloading", "parsing", "uploading"].includes(job.status);
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
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
  return `${m}m ${s % 60}s`;
}

/**
 * Generic pull-job control for live data sources. Owns:
 *  • the customer-cap selector (1–100, or "All")
 *  • the Pull / Stop buttons
 *  • polling pull-status every 2s while a job is active
 *  • realtime per-file progress UI
 *
 * The same `pull_jobs` table is shared across all live sources; this component
 * only filters by `connectionId` so the active job for the chosen source is
 * the one being shown.
 */
export function PullJobCard({
  kind,
  connectionId,
  enabled,
  onChanged,
}: {
  kind: PullSourceKind;
  /** Connection row id. Used to filter the active pull job server-side. */
  connectionId: string | null;
  /** Whether the underlying connection is enabled. Disables the pull button. */
  enabled: boolean;
  /** Called once a pull finishes so callers can refresh dataset listings. */
  onChanged?: () => void;
}) {
  const [job, setJob] = useState<PullJob | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [customerLimit, setCustomerLimit] = useState<number>(50);
  const [pullAll, setPullAll] = useState<boolean>(false);

  // Refresh latest job (or one specific job) for this connection
  async function refreshJob(jobId?: string) {
    if (!connectionId) return null;
    try {
      const res = (await callServer("/api/admin/connections/pull-status", {
        ...(jobId ? { jobId } : {}),
        connectionId,
      })) as { job: PullJob | null } | null;
      setJob(res?.job ?? null);
      return res?.job ?? null;
    } catch {
      return null;
    }
  }

  // Initial hydrate + poll while active
  useEffect(() => {
    if (connectionId) void refreshJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    if (!isActive(job)) return;
    const t = setInterval(() => {
      void refreshJob(job?.id);
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  // Notify parent when a job transitions out of the active states
  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      onChanged?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  const startPull = async () => {
    if (!connectionId) return;
    setBusy("start");
    try {
      const body = { customerLimit: pullAll ? null : customerLimit };
      const res = (await callServer(START_PATH[kind], body)) as {
        jobId?: string;
        filesTotal?: number;
      } | null;
      if (res?.jobId) {
        toast.success(
          `Queued — ${res.filesTotal ?? 0} file(s) ${pullAll ? "(all customers)" : `for ${customerLimit} customers`}`,
        );
        await refreshJob(res.jobId);
      }
    } catch (e) {
      toast.error(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const stopPull = async () => {
    if (!job) return;
    setBusy("stop");
    try {
      await callServer("/api/admin/connections/cancel-pull", { jobId: job.id });
      toast.success("Pull cancelled");
      await refreshJob(job.id);
    } catch (e) {
      toast.error(`Cancel failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const active = isActive(job);
  const filePct =
    job?.current_bytes_total && job.current_bytes_done
      ? Math.min(100, Math.round((job.current_bytes_done / job.current_bytes_total) * 100))
      : null;
  const overall = job?.files_total
    ? Math.min(
        100,
        Math.round(
          ((job.files_done + (filePct != null ? filePct / 100 : 0)) / job.files_total) * 100,
        ),
      )
    : 0;

  const elapsedMs = job ? Date.now() - new Date(job.started_at).getTime() : 0;
  const etaMs =
    overall > 0 && active && overall < 100 ? Math.round((elapsedMs / overall) * (100 - overall)) : null;

  const summary = job?.summary ?? {};
  const summaryEntries = Object.entries(summary).filter(([k]) => !k.startsWith("_"));

  const liveLine = active
    ? `Step ${job!.files_done + 1}/${job!.files_total} · ${job!.status} ${job!.current_kind ?? ""}${
        job!.current_file ? ` · ${job!.current_file.split("/").pop()}` : ""
      }`
    : null;

  const toneClass = !job
    ? "border-border bg-[var(--surface-sunken)]/40"
    : job.status === "error"
      ? "border-destructive/30 bg-destructive/5"
      : job.status === "cancelled"
        ? "border-amber-500/30 bg-amber-500/5"
        : job.status === "done"
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-primary/30 bg-primary/5";

  const cohortNote = (job?.summary?._config?.customerLimit ?? null) as number | null | undefined;
  const cohortIds = ((job?.summary as Record<string, unknown> | null)?._customerIds ?? null) as
    | string[]
    | null;

  return (
    <div className={cn("rounded-lg border p-5 sm:p-6 space-y-4", toneClass)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="size-3" /> Pull job · {SOURCE_LABELS[kind]}
          </div>
          <div className="text-sm font-medium mt-0.5">
            {!job
              ? "No pull yet — pick a customer cap and run."
              : job.status === "error"
                ? `Failed: ${job.error ?? "unknown error"}`
                : job.status === "cancelled"
                  ? `Cancelled — ${job.files_done}/${job.files_total} files`
                  : job.status === "done"
                    ? `Completed — ${job.files_done}/${job.files_total} files`
                    : liveLine}
          </div>
          {job && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Started {new Date(job.started_at).toLocaleTimeString()}
              {cohortNote ? ` · cohort cap ${cohortNote}` : " · all customers"}
              {cohortIds ? ` · ${cohortIds.length} unique IDs sampled` : ""}
            </div>
          )}
        </div>
        {job && (
          <div className="text-right text-xs text-muted-foreground tabular-nums">
            <div>{overall}% overall</div>
            {active && <div>elapsed {fmtDuration(elapsedMs)}</div>}
            {etaMs != null && <div>eta ~{fmtDuration(etaMs)}</div>}
          </div>
        )}
      </div>

      {/* Cohort selector */}
      <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Users className="size-3" /> Customer records to pull
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={pullAll}
              onChange={(e) => setPullAll(e.target.checked)}
              disabled={active}
            />
            All customers
          </label>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={customerLimit}
            disabled={pullAll || active}
            onChange={(e) => setCustomerLimit(Number(e.target.value))}
            className="flex-1 accent-primary disabled:opacity-50"
          />
          <input
            type="number"
            min={1}
            max={100}
            value={customerLimit}
            disabled={pullAll || active}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              setCustomerLimit(Math.max(1, Math.min(100, Math.floor(v))));
            }}
            className="w-16 px-2 py-1 text-sm font-mono rounded border border-border bg-background disabled:opacity-50"
          />
        </div>
        <div className="text-[10.5px] text-muted-foreground">
          We pull <span className="font-medium text-foreground">{pullAll ? "every" : `${customerLimit} random`}</span>{" "}
          customer record, then filter <span className="text-foreground">calls</span>,{" "}
          <span className="text-foreground">cease</span> and <span className="text-foreground">usage</span> to that
          same cohort so all four datasets stay coherent.
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={startPull}
          disabled={!connectionId || !enabled || !!busy || active}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-primary to-primary-deep text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-50 disabled:shadow-none"
        >
          {busy === "start" || active ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {active ? "Pulling…" : "Pull data now"}
        </button>
        {active && (
          <button
            onClick={stopPull}
            disabled={busy === "stop"}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            {busy === "stop" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <StopCircle className="size-3.5" />
            )}
            Stop
          </button>
        )}
      </div>

      {/* Progress bars */}
      {job && (
        <div className="space-y-2">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                job.status === "error"
                  ? "bg-destructive"
                  : job.status === "cancelled"
                    ? "bg-amber-500"
                    : job.status === "done"
                      ? "bg-emerald-500"
                      : "bg-primary",
              )}
              style={{ width: `${overall}%` }}
            />
          </div>
          <div className="text-[11px] text-muted-foreground flex justify-between">
            <span>
              {job.files_done} / {job.files_total} files done
            </span>
            {active && job.current_kind && (
              <span>
                {fmtRows(job.current_rows_read)} rows · {fmtBytes(job.current_bytes_done)}
                {job.current_bytes_total ? ` / ${fmtBytes(job.current_bytes_total)}` : ""}
              </span>
            )}
          </div>

          {active && filePct != null && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary/60 transition-all"
                style={{ width: `${filePct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Per-kind summary chips */}
      {summaryEntries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {summaryEntries.map(([k, info]) => (
            <div key={k} className="rounded border border-border bg-background/60 p-2">
              <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="text-xs font-medium tabular-nums">{fmtRows(info.rows)} rows</div>
              <div className="text-[10.5px] text-muted-foreground">
                {fmtBytes(info.bytes)} · {info.format ?? "—"}
              </div>
              {info.note && <div className="text-[10.5px] text-amber-600 mt-0.5">{info.note}</div>}
            </div>
          ))}
        </div>
      )}

      {!connectionId && (
        <div className="text-[11px] text-amber-600">
          Configure {SOURCE_LABELS[kind]} first to enable pulling.
        </div>
      )}
      {connectionId && !enabled && (
        <div className="text-[11px] text-amber-600">
          {SOURCE_LABELS[kind]} connection is disabled.
        </div>
      )}
    </div>
  );
}
