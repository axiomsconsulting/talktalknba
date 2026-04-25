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

        // Introspect actual column names — schemas vary between projects
        // (e.g. crm_package_name vs package, sales_channel vs region).
        let availableCols = new Set<string>();
        try {
          const colsOut = await motherduckQuery(
            fullCfg,
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = $1
             ${cfg.schema ? "AND table_schema = $2" : ""}`,
            cfg.schema ? ["customer_info", cfg.schema] : ["customer_info"],
          );
          availableCols = new Set(
            (colsOut.rows ?? []).map((r) => String(r[0] ?? "").toLowerCase()),
          );
        } catch (e) {
          console.warn("[facets-motherduck] column introspection failed", (e as Error)?.message);
        }
        const has = (c: string) => availableCols.has(c.toLowerCase());
        const pick = (...candidates: string[]): string | null => {
          for (const c of candidates) if (has(c)) return c;
          return null;
        };

        const distinctList = async (
          col: string | null,
          limit = 100,
        ): Promise<string[]> => {
          if (!col) return [];
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
          colExpr: string | null,
        ): Promise<{ min: number; max: number }> => {
          if (!colExpr) return { min: 0, max: 0 };
          const r = await safeQuery<{ rows: unknown[][] }>(
            `SELECT COALESCE(MIN(TRY_CAST(${colExpr} AS DOUBLE)), 0),
                    COALESCE(MAX(TRY_CAST(${colExpr} AS DOUBLE)), 0)
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

        const packageCol = pick("crm_package_name", "package", "package_name", "product_name");
        const regionCol = pick("region", "country_region", "billing_region", "sales_channel");
        const contractStatusCol = pick("contract_status", "contract_state");
        const tenureExpr = pick("tenure_months") ?? (has("tenure_days") ? "(tenure_days / 30.0)" : null);
        const mrrExpr = pick("mrr", "monthly_revenue", "arpu", "monthly_arpu");
        const downloadExpr = pick("monthly_download_gb", "monthly_data_gb", "download_gb");
        const speedDeficitExpr = pick("speed_deficit_pct");
        const loyaltyExpr = pick("loyalty_calls_90d", "calls_90d");
        const holdExpr = pick("total_hold_seconds", "hold_seconds");

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
          distinctList(regionCol),
          distinctList(packageCol, 200),
          distinctList(contractStatusCol),
          numericRange(tenureExpr),
          numericRange(mrrExpr),
          numericRange(downloadExpr),
          numericRange(speedDeficitExpr),
          numericRange(loyaltyExpr),
          numericRange(holdExpr),
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
