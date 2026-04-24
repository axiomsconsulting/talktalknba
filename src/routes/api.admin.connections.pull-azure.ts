import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, requireAdmin, type AzureRepoConfig } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Queues an async pull job. Returns immediately with the job id.
 * The actual download/parse runs in /api/public/hooks/pull-azure-worker,
 * driven by pg_cron every 30 seconds (one file per tick to stay under
 * Worker CPU limits).
 */
export const Route = createFileRoute("/api/admin/connections/pull-azure")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string;
        try {
          userId = await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config")
          .eq("kind", "azure_repo")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Azure connection not configured");

        const cfg = (conn.config ?? {}) as Partial<AzureRepoConfig>;
        if (!cfg.organization || !cfg.project || !cfg.repository || !cfg.files) {
          return jsonError(400, "Azure repo config missing organization/project/repository/files");
        }

        // Cancel any stuck in-flight job older than 10 minutes
        await supabaseAdmin
          .from("pull_jobs")
          .update({ status: "error", error: "Superseded by a new pull", finished_at: new Date().toISOString() })
          .in("status", ["queued", "downloading", "parsing", "uploading"])
          .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

        const pending = Object.entries(cfg.files).map(([kind, path]) => ({ kind, path }));

        const { data: job, error: jobErr } = await supabaseAdmin
          .from("pull_jobs")
          .insert({
            connection_id: conn.id,
            status: "queued",
            files_total: pending.length,
            files_done: 0,
            pending_files: pending as never,
            triggered_by: userId,
          })
          .select("id")
          .single();
        if (jobErr) return jsonError(500, jobErr.message);

        // Kick the worker once now so the user sees progress without waiting
        // for the next cron tick (best-effort, ignore failures).
        try {
          const origin = new URL(request.url).origin;
          void fetch(`${origin}/api/public/hooks/pull-azure-worker`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
        } catch {
          /* cron will pick it up */
        }

        return jsonOk({ jobId: job.id, status: "queued", filesTotal: pending.length }, 202);
      },
    },
  },
});
