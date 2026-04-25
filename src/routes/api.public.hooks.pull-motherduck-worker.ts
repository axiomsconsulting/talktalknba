import { createFileRoute } from "@tanstack/react-router";
import {
  motherduckClient,
  motherduckTableFor,
  type MotherDuckConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Worker that processes ONE table from the oldest active MotherDuck pull_jobs
 * row. Driven by pg_cron every 30s and self-kicks after each table so
 * multi-table pulls progress back-to-back.
 *
 * Mirrors the Azure worker: same job-status updates, same snapshot layout
 * (datasets bucket, JSON file per kind), same active_data_sources upsert so
 * the rest of the app picks the data up automatically.
 */
export const Route = createFileRoute("/api/public/hooks/pull-motherduck-worker")({
  server: {
    handlers: {
      POST: async () => {
        // Find the oldest motherduck job that still has work to do
        const { data: job, error: jobErr } = await supabaseAdmin
          .from("pull_jobs")
          .select("*, data_connections!inner(kind)")
          .in("status", ["queued", "downloading", "parsing", "uploading"])
          .eq("data_connections.kind", "motherduck")
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
        const cfg = conn.config as MotherDuckConfig;

        try {
          const kind = next.kind as "customer_info" | "calls" | "cease" | "usage";
          const table = motherduckTableFor(cfg, kind);

          await supabaseAdmin
            .from("pull_jobs")
            .update({
              status: "downloading",
              current_kind: kind,
              current_file: table,
              current_bytes_total: null,
              current_bytes_done: null,
              current_rows_read: 0,
            })
            .eq("id", job.id);

          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          // Build the SQL — sample customer_info, then constrain the rest to
          // the chosen IDs so all tables share the same customer set.
          let sql: string;
          if (kind === "customer_info" && customerLimit && customerLimit > 0) {
            // ORDER BY random() may stream slowly on huge tables; the LIMIT
            // makes it cheap enough for typical test datasets.
            sql = `SELECT * FROM ${table} ORDER BY random() LIMIT ${customerLimit}`;
          } else if (kind !== "customer_info" && customerIds.size > 0) {
            const ids = Array.from(customerIds)
              .map((s) => `'${s.replace(/'/g, "''")}'`)
              .join(",");
            sql = `SELECT * FROM ${table} WHERE LOWER(unique_customer_identifier) IN (${ids})`;
          } else {
            // No limit configured → cap at 50k rows so the snapshot blob
            // stays under storage size limits.
            sql = `SELECT * FROM ${table} LIMIT 50000`;
          }

          const client = await motherduckClient(cfg);
          let parsedHeaders: string[] = [];
          let parsedRows: unknown[][] = [];
          try {
            const res = await client.query({ text: sql, rowMode: "array" });
            parsedHeaders = res.fields.map((f) => f.name);
            parsedRows = (res.rows as unknown[][]) ?? [];
          } finally {
            await client.end().catch(() => {});
          }

          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          // Sampling/filtering bookkeeping for downstream files
          let filteredRows = parsedRows;
          let filteredTotal = parsedRows.length;
          let filterNote: string | undefined;
          const idColIdx = parsedHeaders.findIndex(
            (h) => h.toLowerCase() === "unique_customer_identifier",
          );

          if (kind === "customer_info" && customerLimit && customerLimit > 0) {
            if (idColIdx === -1) {
              filterNote =
                "customer_info missing unique_customer_identifier — limit not propagated";
            } else {
              for (const r of parsedRows) {
                const v = r[idColIdx];
                if (v != null) customerIds.add(String(v).toLowerCase());
              }
              summary._customerIds = Array.from(customerIds);
              filterNote = `Randomly sampled ${filteredTotal} customers from MotherDuck`;
            }
          } else if (kind !== "customer_info" && customerIds.size > 0) {
            filterNote = `Filtered to ${filteredTotal} rows for ${customerIds.size} sampled customers`;
          }

          await supabaseAdmin
            .from("pull_jobs")
            .update({
              status: "uploading",
              current_rows_read: filteredTotal,
              current_bytes_total: null,
              current_bytes_done: null,
            })
            .eq("id", job.id);

          if (await isCancelled(job.id)) return json(200, { jobId: job.id, status: "cancelled" });

          // Estimate snapshot bytes for the summary
          const snapshot = JSON.stringify({
            source: "motherduck",
            remote: `${cfg.database}.${cfg.schema || "main"}.${kind}`,
            fetched_at: new Date().toISOString(),
            format: "rows",
            total_rows: filteredTotal,
            headers: parsedHeaders,
            rows: filteredRows.slice(0, 50_000),
          });
          const bytes = new TextEncoder().encode(snapshot).byteLength;

          summary[kind] = {
            rows: filteredTotal,
            bytes,
            format: "rows",
            ...(filterNote ? { note: filterNote } : {}),
          } as never;

          await supabaseAdmin.storage
            .from("datasets")
            .upload(
              `motherduck/${conn.id}/${kind}.json`,
              new Blob([snapshot], { type: "application/json" }),
              { upsert: true, contentType: "application/json" },
            );

          await supabaseAdmin.from("active_data_sources").upsert(
            {
              kind,
              origin: "live",
              connection_id: conn.id,
              remote_name: `${cfg.database}.${cfg.schema || "main"}.${kind}`,
              label: `MotherDuck · ${kind}`,
              rows_count: filteredTotal,
              activated_at: new Date().toISOString(),
            },
            { onConflict: "kind" },
          );

          await advanceJob(job.id, pending, summary);
          kickSelf();
          return json(200, { jobId: job.id, status: "file_done", file: table });
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
    void fetch(`${origin}/api/public/hooks/pull-motherduck-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {
      /* cron will pick it up */
    });
  } catch {
    /* no request context */
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
