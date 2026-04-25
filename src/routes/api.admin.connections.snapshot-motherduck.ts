import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  motherduckQuery,
  motherduckTableFor,
  type MotherDuckConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Live snapshot endpoint: returns a capped page of every dataset kind
 * (customer_info / calls / cease / usage) directly from the online MotherDuck
 * database. No ingestion required — the in-memory customer store hydrates
 * itself from this on app boot when MotherDuck is the active source.
 *
 * Body: { rowLimit?: number (default 5000, max 20000) }
 *
 * Response: { kinds: { customer_info?: {headers, rows}; calls?, cease?, usage? } }
 */
export const Route = createFileRoute("/api/admin/connections/snapshot-motherduck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let body: { rowLimit?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* no body */
        }
        const rowLimit = Math.max(
          100,
          Math.min(20_000, Math.floor(Number(body.rowLimit ?? 5_000)) || 5_000),
        );

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config, enabled")
          .eq("kind", "motherduck")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "MotherDuck connection not configured");
        if (!conn.enabled) return jsonError(409, "MotherDuck connection is disabled");
        const cfg = (conn.config ?? {}) as Partial<MotherDuckConfig>;
        if (!cfg.database) return jsonError(400, "MotherDuck config missing database name");
        const fullCfg = cfg as MotherDuckConfig;

        const kinds = ["customer_info", "calls", "cease", "usage"] as const;
        const out: Record<string, { headers: string[]; rows: unknown[][] }> = {};
        const errors: Record<string, string> = {};

        for (const kind of kinds) {
          const tbl = motherduckTableFor(fullCfg, kind);
          // calls/usage tables can be huge — cap each independently.
          // customer_info pulls the first N rows ordered by id for stability.
          const sql =
            kind === "customer_info"
              ? `SELECT * FROM ${tbl} ORDER BY unique_customer_identifier LIMIT ${rowLimit}`
              : `SELECT * FROM ${tbl} LIMIT ${rowLimit}`;
          try {
            const res = await motherduckQuery(fullCfg, sql);
            out[kind] = { headers: res.headers, rows: res.rows };
          } catch (e) {
            errors[kind] = (e as Error)?.message ?? String(e);
          }
        }

        await supabaseAdmin
          .from("data_connections")
          .update({
            last_status: Object.keys(out).length > 0 ? "success" : "error",
            last_error: Object.keys(errors).length > 0 ? JSON.stringify(errors).slice(0, 500) : null,
            last_run_at: new Date().toISOString(),
          })
          .eq("id", conn.id);

        return jsonOk({
          kinds: out,
          errors: Object.keys(errors).length > 0 ? errors : undefined,
          connectionId: conn.id,
          rowLimit,
        });
      },
    },
  },
});
