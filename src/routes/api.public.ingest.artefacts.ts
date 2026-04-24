// Public ingestion endpoint for the external training pipeline.
// Authenticated via a shared bearer token (DATABRICKS_INGEST_TOKEN).
// The Databricks job (or any external trainer) posts the model_stats /
// feature_importance / ROC / per-segment metrics here when training finishes.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function jerr(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Metrics = {
  model_type?: string;
  hyperparameters?: Record<string, unknown>;
  performance_metrics?: Record<string, number>;
  confusion_matrix?: Record<string, number>;
  dataset_split?: { train_size?: number; test_size?: number };
  roc_curve?: Array<{ fpr: number; tpr: number; threshold: number }>;
  segment_metrics?: Array<{ segment: string; precision: number; recall: number; n: number }>;
  feature_importance?: Array<{ feature: string; importance: number }>;
  roi_params?: Record<string, number>;
  segment_summary?: Array<Record<string, unknown>>;
};

export const Route = createFileRoute("/api/public/ingest/artefacts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.DATABRICKS_INGEST_TOKEN;
        if (!token) return jerr(503, "Ingestion endpoint not configured (missing DATABRICKS_INGEST_TOKEN)");
        const auth = request.headers.get("authorization");
        if (auth !== `Bearer ${token}`) return jerr(401, "Invalid token");

        let body: {
          run_id?: string;
          databricks_run_id?: string;
          status?: "success" | "error";
          error?: string;
          metrics?: Metrics;
          artefact_paths?: Record<string, string>;
        };
        try {
          body = await request.json();
        } catch {
          return jerr(400, "Invalid JSON body");
        }

        const status = body.status ?? "success";
        const finished_at = new Date().toISOString();

        if (body.run_id) {
          const { error } = await supabaseAdmin
            .from("model_runs")
            .update({
              status,
              metrics: body.metrics ?? null,
              artefact_paths: body.artefact_paths ?? null,
              error: body.error ?? null,
              databricks_run_id: body.databricks_run_id ?? null,
              finished_at,
            })
            .eq("id", body.run_id);
          if (error) return jerr(500, error.message);
        } else {
          const { error } = await supabaseAdmin.from("model_runs").insert({
            status,
            triggered_by: "external",
            metrics: body.metrics ?? null,
            artefact_paths: body.artefact_paths ?? null,
            error: body.error ?? null,
            databricks_run_id: body.databricks_run_id ?? null,
            finished_at,
          });
          if (error) return jerr(500, error.message);
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
