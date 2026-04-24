import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, requireAdmin } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Receives the externally-trained model bundle from the user's laptop:
 *   - metrics: contents of model_metrics.json
 *   - top_customers: contents of top_50_customers.json (optional)
 *
 * Inserts a model_runs row with triggered_by='external' and (optionally) a
 * batch of top_customers rows linked to that run. The dashboard's
 * liveDataStore reads the latest successful model_runs row, so KPIs light
 * up immediately. The /explainability page reads the latest top_customers
 * batch.
 */
export const Route = createFileRoute("/api/admin/training/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let body: {
          metrics?: Record<string, unknown>;
          top_customers?: Array<Record<string, unknown>>;
          notes?: string;
        };
        try {
          body = await request.json();
        } catch {
          return jsonError(400, "Invalid JSON body");
        }

        if (!body.metrics && !body.top_customers) {
          return jsonError(400, "Provide metrics and/or top_customers");
        }

        let runId: string | null = null;

        if (body.metrics) {
          const finished_at = new Date().toISOString();
          const { data, error } = await supabaseAdmin
            .from("model_runs")
            .insert({
              status: "success",
              triggered_by: "external",
              metrics: body.metrics as never,
              finished_at,
            })
            .select("id")
            .single();
          if (error) return jsonError(500, error.message);
          runId = data.id;
        } else {
          // Attach top_customers to the most recent successful run if no metrics uploaded
          const { data } = await supabaseAdmin
            .from("model_runs")
            .select("id")
            .eq("status", "success")
            .order("finished_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          runId = data?.id ?? null;
        }

        let topInserted = 0;
        if (body.top_customers?.length) {
          // Replace previous top-50 batch for this run (clean swap)
          if (runId) {
            await supabaseAdmin.from("top_customers").delete().eq("model_run_id", runId);
          }

          const rows = body.top_customers.slice(0, 100).map((c, i) => {
            const customerId =
              (c.customer_id as string) ?? (c.id as string) ?? `unknown_${i}`;
            const churnProb =
              typeof c.churn_prob === "number"
                ? c.churn_prob
                : typeof c.score === "number"
                  ? c.score
                  : 0;
            return {
              model_run_id: runId,
              customer_id: String(customerId),
              rank: typeof c.rank === "number" ? c.rank : i + 1,
              churn_prob: churnProb,
              reason_codes: (c.reason_codes ?? []) as never,
              recommended_nba: (c.recommended_nba as string) ?? null,
              expected_save_gbp:
                typeof c.expected_save_gbp === "number" ? c.expected_save_gbp : null,
              features: (c.features ?? null) as never,
            };
          });

          const { error } = await supabaseAdmin.from("top_customers").insert(rows);
          if (error) return jsonError(500, error.message);
          topInserted = rows.length;
        }

        return jsonOk({
          ok: true,
          model_run_id: runId,
          top_customers_inserted: topInserted,
          message: `Imported${body.metrics ? " model metrics" : ""}${
            topInserted ? ` + ${topInserted} top customer(s)` : ""
          }.`,
        });
      },
    },
  },
});
