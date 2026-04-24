import { createFileRoute } from "@tanstack/react-router";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  withConnectionRun,
  azureDownloadFile,
  parseCsv,
  type AzureRepoConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Downloads the CSV datasets from the configured Azure DevOps repo, parses
 * them in-process, and stores a derived snapshot in the `datasets` storage
 * bucket so the live-data store can light up immediately.
 *
 * Parquet files (customer_info, usage) are referenced but parsed by the
 * external Databricks job — the Worker runtime can't decode parquet without a
 * WASM library and these files are usually too large for in-process parsing.
 * The retraining endpoint feeds the parquet paths through to Databricks.
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
          const summary: Record<string, { rows?: number; bytes: number; skipped?: string }> = {};

          await withConnectionRun("azure_repo", async () => {
            for (const [datasetKind, relPath] of Object.entries(cfg.files!)) {
              const bytes = await azureDownloadFile(cfg as AzureRepoConfig, "/" + relPath);
              const isCsv = relPath.toLowerCase().endsWith(".csv");

              // Persist the raw file in the datasets bucket so it's archived &
              // can be re-parsed later without hitting Azure again.
              const archivePath = `azure/${conn.id}/${datasetKind}/${relPath.split("/").pop()}`;
              await supabaseAdmin.storage
                .from("datasets")
                .upload(archivePath, new Blob([bytes as BlobPart]), {
                  upsert: true,
                  contentType: isCsv ? "text/csv" : "application/octet-stream",
                });

              if (isCsv) {
                const text = new TextDecoder().decode(bytes);
                const parsed = parseCsv(text);
                summary[datasetKind] = { rows: parsed.rows.length, bytes: bytes.byteLength };

                // Persist a JSON snapshot so the live store can read it cheaply.
                const snapshot = JSON.stringify({
                  source: "azure_repo",
                  remote: relPath,
                  fetched_at: new Date().toISOString(),
                  headers: parsed.headers,
                  rows: parsed.rows.slice(0, 50_000),
                });
                await supabaseAdmin.storage
                  .from("datasets")
                  .upload(`azure/${conn.id}/${datasetKind}.json`, new Blob([snapshot], { type: "application/json" }), {
                    upsert: true,
                    contentType: "application/json",
                  });
              } else {
                // Parquet: archive only, surface to the trainer.
                summary[datasetKind] = {
                  bytes: bytes.byteLength,
                  skipped: "parquet — handed off to Databricks job",
                };
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
