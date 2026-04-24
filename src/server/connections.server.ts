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

/* ------------------------------------------------------------------ */
/*  Azure DevOps Repos helpers                                         */
/*  Anonymous read against dev.azure.com REST API. No auth required    */
/*  when the project allows public access (the tt-insight-analytics    */
/*  /tech-test repo does).                                             */
/* ------------------------------------------------------------------ */

export type AzureRepoConfig = {
  organization: string;
  project: string;
  repository: string;
  branch?: string;
  anonymous?: boolean;
  /** Optional PAT — only used when anonymous=false. */
  pat?: string;
  /** Map of dataset kind ("cease", "calls", ...) -> repo path. */
  files: Record<string, string>;
};

function azureBase(cfg: AzureRepoConfig) {
  const { organization, project, repository } = cfg;
  return `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository)}`;
}

function azureHeaders(cfg: AzureRepoConfig): Record<string, string> {
  if (cfg.anonymous) return { Accept: "application/json" };
  if (cfg.pat) {
    const token = Buffer.from(`:${cfg.pat}`).toString("base64");
    return { Accept: "application/json", Authorization: `Basic ${token}` };
  }
  return { Accept: "application/json" };
}

/** List repository items (recursive, full tree). */
export async function azureListRepoItems(cfg: AzureRepoConfig) {
  const url = `${azureBase(cfg)}/items?recursionLevel=Full&api-version=7.1`;
  const res = await fetch(url, { headers: azureHeaders(cfg) });
  if (!res.ok) {
    const text = await res.text();
    throw jsonError(res.status, `Azure list items failed: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    value?: Array<{
      objectId: string;
      gitObjectType: string;
      commitId: string;
      path: string;
      isFolder?: boolean;
    }>;
  };
  return json.value ?? [];
}

/** Download a single file as raw bytes (Uint8Array). */
export async function azureDownloadFile(cfg: AzureRepoConfig, path: string) {
  const params = new URLSearchParams({
    path,
    "api-version": "7.1",
    "$format": "octetStream",
    download: "true",
  });
  if (cfg.branch) {
    params.set("versionDescriptor.versionType", "branch");
    params.set("versionDescriptor.version", cfg.branch);
  }
  const url = `${azureBase(cfg)}/items?${params.toString()}`;
  const res = await fetch(url, { headers: azureHeaders(cfg) });
  if (!res.ok) {
    const text = await res.text();
    throw jsonError(res.status, `Azure download failed (${path}): ${text.slice(0, 300)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

/** sha256 hex of a Uint8Array, using Web Crypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/*  Tiny CSV parser — handles quoted fields, embedded commas/newlines  */
/*  and CRLF.  No streaming; intended for the small cease.csv /        */
/*  calls.csv dropped into the repo (a few MB at most).                */
/* ------------------------------------------------------------------ */

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // finish row (skip the \n in \r\n)
      if (field.length || cur.length) {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      }
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    field += ch;
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  const headers = rows.shift() ?? [];
  return { headers, rows };
}

/* ------------------------------------------------------------------ */
/*  Parquet decoding via hyparquet (pure-JS, runs inside the Worker). */
/* ------------------------------------------------------------------ */

export type ParquetParsed = {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
};

/**
 * Decode a parquet file from a Uint8Array buffer.
 * `rowLimit` caps how many rows we materialise in JS (defaults to 50k —
 * enough for snapshots, prevents OOM on very large parquet files).
 */
export async function parseParquet(
  bytes: Uint8Array,
  rowLimit = 50_000,
): Promise<ParquetParsed> {
  const { parquetMetadataAsync, parquetReadObjects } = await import("hyparquet");
  const { compressors } = await import("hyparquet-compressors");

  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const file = {
    byteLength: ab.byteLength,
    async slice(start: number, end?: number) {
      return ab.slice(start, end ?? ab.byteLength);
    },
  };

  const metadata = await parquetMetadataAsync(file);
  const totalRows = Number(metadata.num_rows ?? 0);
  const headers = (metadata.schema ?? [])
    .filter((s) => s.name && (s as { num_children?: number }).num_children == null)
    .map((s) => s.name as string);

  const objects = (await parquetReadObjects({
    file,
    metadata,
    compressors,
    rowStart: 0,
    rowEnd: Math.min(totalRows, rowLimit),
  })) as Record<string, unknown>[];

  // Re-derive header order from the first row when schema scan missed leaves.
  const cols = headers.length
    ? headers
    : objects[0]
      ? Object.keys(objects[0])
      : [];
  const rows = objects.map((obj) =>
    cols.map((c) => {
      const v = obj[c];
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
  return { headers: cols, rows, totalRows };
}

