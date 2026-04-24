import { createFileRoute } from "@tanstack/react-router";
import { jsonError, requireAdmin } from "@/server/connections.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Returns signed download URLs for the latest archived raw files in the
 * `datasets` bucket, plus the two Python scripts the user runs in VS Code.
 * Admins-only.
 */
export const Route = createFileRoute("/api/admin/training/kit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (resp) {
          return resp instanceof Response ? resp : jsonError(500, String(resp));
        }

        const { data: conn } = await supabaseAdmin
          .from("data_connections")
          .select("id, config")
          .eq("kind", "azure_repo")
          .maybeSingle();

        const links: Record<string, { url: string; filename: string } | null> = {
          customer_info: null,
          calls: null,
          cease: null,
          usage: null,
        };

        if (conn) {
          const cfg = (conn.config ?? {}) as { files?: Record<string, string> };
          for (const kind of Object.keys(links)) {
            const remote = cfg.files?.[kind];
            if (!remote) continue;
            const filename = remote.split("/").pop() ?? remote;
            const archivePath = `azure/${conn.id}/${kind}/${filename}`;
            const { data: signed } = await supabaseAdmin.storage
              .from("datasets")
              .createSignedUrl(archivePath, 60 * 60); // 1 hour
            if (signed?.signedUrl) {
              links[kind] = { url: signed.signedUrl, filename };
            }
          }
        }

        return new Response(JSON.stringify({ links }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
