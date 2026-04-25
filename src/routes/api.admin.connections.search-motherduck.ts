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

        let body: {
          q?: string;
          limit?: number;
          offset?: number;
          id?: string;
          filters?: {
            regions?: string[];
            packages?: string[];
            contractStatuses?: string[];
            riskTiers?: string[];
            personas?: string[];
            nbaTriggers?: string[];
            tenureMonths?: { min?: number; max?: number };
            mrrGbp?: { min?: number; max?: number };
            monthlyDownloadGb?: { min?: number; max?: number };
            speedDeficitPct?: { min?: number; max?: number };
            loyaltyCalls90d?: { min?: number; max?: number };
            holdSeconds?: { min?: number; max?: number };
          };
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* no body */
        }

        const limit = Math.max(1, Math.min(200, Math.floor(Number(body.limit ?? 50)) || 50));
        const offset = Math.max(0, Math.floor(Number(body.offset ?? 0)) || 0);
        const q = typeof body.q === "string" ? body.q.trim() : "";
        const id = typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;
        const f = body.filters ?? {};

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

          // Build WHERE clauses & values defensively. Each clause is wrapped
          // in TRY_CAST so a missing column never aborts the whole query.
          const whereParts: string[] = [];
          const values: unknown[] = [];
          let p = 1;

          const addInList = (col: string, vals: string[] | undefined) => {
            if (!vals || vals.length === 0) return;
            const placeholders = vals.map(() => `$${p++}`).join(", ");
            whereParts.push(`CAST(COALESCE(${col}, '') AS VARCHAR) IN (${placeholders})`);
            values.push(...vals);
          };

          const addRange = (
            colExpr: string,
            range: { min?: number; max?: number } | undefined,
          ) => {
            if (!range) return;
            const min = Number(range.min);
            const max = Number(range.max);
            if (Number.isFinite(min)) {
              whereParts.push(`TRY_CAST(${colExpr} AS DOUBLE) >= $${p++}`);
              values.push(min);
            }
            if (Number.isFinite(max)) {
              whereParts.push(`TRY_CAST(${colExpr} AS DOUBLE) <= $${p++}`);
              values.push(max);
            }
          };

          addInList("region", f.regions);
          addInList("package", f.packages);
          addInList("contract_status", f.contractStatuses);
          addRange("COALESCE(tenure_months, 0)", f.tenureMonths);
          addRange("COALESCE(mrr, monthly_revenue, arpu, 0)", f.mrrGbp);
          addRange("COALESCE(monthly_download_gb, monthly_data_gb, 0)", f.monthlyDownloadGb);
          addRange("COALESCE(speed_deficit_pct, 0)", f.speedDeficitPct);
          addRange("COALESCE(loyalty_calls_90d, calls_90d, 0)", f.loyaltyCalls90d);
          addRange("COALESCE(total_hold_seconds, hold_seconds, 0)", f.holdSeconds);

          if (id) {
            whereParts.push(`unique_customer_identifier = $${p++}`);
            values.push(id);
          } else if (q) {
            const like = `%${q}%`;
            whereParts.push(
              `(CAST(unique_customer_identifier AS VARCHAR) ILIKE $${p}` +
                ` OR CAST(COALESCE(package, '') AS VARCHAR) ILIKE $${p}` +
                ` OR CAST(COALESCE(region, '') AS VARCHAR) ILIKE $${p})`,
            );
            values.push(like);
            p++;
          }

          const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
          const dataSql = id
            ? `SELECT * FROM ${tbl} ${whereSql} LIMIT 1`
            : `SELECT * FROM ${tbl} ${whereSql} ORDER BY unique_customer_identifier LIMIT ${limit} OFFSET ${offset}`;
          const countSql = `SELECT count(*)::bigint FROM ${tbl} ${whereSql}`;

          const dataOut = await motherduckQuery(fullCfg, dataSql, values);
          let total = totalAll;
          if (whereParts.length > 0) {
            const countOut = await motherduckQuery(fullCfg, countSql, values);
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
