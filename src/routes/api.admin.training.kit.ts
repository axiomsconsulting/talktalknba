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

        // Azure DevOps and Google Drive connectors have been removed; the
        // training kit endpoint now returns an empty link set. Live data is
        // sourced from MotherDuck or Databricks instead.
        const links: Record<string, { url: string; filename: string } | null> = {
          customer_info: null,
          calls: null,
          cease: null,
          usage: null,
        };

        return new Response(JSON.stringify({ links }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
