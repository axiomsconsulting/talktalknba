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
 * Returns filter facets for the customer search:
 *   - distinct values (capped) for region, package, contract_status
 *   - min/max for tenure_months, mrr, monthly_download_gb
 *
 * Pulled live from the MotherDuck `customer_info` table when active. The
 * client falls back to in-memory facets when MotherDuck is disabled.
 *
 * Response: {
 *   regions: string[]; packages: string[]; contractStatuses: string[];
 *   tenureMonths: { min: number; max: number };
 *   mrrGbp: { min: number; max: number };
 *   monthlyDownloadGb: { min: number; max: number };
 *   speedDeficitPct: { min: number; max: number };
 *   loyaltyCalls90d: { min: number; max: number };
 *   holdSeconds: { min: number; max: number };
 *   totalCustomers: number;
 * }
 */
export const Route = createFileRoute("/api/admin/connections/facets-motherduck")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

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
        const ci = motherduckTableFor(fullCfg, "customer_info");

        // Helper that returns an empty/safe shape if the column doesn't exist
        // — we don't want a single missing column to break the whole facets
        // call.
        const safeQuery = async <T,>(sql: string, fallback: T): Promise<T> => {
          try {
            const r = await motherduckQuery(fullCfg, sql);
            return r as unknown as T;
          } catch (e) {
            console.warn("[facets-motherduck] query failed:", sql, (e as Error)?.message);
            return fallback;
          }
        };

        const distinctList = async (col: string, limit = 100): Promise<string[]> => {
          const r = await safeQuery<{ rows: unknown[][] }>(
            `SELECT DISTINCT CAST(${col} AS VARCHAR) FROM ${ci}
             WHERE ${col} IS NOT NULL AND CAST(${col} AS VARCHAR) <> ''
             ORDER BY 1 LIMIT ${limit}`,
            { rows: [] },
          );
          return (r.rows ?? [])
            .map((row) => String(row[0] ?? ""))
            .filter((v) => v.length > 0);
        };

        const numericRange = async (
          col: string,
        ): Promise<{ min: number; max: number }> => {
          const r = await safeQuery<{ rows: unknown[][] }>(
            `SELECT COALESCE(MIN(TRY_CAST(${col} AS DOUBLE)), 0),
                    COALESCE(MAX(TRY_CAST(${col} AS DOUBLE)), 0)
             FROM ${ci}`,
            { rows: [[0, 0]] },
          );
          const row = (r.rows ?? [[0, 0]])[0] ?? [0, 0];
          return { min: Number(row[0] ?? 0), max: Number(row[1] ?? 0) };
        };

        const totalRow = await safeQuery<{ rows: unknown[][] }>(
          `SELECT COUNT(*)::bigint FROM ${ci}`,
          { rows: [[0]] },
        );
        const totalCustomers = Number((totalRow.rows ?? [[0]])[0]?.[0] ?? 0);

        const [
          regions,
          packages,
          contractStatuses,
          tenureMonths,
          mrrGbp,
          monthlyDownloadGb,
          speedDeficitPct,
          loyaltyCalls90d,
          holdSeconds,
        ] = await Promise.all([
          distinctList("region"),
          distinctList("package", 200),
          distinctList("contract_status"),
          numericRange("tenure_months"),
          // MRR may live under different aliases — coalesce common names.
          numericRange("COALESCE(mrr, monthly_revenue, arpu, 0)"),
          numericRange("COALESCE(monthly_download_gb, monthly_data_gb, 0)"),
          numericRange("COALESCE(speed_deficit_pct, 0)"),
          numericRange("COALESCE(loyalty_calls_90d, calls_90d, 0)"),
          numericRange("COALESCE(total_hold_seconds, hold_seconds, 0)"),
        ]);

        return jsonOk({
          regions,
          packages,
          contractStatuses,
          tenureMonths,
          mrrGbp,
          monthlyDownloadGb,
          speedDeficitPct,
          loyaltyCalls90d,
          holdSeconds,
          totalCustomers,
        });
      },
    },
  },
});
