import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  databricksRunSql,
  motherduckQuery,
  type MotherDuckConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/admin/connections/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        const body = (await request.json().catch(() => null)) as { kind?: string } | null;
        const kind = body?.kind;
        if (kind !== "databricks" && kind !== "motherduck") {
          return jsonError(400, "kind must be 'databricks' or 'motherduck'");
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config")
          .eq("kind", kind)
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Connection not configured yet");

        try {
          if (kind === "motherduck") {
            const cfg = (conn.config ?? {}) as Partial<MotherDuckConfig>;
            if (!cfg.database) return jsonError(400, "database missing — save MotherDuck config first");
            const out = await motherduckQuery(cfg as MotherDuckConfig, "SELECT 1 AS ok");
            await supabaseAdmin
              .from("data_connections")
              .update({ last_status: "success", last_error: null, last_run_at: new Date().toISOString() })
              .eq("id", conn.id);
            return jsonOk({ ok: true, rows: out.rows.length });
          }

          // Databricks
          const cfg = (conn.config ?? {}) as { warehouse_id?: string };
          if (!cfg.warehouse_id) return jsonError(400, "warehouse_id missing — save Databricks config first");
          const out = await databricksRunSql(cfg.warehouse_id, "SELECT 1 AS ok");
          await supabaseAdmin
            .from("data_connections")
            .update({ last_status: "success", last_error: null, last_run_at: new Date().toISOString() })
            .eq("id", conn.id);
          return jsonOk({ ok: true, state: out.status?.state ?? "ok" });
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          await supabaseAdmin
            .from("data_connections")
            .update({ last_status: "error", last_error: msg, last_run_at: new Date().toISOString() })
            .eq("id", conn.id);
          if (e instanceof Response) return e;
          return jsonError(500, msg);
        }
      },
    },
  },
});
