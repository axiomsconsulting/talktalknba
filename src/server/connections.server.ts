// Server-only helpers for the live-data ingestion / model retraining endpoints.
// Imported only from .server.ts files or /api/ routes.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Verify a Bearer token belongs to an admin user. Returns the userId. */
export async function requireAdmin(request: Request): Promise<string> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw jsonError(500, "Server is missing Supabase env vars");
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw jsonError(401, "Missing bearer token");
  const token = auth.slice("Bearer ".length);

  const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw jsonError(401, "Invalid token");
  const userId = data.claims.sub;

  const { data: roleRow, error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleErr) throw jsonError(500, roleErr.message);
  if (!roleRow) throw jsonError(403, "Admin only");
  return userId;
}

/** Mark a connection as running and capture the result. */
export async function withConnectionRun<T>(
  kind: "databricks" | "gdrive" | "azure_repo",
  fn: () => Promise<T>,
): Promise<T> {
  const start = await supabaseAdmin
    .from("data_connections")
    .update({ last_status: "running", last_error: null, last_run_at: new Date().toISOString() })
    .eq("kind", kind)
    .select("id")
    .maybeSingle();
  try {
    const out = await fn();
    await supabaseAdmin
      .from("data_connections")
      .update({ last_status: "success", last_run_at: new Date().toISOString(), last_error: null })
      .eq("kind", kind);
    return out;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    await supabaseAdmin
      .from("data_connections")
      .update({ last_status: "error", last_error: msg, last_run_at: new Date().toISOString() })
      .eq("kind", kind);
    throw e;
  }
}

const DRIVE_GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const DBX_GATEWAY = "https://connector-gateway.lovable.dev/databricks";

export function gatewayHeaders(connectorEnv: "GOOGLE_DRIVE_API_KEY" | "DATABRICKS_API_KEY") {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env[connectorEnv];
  if (!lovableKey) throw jsonError(412, "LOVABLE_API_KEY missing — connect a Lovable connector");
  if (!connKey)
    throw jsonError(
      412,
      `${connectorEnv} missing — link the ${connectorEnv === "GOOGLE_DRIVE_API_KEY" ? "Google Drive" : "Databricks"} connector to this project`,
    );
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

export const GATEWAY_URLS = { drive: DRIVE_GATEWAY, databricks: DBX_GATEWAY };

/** Find a child folder by name under a parent folder. */
export async function driveFindChildFolder(
  parentId: string,
  name: string,
): Promise<string | null> {
  const headers = gatewayHeaders("GOOGLE_DRIVE_API_KEY");
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const res = await fetch(`${GATEWAY_URLS.drive}/files?q=${q}&fields=files(id,name)`, {
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw jsonError(res.status, `Drive folder lookup failed: ${text}`);
  }
  const json = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  return json.files?.[0]?.id ?? null;
}

/** List files inside a folder. */
export async function driveListFolder(folderId: string) {
  const headers = gatewayHeaders("GOOGLE_DRIVE_API_KEY");
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `${GATEWAY_URLS.drive}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,md5Checksum)&pageSize=200`,
    { headers },
  );
  if (!res.ok) {
    const text = await res.text();
    throw jsonError(res.status, `Drive list failed: ${text}`);
  }
  const json = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      md5Checksum?: string;
    }>;
  };
  return json.files ?? [];
}

/** Run a Databricks SQL query and wait briefly for the result. */
export async function databricksRunSql(warehouseId: string, sql: string) {
  const headers = gatewayHeaders("DATABRICKS_API_KEY");
  const res = await fetch(`${GATEWAY_URLS.databricks}/2.0/sql/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "30s" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw jsonError(res.status, `Databricks SQL failed: ${text}`);
  }
  return (await res.json()) as {
    statement_id?: string;
    status?: { state?: string; error?: { message?: string } };
    manifest?: { total_row_count?: number; total_byte_count?: number };
  };
}

/** Trigger a Databricks job run. */
export async function databricksTriggerJob(jobId: string, runName?: string) {
  const headers = gatewayHeaders("DATABRICKS_API_KEY");
  const res = await fetch(`${GATEWAY_URLS.databricks}/2.1/jobs/run-now`, {
    method: "POST",
    headers,
    body: JSON.stringify({ job_id: Number(jobId), run_name: runName ?? "Lovable retraining" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw jsonError(res.status, `Databricks job trigger failed: ${text}`);
  }
  return (await res.json()) as { run_id?: number; number_in_job?: number };
}
