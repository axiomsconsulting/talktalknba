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

        // Optional body: { customerLimit: number | null }
        // null/0/missing → pull everything (today's behaviour). Positive int →
        // sample that many customer_info rows and filter calls/cease/usage to
        // the same unique customer IDs so files stay self-consistent and the
        // worker stays well under the per-tick CPU budget.
        let customerLimit: number | null = null;
        try {
          const body = (await request.json()) as { customerLimit?: number | null };
          if (body && typeof body.customerLimit === "number" && Number.isFinite(body.customerLimit) && body.customerLimit > 0) {
            customerLimit = Math.floor(body.customerLimit);
          }
        } catch {
          /* no body, default = pull everything */
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

        // customer_info MUST run first when limiting — it produces the
        // canonical ID set the worker uses to filter the other files.
        const ORDER = ["customer_info", "calls", "cease", "usage"];
        const pending = Object.entries(cfg.files)
          .map(([kind, path]) => ({ kind, path }))
          .sort((a, b) => {
            const ai = ORDER.indexOf(a.kind);
            const bi = ORDER.indexOf(b.kind);
            const av = ai === -1 ? 99 : ai;
            const bv = bi === -1 ? 99 : bi;
            return av - bv;
          });

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
        // for the next cron tick. We deliberately AWAIT the fetch (not just
        // fire-and-forget — Cloudflare-style serverless runtimes terminate
        // background promises once the response is returned). The worker only
        // processes ONE file per call, so this stays well under the per-request
        // CPU budget; the worker self-chains for the remaining files.
        try {
          const origin = new URL(request.url).origin;
          await Promise.race([
            fetch(`${origin}/api/public/hooks/pull-azure-worker`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }),
            // Hard cap so a slow worker tick can never block the user-visible
            // POST. Cron will pick up the job on the next 30-second tick.
            new Promise((resolve) => setTimeout(resolve, 25_000)),
          ]).catch(() => {
            /* cron will pick it up */
          });
        } catch {
          /* cron will pick it up */
        }

        return jsonOk({ jobId: job.id, status: "queued", filesTotal: pending.length, customerLimit }, 202);
      },
    },
  },
});
