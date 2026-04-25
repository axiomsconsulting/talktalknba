import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  withConnectionRun,
  databricksRunSql,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/admin/connections/ingest")({
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
        if (kind !== "databricks") {
          return jsonError(400, "kind must be 'databricks'");
        }

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config")
          .eq("kind", kind)
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Connection not configured");

        try {
          let filesSeen = 0;
          await withConnectionRun(kind, async () => {
            const cfg = (conn.config ?? {}) as {
              warehouse_id?: string;
              queries?: Array<{ kind: string; sql: string }>;
            };
            if (!cfg.warehouse_id) throw new Error("warehouse_id missing");
            for (const q of cfg.queries ?? []) {
              const out = await databricksRunSql(
                cfg.warehouse_id,
                `${q.sql} LIMIT 1` /* probe; full extracts are done by the Databricks job */,
              );
              filesSeen += 1;
              await supabaseAdmin.from("data_source_files").upsert(
                {
                  connection_id: conn.id,
                  kind: q.kind,
                  remote_id: `${cfg.warehouse_id}/${q.kind}`,
                  remote_name: q.kind,
                  remote_modified_at: new Date().toISOString(),
                  bytes: out.manifest?.total_byte_count ?? null,
                  last_seen_at: new Date().toISOString(),
                },
                { onConflict: "connection_id,kind,remote_id" },
              );
            }
          });

          return jsonOk({
            ok: true,
            files: filesSeen,
            message: `Probed ${filesSeen} table(s) in Databricks`,
          });
        } catch (e) {
          if (e instanceof Response) return e;
          return jsonError(500, (e as Error).message);
        }
      },
    },
  },
});
