import { createFileRoute } from "@tanstack/react-router";
import {
  azureDownloadFile,
  parseCsv,
  parseParquet,
  type AzureRepoConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Worker that processes ONE file from the oldest active pull_jobs row.
 * Driven by pg_cron every 30s. Also self-kicks after finishing one file so
 * multi-file pulls progress back-to-back without waiting for the next tick.
 *
 * Public endpoint — but only mutates internal pull_jobs / storage. No PII
 * leaves the worker. Concurrent ticks are made safe by an UPDATE…SET
 * status='downloading' guard on the chosen job before doing real work.
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
          // Mark file in flight with a human-readable note
          const fileName = next.path.split("/").pop() ?? next.path;
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

          // Cancellation check #1
          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

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

          // Cancellation check #2
          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

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
              } as never;
              await advanceJob(job.id, pending, summary);
              kickSelf();
              return json(200, { jobId: job.id, status: "skipped" });
            }
          } else {
            summary[next.kind] = {
              bytes: bytes.byteLength,
              format: "raw",
              note: "Unrecognised extension — archived only",
            } as never;
            await advanceJob(job.id, pending, summary);
            kickSelf();
            return json(200, { jobId: job.id, status: "archived" });
          }

          // ── Customer-coherent sampling ────────────────────────────────────
          let filteredRows = parsedRows;
          let filteredTotal = totalRows;
          let filterNote: string | undefined;
          const idColIdx = parsedHeaders.findIndex(
            (h) => h.toLowerCase() === "unique_customer_identifier",
          );

          if (next.kind === "customer_info" && customerLimit && customerLimit > 0) {
            if (idColIdx === -1) {
              filterNote = "customer_info missing unique_customer_identifier — limit not applied";
            } else {
              const sampled = reservoirSample(parsedRows, customerLimit);
              filteredRows = sampled;
              filteredTotal = sampled.length;
              const ids: string[] = [];
              for (const r of filteredRows) {
                const v = r[idColIdx];
                if (v != null) ids.push(String(v).toLowerCase());
              }
              for (const id of ids) customerIds.add(id);
              summary._customerIds = Array.from(customerIds);
              filterNote = `Randomly sampled ${filteredTotal} of ${totalRows} customers`;
            }
          } else if (next.kind !== "customer_info" && customerIds.size > 0) {
            if (idColIdx === -1) {
              filterNote = `${next.kind} missing unique_customer_identifier — kept all rows`;
            } else {
              filteredRows = parsedRows.filter((r) => {
                const v = r[idColIdx];
                return v != null && customerIds.has(String(v).toLowerCase());
              });
              filteredTotal = filteredRows.length;
              filterNote = `Filtered to ${filteredTotal} of ${totalRows} rows for ${customerIds.size} sampled customers`;
            }
          }

          await supabaseAdmin
            .from("pull_jobs")
            .update({
              status: "uploading",
              current_rows_read: filteredTotal,

            })
            .eq("id", job.id);

          // Cancellation check #3
          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          // Snapshot for the live store
          summary[next.kind] = {
            rows: filteredTotal,
            bytes: bytes.byteLength,
            format,
            ...(filterNote ? { note: filterNote } : {}),
          } as never;
          const snapshot = JSON.stringify({
            source: "azure_repo",
            remote: next.path,
            fetched_at: new Date().toISOString(),
            format,
            total_rows: filteredTotal,
            headers: parsedHeaders,
            rows: filteredRows.slice(0, 50_000),
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
                rows_count: filteredTotal,
                activated_at: new Date().toISOString(),
              },
              { onConflict: "kind" },
            );
          }

          await advanceJob(job.id, pending, summary);
          // Kick self for the next file so the user doesn't wait 30s for cron.
          kickSelf();
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

/** Returns true if the job has been cancelled mid-flight. */
async function isCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("pull_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return data?.status === "cancelled";
}

/** Fire-and-forget: ask ourselves to process the next file immediately. */
function kickSelf() {
  try {
    const req = getRequest();
    const origin = new URL(req.url).origin;
    void fetch(`${origin}/api/public/hooks/pull-azure-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {
      /* cron will pick it up on the next tick */
    });
  } catch {
    /* no request context — not fatal, cron will tick */
  }
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
      error: null,
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
