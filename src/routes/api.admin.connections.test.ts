import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  gatewayHeaders,
  GATEWAY_URLS,
  databricksRunSql,
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
        if (kind !== "databricks" && kind !== "gdrive") {
          return jsonError(400, "kind must be 'databricks' or 'gdrive'");
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config")
          .eq("kind", kind)
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Connection not configured yet");

        try {
          if (kind === "gdrive") {
            const headers = gatewayHeaders("GOOGLE_DRIVE_API_KEY");
            const cfg = (conn.config ?? {}) as { root_folder_id?: string };
            if (!cfg.root_folder_id) return jsonError(400, "root_folder_id missing — save Drive config first");
            const res = await fetch(
              `${GATEWAY_URLS.drive}/files/${cfg.root_folder_id}?fields=id,name,mimeType`,
              { headers },
            );
            if (!res.ok) return jsonError(res.status, await res.text());
            const data = (await res.json()) as { name?: string; mimeType?: string };
            await supabaseAdmin
              .from("data_connections")
              .update({ last_status: "success", last_error: null, last_run_at: new Date().toISOString() })
              .eq("id", conn.id);
            return jsonOk({ ok: true, folder: data.name, mime: data.mimeType });
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
