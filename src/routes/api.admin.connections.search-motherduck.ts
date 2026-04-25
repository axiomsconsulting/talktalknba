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
 * Server-paged customer search against the live MotherDuck `customer_info`
 * table. Powers the Explainability page when MotherDuck is the active live
 * source.
 *
 * Body: { q?: string; limit?: number (1..200, default 50); offset?: number;
 *         id?: string }  // id forces an exact lookup
 *
 * Response: {
 *   headers: string[]; rows: unknown[][];
 *   total: number;     // matches for this query
 *   totalAll: number;  // total customer_info rows (for the header chip)
 * }
 */
export const Route = createFileRoute("/api/admin/connections/search-motherduck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let body: { q?: string; limit?: number; offset?: number; id?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* no body */
        }

        const limit = Math.max(1, Math.min(200, Math.floor(Number(body.limit ?? 50)) || 50));
        const offset = Math.max(0, Math.floor(Number(body.offset ?? 0)) || 0);
        const q = typeof body.q === "string" ? body.q.trim() : "";
        const id = typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;

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
        const tbl = motherduckTableFor(fullCfg, "customer_info");

        try {
          // Total count (cheap, all rows)
          const totalAllOut = await motherduckQuery(
            fullCfg,
            `SELECT count(*)::bigint FROM ${tbl}`,
          );
          const totalAll = Number(totalAllOut.rows?.[0]?.[0] ?? 0);

          // Build search SQL.
          let dataSql: string;
          let countSql: string;
          const dataValues: unknown[] = [];
          const countValues: unknown[] = [];

          if (id) {
            dataSql = `SELECT * FROM ${tbl} WHERE unique_customer_identifier = $1 LIMIT 1`;
            dataValues.push(id);
            countSql = `SELECT count(*)::bigint FROM ${tbl} WHERE unique_customer_identifier = $1`;
            countValues.push(id);
          } else if (q) {
            // Cast to varchar so ILIKE works against any column type we pull
            // (uuid / numeric IDs included).
            const like = `%${q}%`;
            const where =
              `CAST(unique_customer_identifier AS VARCHAR) ILIKE $1` +
              ` OR CAST(COALESCE(package, '') AS VARCHAR) ILIKE $1` +
              ` OR CAST(COALESCE(region, '') AS VARCHAR) ILIKE $1`;
            dataSql = `SELECT * FROM ${tbl} WHERE ${where} ORDER BY unique_customer_identifier LIMIT ${limit} OFFSET ${offset}`;
            dataValues.push(like);
            countSql = `SELECT count(*)::bigint FROM ${tbl} WHERE ${where}`;
            countValues.push(like);
          } else {
            dataSql = `SELECT * FROM ${tbl} ORDER BY unique_customer_identifier LIMIT ${limit} OFFSET ${offset}`;
            countSql = `SELECT count(*)::bigint FROM ${tbl}`;
          }

          const dataOut = await motherduckQuery(fullCfg, dataSql, dataValues);
          let total = totalAll;
          if (q || id) {
            const countOut = await motherduckQuery(fullCfg, countSql, countValues);
            total = Number(countOut.rows?.[0]?.[0] ?? 0);
          }

          // Best-effort: don't update last_run_at on every keystroke — only on a
          // populated query — to avoid hammering the table.
          if (q || id) {
            await supabaseAdmin
              .from("data_connections")
              .update({
                last_status: "success",
                last_error: null,
                last_run_at: new Date().toISOString(),
              })
              .eq("id", conn.id);
          }

          return jsonOk({
            headers: dataOut.headers,
            rows: dataOut.rows,
            total,
            totalAll,
            limit,
            offset,
          });
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          return jsonError(500, msg);
        }
      },
    },
  },
});
