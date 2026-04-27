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
 * Returns full-population aggregates for the customer base, computed inside
 * MotherDuck — no row transfer. The dashboards use this for headline KPIs
 * (total customers, ARPU, revenue-at-risk, segment counts) so the figures
 * always reflect the entire 3.5M-customer base, even though the in-memory
 * working set used for drilldowns is a 50k uniform random sample.
 *
 * Response shape (all numbers are full-base totals):
 *   {
 *     totalCustomers: number,
 *     totalActive: number,
 *     totalCeased: number,
 *     totalRevenueMrr: number,        // £ / month
 *     averageMrr: number,
 *     averageTenureMonths: number,
 *     packageBreakdown: { package: string; customers: number; mrr: number }[],
 *     contractBreakdown: { status: string; customers: number }[],
 *     regionBreakdown: { region: string; customers: number }[],
 *     tenureHistogram: { bucket: string; customers: number }[],
 *     computedAt: string,
 *   }
 */
export const Route = createFileRoute("/api/admin/connections/aggregate-motherduck")({
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

        // Introspect available columns — schemas vary slightly between projects.
        let cols = new Set<string>();
        try {
          const colsOut = await motherduckQuery(
            fullCfg,
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = $1
             ${cfg.schema ? "AND table_schema = $2" : ""}`,
            cfg.schema ? ["customer_info", cfg.schema] : ["customer_info"],
          );
          cols = new Set(
            (colsOut.rows ?? []).map((r) => String(r[0] ?? "").toLowerCase()),
          );
        } catch (e) {
          console.warn("[aggregate-motherduck] introspection failed", (e as Error)?.message);
        }
        const has = (c: string) => cols.has(c.toLowerCase());
        const pick = (...candidates: string[]): string | null => {
          for (const c of candidates) if (has(c)) return c;
          return null;
        };

        const idCol = pick("unique_customer_identifier") ?? "unique_customer_identifier";
        const mrrCol = pick("mrr", "monthly_revenue", "arpu", "monthly_arpu");
        const tenureExpr =
          pick("tenure_months") ??
          (has("tenure_days") ? "(tenure_days / 30.0)" : null);
        const packageCol = pick(
          "crm_package_name",
          "package",
          "package_name",
          "product_name",
        );
        const contractCol = pick("contract_status", "contract_state");
        const regionCol = pick("region", "country_region", "billing_region", "sales_channel");
        const ceasedCol = pick("is_ceased", "ceased", "ceased_flag");

        const safe = async <T,>(sql: string, fallback: T): Promise<T> => {
          try {
            const r = await motherduckQuery(fullCfg, sql);
            return r as unknown as T;
          } catch (e) {
            console.warn("[aggregate-motherduck] query failed:", sql, (e as Error)?.message);
            return fallback;
          }
        };

        // Headline counts. We dedupe by customer id so monthly-fact tables
        // produce one customer per id even if rows are duplicated.
        const totalsRow = await safe<{ rows: unknown[][] }>(
          `SELECT
              COUNT(DISTINCT ${idCol}),
              ${ceasedCol ? `COUNT(DISTINCT CASE WHEN ${ceasedCol} THEN ${idCol} END)` : "0"},
              ${mrrCol ? `AVG(TRY_CAST(${mrrCol} AS DOUBLE))` : "0"},
              ${mrrCol ? `SUM(TRY_CAST(${mrrCol} AS DOUBLE))` : "0"},
              ${tenureExpr ? `AVG(TRY_CAST(${tenureExpr} AS DOUBLE))` : "0"}
            FROM ${ci}`,
          { rows: [[0, 0, 0, 0, 0]] },
        );
        const t = (totalsRow.rows ?? [[0, 0, 0, 0, 0]])[0] ?? [0, 0, 0, 0, 0];
        const totalCustomers = Number(t[0] ?? 0);
        const totalCeased = Number(t[1] ?? 0);
        const totalActive = Math.max(0, totalCustomers - totalCeased);
        const averageMrr = Number(t[2] ?? 0);
        const totalRevenueMrr = Number(t[3] ?? 0);
        const averageTenureMonths = Number(t[4] ?? 0);

        const breakdown = async (
          col: string | null,
          alias: string,
          extraSelect = "",
          limit = 25,
        ): Promise<{ rows: unknown[][] }> => {
          if (!col) return { rows: [] };
          return safe<{ rows: unknown[][] }>(
            `SELECT ${col} AS ${alias},
                    COUNT(DISTINCT ${idCol})${extraSelect}
             FROM ${ci}
             WHERE ${col} IS NOT NULL
             GROUP BY ${col}
             ORDER BY 2 DESC
             LIMIT ${limit}`,
            { rows: [] },
          );
        };

        const [pkgRows, contractRows, regionRows] = await Promise.all([
          breakdown(
            packageCol,
            "pkg",
            mrrCol ? `, SUM(TRY_CAST(${mrrCol} AS DOUBLE))` : ", 0",
            50,
          ),
          breakdown(contractCol, "status"),
          breakdown(regionCol, "region", "", 30),
        ]);

        const packageBreakdown = (pkgRows.rows ?? []).map((r) => ({
          package: String(r[0] ?? "Unknown"),
          customers: Number(r[1] ?? 0),
          mrr: Number(r[2] ?? 0),
        }));
        const contractBreakdown = (contractRows.rows ?? []).map((r) => ({
          status: String(r[0] ?? "Unknown"),
          customers: Number(r[1] ?? 0),
        }));
        const regionBreakdown = (regionRows.rows ?? []).map((r) => ({
          region: String(r[0] ?? "Unknown"),
          customers: Number(r[1] ?? 0),
        }));

        // Tenure histogram with sensible buckets for telco.
        let tenureHistogram: { bucket: string; customers: number }[] = [];
        if (tenureExpr) {
          const histRow = await safe<{ rows: unknown[][] }>(
            `SELECT
                CASE
                  WHEN ${tenureExpr} < 6 THEN '0-6 months'
                  WHEN ${tenureExpr} < 12 THEN '6-12 months'
                  WHEN ${tenureExpr} < 24 THEN '1-2 years'
                  WHEN ${tenureExpr} < 36 THEN '2-3 years'
                  WHEN ${tenureExpr} < 60 THEN '3-5 years'
                  ELSE '5+ years'
                END AS bucket,
                COUNT(DISTINCT ${idCol}) AS customers
             FROM ${ci}
             GROUP BY 1
             ORDER BY MIN(TRY_CAST(${tenureExpr} AS DOUBLE))`,
            { rows: [] },
          );
          tenureHistogram = (histRow.rows ?? []).map((r) => ({
            bucket: String(r[0] ?? ""),
            customers: Number(r[1] ?? 0),
          }));
        }

        return jsonOk({
          totalCustomers,
          totalActive,
          totalCeased,
          totalRevenueMrr,
          averageMrr,
          averageTenureMonths,
          packageBreakdown,
          contractBreakdown,
          regionBreakdown,
          tenureHistogram,
          computedAt: new Date().toISOString(),
        });
      },
    },
  },
});
