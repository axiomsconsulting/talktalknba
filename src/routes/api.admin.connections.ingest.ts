import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  withConnectionRun,
  driveListFolder,
  classifyDriveFileName,
  databricksRunSql,
  azureListRepoItems,
  azureDownloadFile,
  sha256Hex,
  type AzureRepoConfig,
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
        if (kind !== "databricks" && kind !== "gdrive" && kind !== "azure_repo") {
          return jsonError(400, "kind must be 'databricks', 'gdrive' or 'azure_repo'");
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
              // All files live in a single shared root folder — classify by name.
              const items = await driveListFolder(cfg.root_folder_id);
              for (const f of items) {
                if (f.mimeType === "application/vnd.google-apps.folder") continue;
                const datasetKind = classifyDriveFileName(f.name);
                if (!datasetKind) continue;
                filesSeen += 1;
                await supabaseAdmin
                  .from("data_source_files")
                  .upsert(
                    {
                      connection_id: conn.id,
                      kind: datasetKind,
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
            } else if (kind === "databricks") {
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
            } else {
              // azure_repo
              const cfg = (conn.config ?? {}) as Partial<AzureRepoConfig>;
              if (!cfg.organization || !cfg.project || !cfg.repository || !cfg.files) {
                throw new Error("Azure repo config requires organization, project, repository, files");
              }
              const items = await azureListRepoItems(cfg as AzureRepoConfig);
              const byPath = new Map(items.map((it) => [it.path.replace(/^\//, ""), it]));
              for (const [datasetKind, relPath] of Object.entries(cfg.files)) {
                const item = byPath.get(relPath);
                if (!item) continue;
                // Download to compute size + hash so future runs can detect changes.
                const bytes = await azureDownloadFile(cfg as AzureRepoConfig, "/" + relPath);
                const hash = await sha256Hex(bytes);
                filesSeen += 1;
                await supabaseAdmin.from("data_source_files").upsert(
                  {
                    connection_id: conn.id,
                    kind: datasetKind,
                    remote_id: item.objectId,
                    remote_name: relPath,
                    remote_modified_at: new Date().toISOString(),
                    remote_hash: hash,
                    bytes: bytes.byteLength,
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
            message:
              kind === "gdrive"
                ? `Discovered ${filesSeen} file(s) in Drive`
                : kind === "databricks"
                  ? `Probed ${filesSeen} table(s) in Databricks`
                  : `Indexed ${filesSeen} file(s) from Azure DevOps`,
          });
        } catch (e) {
          if (e instanceof Response) return e;
          return jsonError(500, (e as Error).message);
        }
      },
    },
  },
});

