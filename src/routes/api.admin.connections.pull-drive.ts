import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, requireAdmin } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Queues an async Google Drive pull job. Mirrors pull-azure.ts but uses the
 * `data_source_files` index (populated by the discovery/ingest step) as the
 * source of truth for what to download.
 *
 * Body: { customerLimit?: number | null }
 *   • null/0/missing → pull every row (no cohort sampling)
 *   • 1..N positive  → randomly sample that many customer_info rows; downstream
 *                      files (calls/cease/usage) are filtered to that ID set so
 *                      the cohort stays self-consistent.
 */
export const Route = createFileRoute("/api/admin/connections/pull-drive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string;
        try {
          userId = await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let customerLimit: number | null = null;
        try {
          const body = (await request.json()) as { customerLimit?: number | null };
          if (
            body &&
            typeof body.customerLimit === "number" &&
            Number.isFinite(body.customerLimit) &&
            body.customerLimit > 0
          ) {
            customerLimit = Math.floor(body.customerLimit);
          }
        } catch {
          /* no body — pull everything */
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config, enabled")
          .eq("kind", "gdrive")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Google Drive connection not configured");
        if (!conn.enabled) return jsonError(400, "Google Drive connection is disabled");

        // Pull the latest set of discovered files from the index.
        const { data: discovered, error: discErr } = await supabaseAdmin
          .from("data_source_files")
          .select("kind, remote_id, remote_name")
          .eq("connection_id", conn.id);
        if (discErr) return jsonError(500, discErr.message);
        if (!discovered || discovered.length === 0) {
          return jsonError(
            400,
            "No Drive files discovered yet — run 'Index files' first to populate the file list",
          );
        }

        // customer_info MUST run first when a limit is set so its sampled IDs
        // can drive filtering of the other kinds.
        const ORDER = ["customer_info", "calls", "cease", "usage"];
        const pending = discovered
          .filter((f) => ORDER.includes(f.kind))
          .map((f) => ({ kind: f.kind, path: f.remote_name ?? f.remote_id, remote_id: f.remote_id }))
          .sort((a, b) => {
            const ai = ORDER.indexOf(a.kind);
            const bi = ORDER.indexOf(b.kind);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });

        if (pending.length === 0) {
          return jsonError(
            400,
            "No customer_info / calls / cease / usage files discovered — check filenames",
          );
        }

        // Supersede any stuck in-flight job older than 10 minutes
        await supabaseAdmin
          .from("pull_jobs")
          .update({
            status: "error",
            error: "Superseded by a new pull",
            finished_at: new Date().toISOString(),
          })
          .in("status", ["queued", "downloading", "parsing", "uploading"])
          .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

        const initialSummary: Record<string, unknown> = { _config: { customerLimit } };

        const { data: job, error: jobErr } = await supabaseAdmin
          .from("pull_jobs")
          .insert({
            connection_id: conn.id,
            status: "queued",
            files_total: pending.length,
            files_done: 0,
            pending_files: pending as never,
            triggered_by: userId,
            summary: initialSummary as never,
          })
          .select("id")
          .single();
        if (jobErr) return jsonError(500, jobErr.message);

        // Kick the Drive worker once now so the user sees progress immediately.
        try {
          const origin = new URL(request.url).origin;
          await Promise.race([
            fetch(`${origin}/api/public/hooks/pull-drive-worker`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }),
            new Promise((resolve) => setTimeout(resolve, 25_000)),
          ]).catch(() => {
            /* cron will pick it up */
          });
        } catch {
          /* cron will pick it up */
        }

        return jsonOk(
          { jobId: job.id, status: "queued", filesTotal: pending.length, customerLimit },
          202,
        );
      },
    },
  },
});
