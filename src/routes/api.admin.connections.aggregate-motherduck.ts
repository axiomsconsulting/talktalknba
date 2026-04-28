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

const CACHE_KEY = "motherduck:fullbase:v2";

/**
 * Returns full-population aggregates computed inside MotherDuck. Every dashboard
 * panel — KPIs, drill-downs, sensitivity, per-trigger, portfolio split, tier
 * characteristics, behavioural enrichment overlap, top-impacted customers —
 * reads from this single payload, so the figures always reflect the entire
 * 3.5M-customer base without ever shipping rows to the browser.
 *
 * Caching: persists the result to public.md_aggregate_cache (singleton row,
 * keyed by CACHE_KEY). Subsequent requests return the cached payload until an
 * admin sends `{ force: true }` from the "Full resync" button on /data.
 *
 * Body: { force?: boolean }
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

        let body: { force?: boolean } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* no body */
        }
        const force = !!body.force;

        // 1. Return cached payload unless `force` is set.
        if (!force) {
          const { data: cached } = await (supabaseAdmin.from("md_aggregate_cache") as unknown as {
            select: (cols: string) => {
              eq: (col: string, val: string) => {
                maybeSingle: () => Promise<{ data: { payload: unknown; computed_at: string } | null }>;
              };
            };
          })
            .select("payload, computed_at")
            .eq("cache_key", CACHE_KEY)
            .maybeSingle();
          if (cached?.payload) {
            return jsonOk({
              ...(cached.payload as Record<string, unknown>),
              cached: true,
              computedAt: cached.computed_at,
            });
          }
        }

        // 2. Resolve connection.
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
        const callsTbl = motherduckTableFor(fullCfg, "calls");
        const usageTbl = motherduckTableFor(fullCfg, "usage");
        const ceaseTbl = motherduckTableFor(fullCfg, "cease");

        // 3. Introspect customer_info columns.
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
          pick("tenure_months") ?? (has("tenure_days") ? "(tenure_days / 30.0)" : null);
        const tenureDaysExpr =
          pick("tenure_days") ?? (has("tenure_months") ? "(tenure_months * 30.0)" : null);
        const packageCol = pick(
          "crm_package_name",
          "package",
          "package_name",
          "product_name",
        );
        const contractCol = pick("contract_status", "contract_state");
        const regionCol = pick("region", "country_region", "billing_region", "sales_channel");
        const ceasedCol = pick("is_ceased", "ceased", "ceased_flag");
        const oocDaysCol = pick("ooc_days", "days_out_of_contract");
        const loyaltyCol = pick("loyalty_calls_90d", "calls_90d");
        const holdCol = pick("total_hold_seconds", "hold_seconds");
        const downloadCol = pick("monthly_download_gb", "download_gb", "monthly_data_gb");
        const uploadCol = pick("monthly_upload_gb", "upload_gb");
        const speedDeficitCol = pick("speed_deficit_pct");
        const churnProbCol = pick("churn_probability", "churn_prob", "risk_score");

        // Risk score derivation (mirrors src/data/customerMapping.ts heuristics
        // when no precomputed score exists in the table).
        const baseScoreSql = churnProbCol
          ? `TRY_CAST(${churnProbCol} AS DOUBLE)`
          : `(
              0.18
              + LEAST(0.40, ${tenureDaysExpr ? `CASE WHEN TRY_CAST(${tenureDaysExpr} AS DOUBLE) < 365 THEN 0.28 WHEN TRY_CAST(${tenureDaysExpr} AS DOUBLE) < 730 THEN 0.18 WHEN TRY_CAST(${tenureDaysExpr} AS DOUBLE) < 1825 THEN 0.05 ELSE -0.03 END` : "0"})
              + ${oocDaysCol ? `CASE WHEN TRY_CAST(${oocDaysCol} AS DOUBLE) > 60 THEN 0.20 WHEN TRY_CAST(${oocDaysCol} AS DOUBLE) > 0 THEN 0.10 ELSE 0 END` : "0"}
              + ${loyaltyCol ? `LEAST(0.22, GREATEST(0, TRY_CAST(${loyaltyCol} AS DOUBLE)) * 0.07)` : "0"}
              + ${holdCol ? `LEAST(0.12, GREATEST(0, TRY_CAST(${holdCol} AS DOUBLE)) / 3600.0 * 0.08)` : "0"}
            )`;
        const riskScoreExpr = `LEAST(0.98, GREATEST(0.02, ${baseScoreSql}))`;
        const riskTierExpr = `CASE
          WHEN ${riskScoreExpr} >= 0.65 THEN 'High'
          WHEN ${riskScoreExpr} >= 0.35 THEN 'Medium'
          ELSE 'Low'
        END`;

        // NBA trigger derivation — mirrors deriveNbaTrigger() in customers.ts.
        const nbaTriggerExpr = `CASE
          WHEN ${riskTierExpr} = 'High' AND ${oocDaysCol ? `TRY_CAST(${oocDaysCol} AS DOUBLE) > 0` : "FALSE"} THEN 'loyalty_save_desk'
          WHEN ${riskTierExpr} = 'High' AND ${loyaltyCol ? `TRY_CAST(${loyaltyCol} AS DOUBLE) >= 2` : "FALSE"} THEN 'loyalty_save_desk'
          WHEN ${riskTierExpr} IN ('High','Medium') AND ${speedDeficitCol ? `TRY_CAST(${speedDeficitCol} AS DOUBLE) >= 0.30` : "FALSE"} THEN 'free_tech_upgrade'
          WHEN ${riskTierExpr} IN ('High','Medium') AND ${downloadCol ? `TRY_CAST(${downloadCol} AS DOUBLE) > 800` : "FALSE"} THEN 'rightsize_email'
          WHEN ${riskTierExpr} = 'High' THEN 'competitor_match'
          WHEN ${riskTierExpr} = 'Medium' THEN 'rightsize_email'
          WHEN ${riskTierExpr} = 'Low' THEN 'suppress'
          ELSE 'nurture'
        END`;

        const safe = async <T,>(sql: string, fallback: T, values?: unknown[]): Promise<T> => {
          try {
            const r = await motherduckQuery(fullCfg, sql, values);
            return r as unknown as T;
          } catch (e) {
            console.warn("[aggregate-motherduck] query failed:", sql.slice(0, 200), (e as Error)?.message);
            return fallback;
          }
        };

        // 4. Headline counts (with deduplication by id).
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

        // 5. Risk-tier breakdown (full-base, computed via derived score).
        // Use a CTE so the score is computed once per row, then bucketed.
        const tierRow = await safe<{ rows: unknown[][] }>(
          `WITH scored AS (
             SELECT ${idCol} AS cid, ${riskTierExpr} AS tier,
                    ${tenureDaysExpr ? `TRY_CAST(${tenureDaysExpr} AS DOUBLE)` : "NULL"} AS tdays,
                    ${riskScoreExpr} AS score
             FROM ${ci}
           )
           SELECT tier, COUNT(DISTINCT cid), AVG(tdays), AVG(score)
           FROM scored GROUP BY tier`,
          { rows: [] },
        );
        const tierCounts: { tier: string; customers: number; avgTenureDays: number; avgRiskScore: number }[] =
          (tierRow.rows ?? []).map((r) => ({
            tier: String(r[0] ?? "Low"),
            customers: Number(r[1] ?? 0),
            avgTenureDays: Number(r[2] ?? 0),
            avgRiskScore: Number(r[3] ?? 0),
          }));

        const breakdown = async (
          col: string | null,
          alias: string,
          extraSelect = "",
          limit = 25,
        ): Promise<{ rows: unknown[][] }> => {
          if (!col) return { rows: [] };
          return safe<{ rows: unknown[][] }>(
            `SELECT ${col} AS ${alias}, COUNT(DISTINCT ${idCol})${extraSelect}
             FROM ${ci} WHERE ${col} IS NOT NULL
             GROUP BY ${col} ORDER BY 2 DESC LIMIT ${limit}`,
            { rows: [] },
          );
        };

        const [pkgRows, contractRows, regionRows] = await Promise.all([
          breakdown(packageCol, "pkg", mrrCol ? `, SUM(TRY_CAST(${mrrCol} AS DOUBLE))` : ", 0", 50),
          breakdown(contractCol, "status"),
          breakdown(regionCol, "region", "", 30),
        ]);

        // 6. NBA-trigger volume (full-base).
        const triggerRow = await safe<{ rows: unknown[][] }>(
          `WITH scored AS (
             SELECT ${idCol} AS cid, ${nbaTriggerExpr} AS trig FROM ${ci}
           )
           SELECT trig, COUNT(DISTINCT cid) FROM scored GROUP BY trig`,
          { rows: [] },
        );
        const triggerCounts: Record<string, number> = {};
        for (const r of triggerRow.rows ?? []) {
          triggerCounts[String(r[0] ?? "nurture")] = Number(r[1] ?? 0);
        }

        // 7. Signals histograms — bucketed counts that EnrichmentStatusPanel
        //    and the per-trigger panel can use without per-row data.
        const histogramFrom = async (
          colExpr: string | null,
          buckets: Array<{ label: string; cond: string }>,
        ): Promise<{ bucket: string; customers: number }[]> => {
          if (!colExpr) return [];
          const cases = buckets
            .map((b, i) => `WHEN ${b.cond.replace(/\$col/g, colExpr)} THEN ${i}`)
            .join(" ");
          const out = await safe<{ rows: unknown[][] }>(
            `SELECT bucket_idx, COUNT(DISTINCT ${idCol})
             FROM (SELECT ${idCol}, CASE ${cases} ELSE ${buckets.length} END AS bucket_idx FROM ${ci})
             GROUP BY bucket_idx ORDER BY bucket_idx`,
            { rows: [] },
          );
          const labels = [...buckets.map((b) => b.label), "Unknown"];
          const map = new Map<number, number>();
          for (const r of out.rows ?? []) map.set(Number(r[0] ?? 0), Number(r[1] ?? 0));
          return labels.map((label, i) => ({ bucket: label, customers: map.get(i) ?? 0 }));
        };

        const tenureHistogram = await histogramFrom(tenureExpr, [
          { label: "0-6 months", cond: "TRY_CAST($col AS DOUBLE) < 6" },
          { label: "6-12 months", cond: "TRY_CAST($col AS DOUBLE) < 12" },
          { label: "1-2 years", cond: "TRY_CAST($col AS DOUBLE) < 24" },
          { label: "2-3 years", cond: "TRY_CAST($col AS DOUBLE) < 36" },
          { label: "3-5 years", cond: "TRY_CAST($col AS DOUBLE) < 60" },
          { label: "5+ years", cond: "TRY_CAST($col AS DOUBLE) >= 60" },
        ]);

        const loyaltyHistogram = await histogramFrom(loyaltyCol, [
          { label: "0", cond: "TRY_CAST($col AS DOUBLE) = 0" },
          { label: "1", cond: "TRY_CAST($col AS DOUBLE) = 1" },
          { label: "2", cond: "TRY_CAST($col AS DOUBLE) = 2" },
          { label: "3+", cond: "TRY_CAST($col AS DOUBLE) >= 3" },
        ]);

        const holdHistogram = await histogramFrom(holdCol, [
          { label: "0 min", cond: "TRY_CAST($col AS DOUBLE) = 0" },
          { label: "<5 min", cond: "TRY_CAST($col AS DOUBLE) < 300" },
          { label: "5-15 min", cond: "TRY_CAST($col AS DOUBLE) < 900" },
          { label: "15-30 min", cond: "TRY_CAST($col AS DOUBLE) < 1800" },
          { label: "30+ min", cond: "TRY_CAST($col AS DOUBLE) >= 1800" },
        ]);

        const downloadHistogram = await histogramFrom(downloadCol, [
          { label: "0-50 GB", cond: "TRY_CAST($col AS DOUBLE) < 50" },
          { label: "50-200 GB", cond: "TRY_CAST($col AS DOUBLE) < 200" },
          { label: "200-500 GB", cond: "TRY_CAST($col AS DOUBLE) < 500" },
          { label: "500-1000 GB", cond: "TRY_CAST($col AS DOUBLE) < 1000" },
          { label: "1000+ GB", cond: "TRY_CAST($col AS DOUBLE) >= 1000" },
        ]);

        // Customers with at least one loyalty call (drives "calls extract overlap").
        const callsCoverageRow = await safe<{ rows: unknown[][] }>(
          loyaltyCol
            ? `SELECT
                 COUNT(DISTINCT CASE WHEN TRY_CAST(${loyaltyCol} AS DOUBLE) > 0 THEN ${idCol} END),
                 SUM(TRY_CAST(${loyaltyCol} AS DOUBLE)),
                 SUM(TRY_CAST(${holdCol ?? "0"} AS DOUBLE))
               FROM ${ci}`
            : `SELECT 0,0,0`,
          { rows: [[0, 0, 0]] },
        );
        const callsCov = (callsCoverageRow.rows ?? [[0, 0, 0]])[0] ?? [0, 0, 0];

        const usageCoverageRow = await safe<{ rows: unknown[][] }>(
          downloadCol
            ? `SELECT
                 COUNT(DISTINCT CASE WHEN TRY_CAST(${downloadCol} AS DOUBLE) > 0 THEN ${idCol} END),
                 AVG(TRY_CAST(${downloadCol} AS DOUBLE)),
                 ${uploadCol ? `AVG(TRY_CAST(${uploadCol} AS DOUBLE))` : "0"}
               FROM ${ci}`
            : `SELECT 0,0,0`,
          { rows: [[0, 0, 0]] },
        );
        const usageCov = (usageCoverageRow.rows ?? [[0, 0, 0]])[0] ?? [0, 0, 0];

        // Cease coverage — count of distinct customer_ids in cease table.
        const ceaseCoverageRow = await safe<{ rows: unknown[][] }>(
          `SELECT COUNT(DISTINCT ${idCol}) FROM ${ceaseTbl}`,
          { rows: [[0]] },
        );
        const ceaseCount = Number((ceaseCoverageRow.rows ?? [[0]])[0]?.[0] ?? 0);

        // 8. Top-N customers by derived risk score.
        const topNRow = await safe<{ rows: unknown[][] }>(
          `SELECT
              ${idCol},
              ${riskScoreExpr} AS score,
              ${riskTierExpr} AS tier,
              ${packageCol ?? "NULL"} AS pkg,
              ${regionCol ?? "NULL"} AS region,
              ${contractCol ?? "NULL"} AS contract,
              ${mrrCol ? `TRY_CAST(${mrrCol} AS DOUBLE)` : "NULL"} AS mrr,
              ${tenureExpr ? `TRY_CAST(${tenureExpr} AS DOUBLE)` : "NULL"} AS tenure,
              ${nbaTriggerExpr} AS nba_trigger
           FROM ${ci}
           ORDER BY score DESC
           LIMIT 50`,
          { rows: [] },
        );
        const topCustomers = (topNRow.rows ?? []).map((r, i) => ({
          rank: i + 1,
          customer_id: String(r[0] ?? ""),
          churn_prob: Number(r[1] ?? 0),
          tier: String(r[2] ?? ""),
          package: r[3] == null ? null : String(r[3]),
          region: r[4] == null ? null : String(r[4]),
          contract_status: r[5] == null ? null : String(r[5]),
          monthly_arpu: r[6] == null ? null : Number(r[6]),
          tenure_months: r[7] == null ? null : Number(r[7]),
          recommended_nba: r[8] == null ? null : String(r[8]),
        }));

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

        const payload = {
          totalCustomers,
          totalActive,
          totalCeased,
          totalRevenueMrr,
          averageMrr,
          averageTenureMonths,
          tierCounts,
          packageBreakdown,
          contractBreakdown,
          regionBreakdown,
          tenureHistogram,
          loyaltyHistogram,
          holdHistogram,
          downloadHistogram,
          triggerCounts,
          callsCoverage: {
            customersWithLoyaltyCalls: Number(callsCov[0] ?? 0),
            sumLoyaltyCalls: Number(callsCov[1] ?? 0),
            sumHoldSeconds: Number(callsCov[2] ?? 0),
          },
          usageCoverage: {
            customersWithUsage: Number(usageCov[0] ?? 0),
            avgDownloadGb: Number(usageCov[1] ?? 0),
            avgUploadGb: Number(usageCov[2] ?? 0),
          },
          ceaseCoverage: {
            customers: ceaseCount,
          },
          topCustomers,
          computedAt: new Date().toISOString(),
        };

        // 9. Persist to cache (admin context — bypasses RLS via service role).
        try {
          await (supabaseAdmin.from("md_aggregate_cache") as unknown as {
            upsert: (
              row: Record<string, unknown>,
              opts: { onConflict: string },
            ) => Promise<{ error: unknown }>;
          }).upsert(
            {
              cache_key: CACHE_KEY,
              payload,
              computed_at: payload.computedAt,
              source_signature: `${conn.id}:${cfg.database}:${cfg.schema ?? "main"}`,
            },
            { onConflict: "cache_key" },
          );
        } catch (e) {
          console.warn("[aggregate-motherduck] cache write failed", (e as Error)?.message);
        }

        return jsonOk({ ...payload, cached: false });
      },
    },
  },
});
