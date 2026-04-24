import { createFileRoute } from "@tanstack/react-router";
import {
  driveDownloadFile,
  parseCsv,
  parseParquet,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Worker that processes ONE Drive file from the oldest active gdrive pull_jobs
 * row. Driven by pg_cron and self-kicks after each file. Mirrors the Azure
 * worker; differs only in transport (Drive REST alt=media) and storage prefix.
 */
export const Route = createFileRoute("/api/public/hooks/pull-drive-worker")({
  server: {
    handlers: {
      POST: async () => {
        // Pick the oldest active job whose connection is gdrive.
        const { data: gdriveConn } = await supabaseAdmin
          .from("data_connections")
          .select("id")
          .eq("kind", "gdrive")
          .maybeSingle();
        if (!gdriveConn) return json(200, { idle: true, reason: "no gdrive connection" });

        const { data: job, error: jobErr } = await supabaseAdmin
          .from("pull_jobs")
          .select("*")
          .eq("connection_id", gdriveConn.id)
          .in("status", ["queued", "downloading", "parsing", "uploading"])
          .order("started_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (jobErr) return json(500, { error: jobErr.message });
        if (!job) return json(200, { idle: true });

        const pending = (
          (job.pending_files ?? []) as Array<{ kind: string; path: string; remote_id: string }>
        ).slice();
        const summary = (job.summary ?? {}) as Record<string, unknown> & {
          _config?: { customerLimit?: number | null };
          _customerIds?: string[];
        };
        const customerLimit = summary._config?.customerLimit ?? null;
        const customerIds = new Set<string>(
          (summary._customerIds ?? []).map((s) => s.toLowerCase()),
        );

        if (pending.length === 0) {
          await supabaseAdmin
            .from("pull_jobs")
            .update({ status: "done", finished_at: new Date().toISOString() })
            .eq("id", job.id);
          return json(200, { ok: true, jobId: job.id, status: "done" });
        }

        const next = pending[0];

        try {
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

          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          const bytes = await driveDownloadFile(next.remote_id);
          await supabaseAdmin
            .from("pull_jobs")
            .update({
              status: "parsing",
              current_bytes_total: bytes.byteLength,
              current_bytes_done: bytes.byteLength,
            })
            .eq("id", job.id);

          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          const lower = (next.path ?? "").toLowerCase();
          const isCsv = lower.endsWith(".csv");
          const isParquet = lower.endsWith(".parquet");

          // Archive the raw bytes for traceability
          const archivePath = `gdrive/${gdriveConn.id}/${next.kind}/${next.path}`;
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

          // ── Customer-coherent random sampling ─────────────────────────────
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
              for (const r of sampled) {
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
            .update({ status: "uploading", current_rows_read: filteredTotal })
            .eq("id", job.id);

          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          summary[next.kind] = {
            rows: filteredTotal,
            bytes: bytes.byteLength,
            format,
            ...(filterNote ? { note: filterNote } : {}),
          } as never;
          const snapshot = JSON.stringify({
            source: "gdrive",
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
              `gdrive/${gdriveConn.id}/${next.kind}.json`,
              new Blob([snapshot], { type: "application/json" }),
              { upsert: true, contentType: "application/json" },
            );

          if (["customer_info", "calls", "cease", "usage"].includes(next.kind)) {
            await supabaseAdmin.from("active_data_sources").upsert(
              {
                kind: next.kind,
                origin: "live",
                connection_id: gdriveConn.id,
                remote_name: next.path,
                label: next.path,
                rows_count: filteredTotal,
                activated_at: new Date().toISOString(),
              },
              { onConflict: "kind" },
            );
          }

          await advanceJob(job.id, pending, summary);
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

async function isCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("pull_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return data?.status === "cancelled";
}

function kickSelf() {
  try {
    const req = getRequest();
    const origin = new URL(req.url).origin;
    void fetch(`${origin}/api/public/hooks/pull-drive-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {
      /* cron will pick it up on the next tick */
    });
  } catch {
    /* no request context */
  }
}

async function advanceJob(
  jobId: string,
  pending: Array<{ kind: string; path: string; remote_id: string }>,
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

/** Random sample of `k` items from `arr` (Fisher–Yates partial shuffle). */
function reservoirSample<T>(arr: T[], k: number): T[] {
  if (k >= arr.length) return arr.slice();
  const copy = arr.slice();
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}
