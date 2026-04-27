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
 * Live-query MotherDuck without writing to Storage.
 *
 * Used by the Data Library "Query live" mode — instead of pulling rows into
 * Supabase storage and the customer_datasets registry, we just stream the rows
 * back to the browser, which hydrates the in-memory customer store directly.
 *
 * Body: {
 *   kinds?: ("customer_info" | "calls" | "cease" | "usage")[],   // default: all four
 *   customerLimit?: number,                                       // default: 50, max: 500
 *   customerId?: string,                                          // single customer lookup
 * }
 *
 * Response: {
 *   results: { [kind]: { headers: string[]; rows: unknown[][]; count: number } }
 * }
 */
export const Route = createFileRoute("/api/admin/connections/query-motherduck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        type Kind = "customer_info" | "calls" | "cease" | "usage";
        const ALL_KINDS: Kind[] = ["customer_info", "calls", "cease", "usage"];

        let body: { kinds?: string[]; customerLimit?: number; customerId?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* no body */
        }
        const requested = (body.kinds ?? ALL_KINDS).filter((k): k is Kind =>
          ALL_KINDS.includes(k as Kind),
        );
        const kinds: Kind[] = requested.length > 0 ? requested : ALL_KINDS;
        const customerLimit = Math.max(
          1,
          Math.min(100_000, Math.floor(Number(body.customerLimit ?? 50_000)) || 50_000),
        );
        const customerId =
          typeof body.customerId === "string" && body.customerId.trim().length > 0
            ? body.customerId.trim()
            : null;

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
        const results: Record<
          string,
          { headers: string[]; rows: unknown[][]; count: number }
        > = {};

        try {
          // 1. Resolve the customer ID set first when sampling.
          let ids: string[] | null = null;
          if (customerId) {
            ids = [customerId];
          } else if (kinds.includes("customer_info")) {
            const tbl = motherduckTableFor(fullCfg, "customer_info");
            const sql = `SELECT * FROM ${tbl} ORDER BY random() LIMIT ${customerLimit}`;
            const out = await motherduckQuery(fullCfg, sql);
            results.customer_info = {
              headers: out.headers,
              rows: out.rows,
              count: out.totalRows,
            };
            // Find the unique_customer_identifier column to scope subsequent queries.
            const idCol = out.headers.findIndex(
              (h) => h.toLowerCase() === "unique_customer_identifier",
            );
            if (idCol >= 0) {
              ids = out.rows
                .map((r) => (r[idCol] == null ? null : String(r[idCol])))
                .filter((v): v is string => !!v);
            }
          }

          // 2. Pull the other tables, scoped to the resolved IDs when possible.
          for (const kind of kinds) {
            if (kind === "customer_info" && results.customer_info) continue;
            const tbl = motherduckTableFor(fullCfg, kind);
            let sql: string;
            const values: unknown[] = [];
            if (ids && ids.length > 0) {
              const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
              sql = `SELECT * FROM ${tbl} WHERE unique_customer_identifier IN (${placeholders})`;
              values.push(...ids);
            } else {
              sql = `SELECT * FROM ${tbl} LIMIT ${customerLimit * 50}`;
            }
            try {
              const out = await motherduckQuery(fullCfg, sql, values);
              results[kind] = {
                headers: out.headers,
                rows: out.rows,
                count: out.totalRows,
              };
            } catch (e) {
              // A missing table for one kind shouldn't block the others.
              results[kind] = {
                headers: [],
                rows: [],
                count: 0,
              };
              console.warn(`[query-motherduck] ${kind} failed`, (e as Error).message);
            }
          }

          // Mark the connection healthy after a successful round-trip.
          await supabaseAdmin
            .from("data_connections")
            .update({
              last_status: "success",
              last_error: null,
              last_run_at: new Date().toISOString(),
            })
            .eq("id", conn.id);

          return jsonOk({ results, customerLimit, customerId, ids: ids?.length ?? null });
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          await supabaseAdmin
            .from("data_connections")
            .update({
              last_status: "error",
              last_error: msg,
              last_run_at: new Date().toISOString(),
            })
            .eq("id", conn.id);
          return jsonError(500, msg);
        }
      },
    },
  },
});
