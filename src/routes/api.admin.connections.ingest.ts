import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  withConnectionRun,
  driveFindChildFolder,
  driveListFolder,
  databricksRunSql,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SUBFOLDERS = ["customer_info", "calls", "cease", "usage", "model_artefacts"] as const;

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
        if (kind !== "databricks" && kind !== "gdrive") {
          return jsonError(400, "kind must be 'databricks' or 'gdrive'");
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
            if (kind === "gdrive") {
              const cfg = (conn.config ?? {}) as { root_folder_id?: string };
              if (!cfg.root_folder_id) throw new Error("root_folder_id missing");
              for (const sub of SUBFOLDERS) {
                const folderId = await driveFindChildFolder(cfg.root_folder_id, sub);
                if (!folderId) continue;
                const items = await driveListFolder(folderId);
                for (const f of items) {
                  if (f.mimeType === "application/vnd.google-apps.folder") continue;
                  filesSeen += 1;
                  await supabaseAdmin
                    .from("data_source_files")
                    .upsert(
                      {
                        connection_id: conn.id,
                        kind: sub,
                        remote_id: f.id,
                        remote_name: f.name,
                        remote_modified_at: f.modifiedTime ?? null,
                        remote_hash: f.md5Checksum ?? null,
                        bytes: f.size ? Number(f.size) : null,
                        last_seen_at: new Date().toISOString(),
                      },
                      { onConflict: "connection_id,kind,remote_id" },
                    );
                }
              }
            } else {
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
            }
          });

          return jsonOk({
            ok: true,
            files: filesSeen,
            message: `Discovered ${filesSeen} ${kind === "gdrive" ? "file(s)" : "table(s)"}`,
          });
        } catch (e) {
          if (e instanceof Response) return e;
          return jsonError(500, (e as Error).message);
        }
      },
    },
  },
});
