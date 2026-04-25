import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  type MotherDuckConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Queues an async pull job that copies customer_info / calls / cease / usage
 * tables from MotherDuck into the live snapshot store. The actual SQL runs in
 * /api/public/hooks/pull-motherduck-worker (one table per tick to keep each
 * Worker invocation under the CPU budget).
 */
export const Route = createFileRoute("/api/admin/connections/pull-motherduck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string;
        try {
          userId = await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        // Optional body: { customerLimit: number | null }
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
          /* no body */
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config")
          .eq("kind", "motherduck")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "MotherDuck connection not configured");

        const cfg = (conn.config ?? {}) as Partial<MotherDuckConfig>;
        if (!cfg.database) {
          return jsonError(400, "MotherDuck config missing database name");
        }

        // Cancel stuck in-flight jobs older than 10 minutes
        await supabaseAdmin
          .from("pull_jobs")
          .update({
            status: "error",
            error: "Superseded by a new pull",
            finished_at: new Date().toISOString(),
          })
          .in("status", ["queued", "downloading", "parsing", "uploading"])
          .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

        // customer_info MUST run first when limiting — it produces the
        // canonical ID set the worker uses to filter the other tables.
        const KINDS = ["customer_info", "calls", "cease", "usage"] as const;
        const pending = KINDS.map((kind) => ({ kind, path: kind }));

        const initialSummary: Record<string, unknown> = {
          _config: { customerLimit },
        };

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

        // Kick the worker once now so the user sees progress without waiting
        // for the next cron tick. Hard-cap so a slow tick never blocks.
        try {
          const origin = new URL(request.url).origin;
          await Promise.race([
            fetch(`${origin}/api/public/hooks/pull-motherduck-worker`, {
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
