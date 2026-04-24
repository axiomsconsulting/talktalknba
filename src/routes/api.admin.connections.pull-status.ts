import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, requireAdmin } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Returns the latest pull_job for the Azure connection. Frontend polls this
 * every 2 seconds while a job is active to render the progress meter.
 */
export const Route = createFileRoute("/api/admin/connections/pull-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let body: { jobId?: string } = {};
        try {
          body = (await request.json()) as { jobId?: string };
        } catch {
          /* no body is fine — return latest */
        }

        let q = supabaseAdmin
          .from("pull_jobs")
          .select(
            "id, status, files_total, files_done, current_kind, current_file, current_bytes_total, current_bytes_done, current_rows_read, started_at, updated_at, finished_at, summary, error",
          );

        const { data, error } = body.jobId
          ? await q.eq("id", body.jobId).maybeSingle()
          : await q.order("started_at", { ascending: false }).limit(1).maybeSingle();

        if (error) return jsonError(500, error.message);
        return jsonOk({ job: data ?? null });
      },
    },
  },
});
