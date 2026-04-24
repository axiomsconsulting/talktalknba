import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  withConnectionRun,
  azureDownloadFile,
  parseCsv,
  parseParquet,
  type AzureRepoConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Downloads the configured datasets from the Azure DevOps repo, parses them
 * in-process (CSV via parseCsv, Parquet via the hyparquet pure-JS decoder)
 * and writes a JSON snapshot to the `datasets` storage bucket so the live
 * store can light up immediately — without waiting for Databricks.
 */
export const Route = createFileRoute("/api/admin/connections/pull-azure")({
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
          .select("id, kind, config")
          .eq("kind", "azure_repo")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Azure connection not configured");

        const cfg = (conn.config ?? {}) as Partial<AzureRepoConfig>;
        if (!cfg.organization || !cfg.project || !cfg.repository || !cfg.files) {
          return jsonError(400, "Azure repo config missing organization/project/repository/files");
        }

        try {
          const summary: Record<
            string,
            { rows?: number; bytes: number; format: "csv" | "parquet" | "raw"; note?: string }
          > = {};

          await withConnectionRun("azure_repo", async () => {
            for (const [datasetKind, relPath] of Object.entries(cfg.files!)) {
              const bytes = await azureDownloadFile(cfg as AzureRepoConfig, "/" + relPath);
              const lower = relPath.toLowerCase();
              const isCsv = lower.endsWith(".csv");
              const isParquet = lower.endsWith(".parquet");

              const archivePath = `azure/${conn.id}/${datasetKind}/${relPath.split("/").pop()}`;
              await supabaseAdmin.storage
                .from("datasets")
                .upload(archivePath, new Blob([bytes as BlobPart]), {
                  upsert: true,
                  contentType: isCsv
                    ? "text/csv"
                    : isParquet
                      ? "application/vnd.apache.parquet"
                      : "application/octet-stream",
                });

              let parsedHeaders: string[] = [];
              let parsedRows: unknown[][] = [];
              let totalRows = 0;
              let format: "csv" | "parquet" | "raw" = "raw";

              if (isCsv) {
                const text = new TextDecoder().decode(bytes);
                const parsed = parseCsv(text);
                parsedHeaders = parsed.headers;
                parsedRows = parsed.rows;
                totalRows = parsed.rows.length;
                format = "csv";
              } else if (isParquet) {
                try {
                  const parsed = await parseParquet(bytes);
                  parsedHeaders = parsed.headers;
                  parsedRows = parsed.rows;
                  totalRows = parsed.totalRows;
                  format = "parquet";
                } catch (e) {
                  summary[datasetKind] = {
                    bytes: bytes.byteLength,
                    format: "parquet",
                    note: `Parquet decode failed: ${(e as Error).message}`,
                  };
                  continue;
                }
              } else {
                summary[datasetKind] = {
                  bytes: bytes.byteLength,
                  format: "raw",
                  note: "Unrecognised extension — archived only",
                };
                continue;
              }

              summary[datasetKind] = { rows: totalRows, bytes: bytes.byteLength, format };

              const snapshot = JSON.stringify({
                source: "azure_repo",
                remote: relPath,
                fetched_at: new Date().toISOString(),
                format,
                total_rows: totalRows,
                headers: parsedHeaders,
                rows: parsedRows.slice(0, 50_000),
              });
              await supabaseAdmin.storage
                .from("datasets")
                .upload(
                  `azure/${conn.id}/${datasetKind}.json`,
                  new Blob([snapshot], { type: "application/json" }),
                  { upsert: true, contentType: "application/json" },
                );

              if (["customer_info", "calls", "cease", "usage"].includes(datasetKind)) {
                await supabaseAdmin.from("active_data_sources").upsert(
                  {
                    kind: datasetKind,
                    origin: "live",
                    connection_id: conn.id,
                    remote_name: relPath,
                    label: relPath.split("/").pop() ?? relPath,
                    rows_count: totalRows,
                    activated_at: new Date().toISOString(),
                  },
                  { onConflict: "kind" },
                );
              }
            }
          });

          return jsonOk({
            ok: true,
            summary,
            message: `Pulled ${Object.keys(summary).length} dataset(s) from Azure DevOps`,
          });
        } catch (e) {
          if (e instanceof Response) return e;
          return jsonError(500, (e as Error).message);
        }
      },
    },
  },
});
