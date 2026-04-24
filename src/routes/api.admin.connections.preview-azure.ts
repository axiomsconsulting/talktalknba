import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  azureDownloadFile,
  parseCsv,
  parseParquet,
  type AzureRepoConfig,
} from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Preview a single file from the configured Azure DevOps repo without
 * archiving it or touching active_data_sources. Used by the admin UI to let
 * operators inspect column names + a row sample before clicking "Pull data
 * now".
 */
const Body = z.object({
  /** Optional dataset kind ("cease", "customer_info", ...) — when present we
   *  resolve the path from the saved file map. */
  kind: z.string().min(1).optional(),
  /** Or pass an explicit path relative to the repo root. */
  path: z.string().min(1).optional(),
  /** How many sample rows to return. */
  limit: z.number().int().min(1).max(50).optional(),
});

export const Route = createFileRoute("/api/admin/connections/preview-azure")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return jsonError(400, `Invalid body: ${(e as Error).message}`);
        }
        const limit = Math.min(parsed.limit ?? 10, 10);

        const { data: conn, error } = await supabaseAdmin
          .from("data_connections")
          .select("id, kind, config")
          .eq("kind", "azure_repo")
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!conn) return jsonError(404, "Azure connection not configured");

        const cfg = (conn.config ?? {}) as Partial<AzureRepoConfig>;
        if (!cfg.organization || !cfg.project || !cfg.repository) {
          return jsonError(400, "Azure repo config missing organization/project/repository");
        }

        let relPath = parsed.path;
        if (!relPath && parsed.kind) {
          relPath = cfg.files?.[parsed.kind];
        }
        if (!relPath) {
          return jsonError(400, "Provide either `kind` (mapped in file map) or `path`");
        }

        try {
          const lower = relPath.toLowerCase();
          const isCsv = lower.endsWith(".csv");
          const isParquet = lower.endsWith(".parquet");

          // For CSV we only need a small window — 256 KB easily covers 10
          // rows even with very wide columns. For parquet we still need the
          // whole file because the footer with metadata sits at the end and
          // the data pages are interleaved; we just cap the row decode.
          const bytes = isCsv
            ? await azureDownloadFile(cfg as AzureRepoConfig, "/" + relPath, { rangeBytes: 256 * 1024 })
            : await azureDownloadFile(cfg as AzureRepoConfig, "/" + relPath);

          if (isCsv) {
            const text = new TextDecoder().decode(bytes);
            // Strip last (likely partial) line so we don't return a half row
            const safeText = text.includes("\n")
              ? text.slice(0, text.lastIndexOf("\n"))
              : text;
            const out = parseCsv(safeText);
            const sample = out.rows.slice(0, limit);
            return jsonOk({
              ok: true,
              path: relPath,
              format: "csv",
              bytes: bytes.byteLength,
              total_rows: out.rows.length,
              column_count: out.headers.length,
              headers: out.headers,
              sample_rows: sample,
              note: `Showing first ${sample.length} rows from a ${(bytes.byteLength / 1024).toFixed(0)} KB sample of the file.`,
            });
          }
          if (isParquet) {
            // rowLimit=10 — decoder stops after 10 rows so even multi-GB
            // parquet files preview in a couple of seconds.
            const out = await parseParquet(bytes, limit);
            return jsonOk({
              ok: true,
              path: relPath,
              format: "parquet",
              bytes: bytes.byteLength,
              total_rows: out.totalRows,
              column_count: out.headers.length,
              headers: out.headers,
              sample_rows: out.rows.slice(0, limit),
              note: `Showing first ${Math.min(limit, out.rows.length)} of ${out.totalRows.toLocaleString()} rows.`,
            });
          }
          return jsonOk({
            ok: true,
            path: relPath,
            format: "raw",
            bytes: bytes.byteLength,
            note: "Unrecognised extension — preview not available",
          });
        } catch (e) {
          if (e instanceof Response) return e;
          return jsonError(500, (e as Error).message);
        }
      },
    },
  },
});
