import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, requireAdmin, databricksTriggerJob } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/admin/connections/retrain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("config")
          .eq("kind", "databricks")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        const jobId = (conn?.config as { job_id?: string } | null)?.job_id;
        if (!jobId)
          return jsonError(400, "Databricks Job ID is not configured under Admin → Connections");

        const { data: run, error: runErr } = await supabaseAdmin
          .from("model_runs")
          .insert({ status: "running", triggered_by: "manual" })
          .select("id")
          .single();
        if (runErr) return jsonError(500, runErr.message);

        try {
          const trig = await databricksTriggerJob(jobId, `Lovable run ${run.id}`);
          await supabaseAdmin
            .from("model_runs")
            .update({ databricks_run_id: trig.run_id ? String(trig.run_id) : null })
            .eq("id", run.id);
          return jsonOk({
            run_id: run.id,
            databricks_run_id: trig.run_id,
            message: `Databricks job ${jobId} triggered (run ${trig.run_id ?? "?"}). Results will land here when the job posts to /api/public/ingest/artefacts.`,
          });
        } catch (e) {
          await supabaseAdmin
            .from("model_runs")
            .update({ status: "error", error: (e as Error).message, finished_at: new Date().toISOString() })
            .eq("id", run.id);
          if (e instanceof Response) return e;
          return jsonError(500, (e as Error).message);
        }
      },
    },
  },
});
