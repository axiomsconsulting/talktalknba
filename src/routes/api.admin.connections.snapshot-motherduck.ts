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
        // Cap raised from 20k → 100k. The previous 5k default collapsed to
        // ~945 unique customers after dedup because customer_info holds many
        // monthly rows per customer; a 50k uniform random sample retains
        // tens of thousands of distinct customers and keeps all dashboards
        // statistically representative of the full base. Headline KPIs are
        // computed on the full population via the aggregate-motherduck
        // endpoint regardless of this cap.
        const rowLimit = Math.max(
          100,
          Math.min(100_000, Math.floor(Number(body.rowLimit ?? 50_000)) || 50_000),
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

        // Pull customer_info first so we can scope the enrichment tables
        // (calls/cease/usage) to exactly those IDs — otherwise a random LIMIT
        // on usage would pick rows for customers we didn't load, wasting the
        // payload and producing zero enrichment overlap.
        let scopedIds: string[] | null = null;
        try {
          const tbl = motherduckTableFor(fullCfg, "customer_info");
          // USING SAMPLE gives a uniform random sample of the full table
          // instead of the alphabetically-first slice that ORDER BY produced.
          // After dedup-by-customer-id this preserves a representative cross-
          // section of the population.
          const sql = `SELECT * FROM ${tbl} USING SAMPLE ${rowLimit} ROWS`;
          const res = await motherduckQuery(fullCfg, sql);
          out.customer_info = { headers: res.headers, rows: res.rows };
          const idCol = res.headers.findIndex(
            (h) => h.toLowerCase() === "unique_customer_identifier",
          );
          if (idCol >= 0) {
            const seen = new Set<string>();
            for (const r of res.rows) {
              const v = r[idCol];
              if (v == null) continue;
              seen.add(String(v));
            }
            scopedIds = Array.from(seen);
          }
        } catch (e) {
          errors.customer_info = (e as Error)?.message ?? String(e);
        }

        // Enrichment tables — scoped to the loaded customer IDs when we have
        // them, otherwise a plain capped sample.
        for (const kind of kinds) {
          if (kind === "customer_info") continue;
          const tbl = motherduckTableFor(fullCfg, kind);
          let sql: string;
          let values: unknown[] | undefined;
          if (scopedIds && scopedIds.length > 0) {
            // Chunk the IN-list to keep parameter counts reasonable.
            const placeholders = scopedIds.map((_, i) => `$${i + 1}`).join(",");
            sql = `SELECT * FROM ${tbl} WHERE unique_customer_identifier IN (${placeholders})`;
            values = scopedIds;
          } else {
            sql = `SELECT * FROM ${tbl} USING SAMPLE ${rowLimit} ROWS`;
          }
          try {
            const res = await motherduckQuery(fullCfg, sql, values);
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
