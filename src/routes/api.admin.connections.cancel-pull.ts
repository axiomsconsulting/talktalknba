import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, requireAdmin } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Cancel an in-flight pull job. The worker checks `status === 'cancelled'`
 * between download / parse / upload steps and stops cleanly. Files already
 * archived stay archived (idempotent), but no further work is started.
 */
export const Route = createFileRoute("/api/admin/connections/cancel-pull")({
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
          /* fall through — cancel latest active job */
        }

        const baseUpdate = {
          status: "cancelled" as const,
          finished_at: new Date().toISOString(),
          error: "Cancelled by operator",
        };

        if (body.jobId) {
          const { error } = await supabaseAdmin
            .from("pull_jobs")
            .update(baseUpdate)
            .eq("id", body.jobId)
            .in("status", ["queued", "downloading", "parsing", "uploading"]);
          if (error) return jsonError(500, error.message);
          return jsonOk({ ok: true, jobId: body.jobId });
        }

        // Fallback: cancel everything still active
        const { error } = await supabaseAdmin
          .from("pull_jobs")
          .update(baseUpdate)
          .in("status", ["queued", "downloading", "parsing", "uploading"]);
        if (error) return jsonError(500, error.message);
        return jsonOk({ ok: true });
      },
    },
  },
});
