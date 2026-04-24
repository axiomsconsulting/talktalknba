// Cron-triggered Drive poller. Called by pg_cron without an Authorization
// header — the route runs the same ingest path the admin button uses, but
// with service-role privileges and only when the connection is enabled.
//
// Hosted at /api/public/hooks/poll-drive (the /api/public/* prefix bypasses
// route-level auth on published sites). To make sure random callers can't
// trigger ingestion, we require a shared secret query param: ?token=...
// The token is the same DATABRICKS_INGEST_TOKEN used by the artefact ingest.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  driveListFolder,
  classifyDriveFileName,
  withConnectionRun,
} from "@/server/connections.server";

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/poll-drive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.DATABRICKS_INGEST_TOKEN;
        if (!expected) return j(503, { error: "Cron not configured" });
        const url = new URL(request.url);
        const got = url.searchParams.get("token") ?? request.headers.get("x-cron-token");
        if (got !== expected) return j(401, { error: "Bad token" });

        const { data: conn } = await supabaseAdmin
          .from("data_connections")
          .select("id, config, enabled")
          .eq("kind", "gdrive")
          .maybeSingle();
        if (!conn || !conn.enabled) return j(200, { skipped: true });

        const cfg = (conn.config ?? {}) as { root_folder_id?: string };
        if (!cfg.root_folder_id) return j(200, { skipped: true, reason: "no root folder" });

        let seen = 0;
        try {
          await withConnectionRun("gdrive", async () => {
            for (const sub of SUBFOLDERS) {
              const folderId = await driveFindChildFolder(cfg.root_folder_id!, sub);
              if (!folderId) continue;
              const items = await driveListFolder(folderId);
              for (const f of items) {
                if (f.mimeType === "application/vnd.google-apps.folder") continue;
                seen += 1;
                await supabaseAdmin.from("data_source_files").upsert(
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
          });
        } catch (e) {
          return j(500, { error: (e as Error).message });
        }
        return j(200, { ok: true, files: seen });
      },
    },
  },
});
