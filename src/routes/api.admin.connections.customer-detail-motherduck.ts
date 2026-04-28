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
 * Live single-customer lookup against the FULL MotherDuck base — no caching,
 * no sample. Powers the Explainability page customer search drilldown so the
 * user can pull any of the 3.5M customers on demand.
 *
 * Body: { customerId: string }
 *
 * Response: {
 *   customer_info: { headers, row } | null,
 *   calls: { headers, rows },
 *   cease: { headers, rows },
 *   usage: { headers, rows },
 * }
 */
export const Route = createFileRoute("/api/admin/connections/customer-detail-motherduck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let body: { customerId?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* no body */
        }
        const customerId = (body.customerId ?? "").trim();
        if (!customerId) return jsonError(400, "customerId is required");

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

        const out: Record<string, { headers: string[]; rows: unknown[][] }> = {};
        const errors: Record<string, string> = {};

        const kinds = ["customer_info", "calls", "cease", "usage"] as const;
        for (const kind of kinds) {
          const tbl = motherduckTableFor(fullCfg, kind);
          try {
            const res = await motherduckQuery(
              fullCfg,
              `SELECT * FROM ${tbl} WHERE unique_customer_identifier = $1`,
              [customerId],
            );
            out[kind] = { headers: res.headers, rows: res.rows };
          } catch (e) {
            errors[kind] = (e as Error)?.message ?? String(e);
          }
        }

        return jsonOk({
          customerId,
          kinds: out,
          errors: Object.keys(errors).length ? errors : undefined,
        });
      },
    },
  },
});
