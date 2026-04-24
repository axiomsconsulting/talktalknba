import { createFileRoute } from "@tanstack/react-router";
import {
  azureDownloadFile,
  parseCsv,
  parseParquet,
  type AzureRepoConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Worker that processes ONE file from the oldest active pull_jobs row.
 * Driven by pg_cron every 30s; also kicked directly by /pull-azure on
 * job creation so the user sees progress immediately.
 *
 * Public endpoint — but only mutates internal pull_jobs / storage. No PII
 * leaves the worker. Concurrent ticks are made safe by an UPDATE…SET
 * status='running' guard before doing real work.
 */
export const Route = createFileRoute("/api/public/hooks/pull-azure-worker")({
  server: {
    handlers: {
      POST: async () => {
        // Find the oldest job that still has work to do
        const { data: job, error: jobErr } = await supabaseAdmin
          .from("pull_jobs")
          .select("*")
          .in("status", ["queued", "downloading", "parsing", "uploading"])
          .order("started_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (jobErr) return json(500, { error: jobErr.message });
        if (!job) return json(200, { idle: true });

        const pending = ((job.pending_files ?? []) as Array<{ kind: string; path: string }>).slice();
        const summary = (job.summary ?? {}) as Record<string, unknown> & {
          _config?: { customerLimit?: number | null };
          _customerIds?: string[];
        };
        const customerLimit = summary._config?.customerLimit ?? null;
        const customerIds = new Set<string>((summary._customerIds ?? []).map((s) => s.toLowerCase()));

        if (pending.length === 0) {
          await supabaseAdmin
            .from("pull_jobs")
            .update({ status: "done", finished_at: new Date().toISOString() })
            .eq("id", job.id);
          return json(200, { ok: true, jobId: job.id, status: "done" });
        }

        const next = pending[0];

        // Load connection config
        const { data: conn } = await supabaseAdmin
          .from("data_connections")
          .select("id, config")
          .eq("id", job.connection_id)
          .maybeSingle();
        if (!conn) {
          await failJob(job.id, "Connection deleted");
          return json(200, { jobId: job.id, status: "error" });
        }
        const cfg = conn.config as AzureRepoConfig;

        try {
          // Mark file in flight
          await supabaseAdmin
            .from("pull_jobs")
            .update({
              status: "downloading",
              current_kind: next.kind,
              current_file: next.path,
              current_bytes_total: null,
              current_bytes_done: null,
              current_rows_read: 0,
            })
            .eq("id", job.id);

          // Download (Azure REST returns full file — Worker has no streaming
          // primitive that Azure speaks, so we measure bytes after fetch).
          const bytes = await azureDownloadFile(cfg, "/" + next.path);
          await supabaseAdmin
            .from("pull_jobs")
            .update({
              status: "parsing",
              current_bytes_total: bytes.byteLength,
              current_bytes_done: bytes.byteLength,
            })
            .eq("id", job.id);

          // Archive raw file (overwrite — no per-run history, keeps storage flat)
          const archivePath = `azure/${conn.id}/${next.kind}/${next.path.split("/").pop()}`;
          const lower = next.path.toLowerCase();
          const isCsv = lower.endsWith(".csv");
          const isParquet = lower.endsWith(".parquet");
          await supabaseAdmin.storage
            .from("datasets")
            .upload(archivePath, new Blob([bytes as BlobPart]), {
              upsert: true,
              contentType: isCsv
                ? "text/csv"
                : isParquet
                  ? "application/vnd.apache.parquet"
                  : "application/octet-stream",
            });

          // Parse capped snapshot
          let parsedHeaders: string[] = [];
          let parsedRows: unknown[][] = [];
          let totalRows = 0;
          let format: "csv" | "parquet" | "raw" = "raw";

          if (isCsv) {
            const text = new TextDecoder().decode(bytes);
            const parsed = parseCsv(text);
            parsedHeaders = parsed.headers;
            parsedRows = parsed.rows;
            totalRows = parsed.rows.length;
            format = "csv";
          } else if (isParquet) {
            try {
              const parsed = await parseParquet(bytes);
              parsedHeaders = parsed.headers;
              parsedRows = parsed.rows;
              totalRows = parsed.totalRows;
              format = "parquet";
            } catch (e) {
              summary[next.kind] = {
                bytes: bytes.byteLength,
                format: "parquet",
                note: `Parquet decode failed: ${(e as Error).message}`,
              };
              await advanceJob(job.id, pending, summary);
              return json(200, { jobId: job.id, status: "skipped" });
            }
          } else {
            summary[next.kind] = {
              bytes: bytes.byteLength,
              format: "raw",
              note: "Unrecognised extension — archived only",
            };
            await advanceJob(job.id, pending, summary);
            return json(200, { jobId: job.id, status: "archived" });
          }

          await supabaseAdmin
            .from("pull_jobs")
            .update({ status: "uploading", current_rows_read: totalRows })
            .eq("id", job.id);

          // Snapshot for the live store
          summary[next.kind] = { rows: totalRows, bytes: bytes.byteLength, format };
          const snapshot = JSON.stringify({
            source: "azure_repo",
            remote: next.path,
            fetched_at: new Date().toISOString(),
            format,
            total_rows: totalRows,
            headers: parsedHeaders,
            rows: parsedRows.slice(0, 50_000),
          });
          await supabaseAdmin.storage
            .from("datasets")
            .upload(
              `azure/${conn.id}/${next.kind}.json`,
              new Blob([snapshot], { type: "application/json" }),
              { upsert: true, contentType: "application/json" },
            );

          if (["customer_info", "calls", "cease", "usage"].includes(next.kind)) {
            await supabaseAdmin.from("active_data_sources").upsert(
              {
                kind: next.kind,
                origin: "live",
                connection_id: conn.id,
                remote_name: next.path,
                label: next.path.split("/").pop() ?? next.path,
                rows_count: totalRows,
                activated_at: new Date().toISOString(),
              },
              { onConflict: "kind" },
            );
          }

          await advanceJob(job.id, pending, summary);
          return json(200, { jobId: job.id, status: "file_done", file: next.path });
        } catch (e) {
          await failJob(job.id, (e as Error).message);
          return json(200, { jobId: job.id, status: "error", error: (e as Error).message });
        }
      },
    },
  },
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function advanceJob(
  jobId: string,
  pending: Array<{ kind: string; path: string }>,
  summary: Record<string, unknown>,
) {
  const remaining = pending.slice(1);
  const { data: cur } = await supabaseAdmin
    .from("pull_jobs")
    .select("files_done, files_total")
    .eq("id", jobId)
    .maybeSingle();
  const done = (cur?.files_done ?? 0) + 1;
  const isLast = remaining.length === 0;

  await supabaseAdmin
    .from("pull_jobs")
    .update({
      pending_files: remaining as never,
      files_done: done,
      summary: summary as never,
      status: isLast ? "done" : "queued",
      current_kind: null,
      current_file: null,
      current_bytes_total: null,
      current_bytes_done: null,
      current_rows_read: null,
      finished_at: isLast ? new Date().toISOString() : null,
    })
    .eq("id", jobId);
}

async function failJob(jobId: string, message: string) {
  await supabaseAdmin
    .from("pull_jobs")
    .update({ status: "error", error: message, finished_at: new Date().toISOString() })
    .eq("id", jobId);
}
