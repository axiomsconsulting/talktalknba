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
  kind: "databricks" | "motherduck",
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
    let msg: string;
    if (e instanceof Response) {
      try {
        const body = await e.clone().text();
        msg = `HTTP ${e.status}: ${body.slice(0, 500)}`;
      } catch {
        msg = `HTTP ${e.status}`;
      }
    } else if (e instanceof Error) {
      msg = e.message;
    } else {
      try {
        msg = JSON.stringify(e);
      } catch {
        msg = String(e);
      }
    }
    await supabaseAdmin
      .from("data_connections")
      .update({ last_status: "error", last_error: msg, last_run_at: new Date().toISOString() })
      .eq("kind", kind);
    throw e;
  }
}

const DBX_GATEWAY = "https://connector-gateway.lovable.dev/databricks";

export function gatewayHeaders(connectorEnv: "DATABRICKS_API_KEY") {
  const lovableKey = process.env.LOVABLE_API_KEY;
  // Prefer suffixed env names (e.g. DATABRICKS_API_KEY_1) over the bare name —
  // a suffix means the platform has issued a fresh credential after a previous
  // workspace connection was disconnected, and the bare env var may now be stale.
  let connKey: string | undefined;
  for (let i = 5; i >= 1; i -= 1) {
    const v = process.env[`${connectorEnv}_${i}`];
    if (v) { connKey = v; break; }
  }
  if (!connKey) connKey = process.env[connectorEnv];
  if (!lovableKey) throw jsonError(412, "LOVABLE_API_KEY missing — connect a Lovable connector");
  if (!connKey)
    throw jsonError(412, `${connectorEnv} missing — link the Databricks connector to this project`);
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

export const GATEWAY_URLS = { databricks: DBX_GATEWAY };

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

/** Download a single file as raw bytes (Uint8Array). Optional Range header
 *  fetches only the first N bytes — used by previews to avoid pulling
 *  multi-MB parquet/CSV files end-to-end. Azure DevOps honours standard
 *  HTTP `Range` requests on repo items. */
export async function azureDownloadFile(
  cfg: AzureRepoConfig,
  path: string,
  opts?: { rangeBytes?: number },
) {
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
  const headers = { ...azureHeaders(cfg) } as Record<string, string>;
  if (opts?.rangeBytes && opts.rangeBytes > 0) {
    headers["Range"] = `bytes=0-${opts.rangeBytes - 1}`;
  }
  const res = await fetch(url, { headers });
  // 200 (full), 206 (partial) and 416 (range not satisfiable) are all OK; on
  // 416 we fall back to a plain GET so previews never break.
  if (res.status === 416 && opts?.rangeBytes) {
    return azureDownloadFile(cfg, path);
  }
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


/* ------------------------------------------------------------------ */
/*  MotherDuck — Postgres wire-protocol endpoint                       */
/*  pg.<region>.motherduck.com:5432, password = MotherDuck token.      */
/*  Cloudflare Workers run `pg` via the nodejs_compat shim.            */
/* ------------------------------------------------------------------ */

export type MotherDuckConfig = {
  /** Database name on MotherDuck (e.g. "file"). */
  database: string;
  /** Schema name. Defaults to "main". */
  schema?: string;
  /** Region host, e.g. "pg.us-east-1-aws.motherduck.com". */
  host?: string;
  /** Port, defaults to 5432. */
  port?: number;
  /** Map of dataset kind → fully-qualified table name (defaults are derived). */
  tables?: Partial<Record<"customer_info" | "calls" | "cease" | "usage", string>>;
};

const DEFAULT_MD_HOST = "pg.us-east-1-aws.motherduck.com";

function motherduckToken(): string {
  // Match Lovable's "_N suffix preferred" convention used elsewhere.
  for (let i = 5; i >= 1; i -= 1) {
    const v = process.env[`MOTHERDUCK_TOKEN_${i}`];
    if (v) return v;
  }
  const v = process.env.MOTHERDUCK_TOKEN;
  if (!v) throw jsonError(412, "MOTHERDUCK_TOKEN missing — add it under Settings → Secrets");
  return v;
}

/** Build a fresh, single-use pg client. Caller MUST call `await client.end()`. */
export async function motherduckClient(cfg: MotherDuckConfig) {
  const { Client } = await import("pg");
  const token = motherduckToken();
  const client = new Client({
    host: cfg.host || DEFAULT_MD_HOST,
    port: cfg.port ?? 5432,
    user: "postgres",
    password: token,
    database: cfg.database,
    ssl: { rejectUnauthorized: false },
    // Workers have no DNS retry — fail fast and let the caller surface the error.
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  return client;
}

/** Resolve the table name for a kind. Honours overrides in cfg.tables. */
export function motherduckTableFor(
  cfg: MotherDuckConfig,
  kind: "customer_info" | "calls" | "cease" | "usage",
): string {
  const override = cfg.tables?.[kind];
  if (override && override.trim()) return override.trim();
  const schema = (cfg.schema || "main").trim();
  return `"${schema}"."${kind}"`;
}

/** Run a SQL query and return rows + headers (column names from the result). */
export async function motherduckQuery(
  cfg: MotherDuckConfig,
  sql: string,
  values?: unknown[],
): Promise<{ headers: string[]; rows: unknown[][]; totalRows: number }> {
  const client = await motherduckClient(cfg);
  try {
    const res = await client.query({ text: sql, values, rowMode: "array" });
    const headers = res.fields.map((f) => f.name);
    const rows = (res.rows as unknown[][]) ?? [];
    return { headers, rows, totalRows: rows.length };
  } finally {
    await client.end().catch(() => {});
  }
}
