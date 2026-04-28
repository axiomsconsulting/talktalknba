// One-shot loader that materialises the currently-active datasets (as recorded
// in active_data_sources) into the in-memory customer store.
//
// Background: customerStore.hydrate() only restores the *labels* of the active
// sources, not the actual rows. So after a hard refresh the Explainability page
// stays on the bundled mock personas even though the user has activated a real
// customer extract on the Data Library. This helper closes that gap by pulling
// the parsed rows back from the datasets bucket and pushing them through the
// same store actions that the Data Library uses.
//
// Idempotent — bails out fast if nothing needs doing.

import { supabase } from "@/integrations/supabase/client";
import {
  aggregateCalls,
  aggregateCease,
  aggregateUsage,
  DEFAULT_MAPPING,
  mapCustomers,
  type RawCustomerRow,
} from "@/data/customerMapping";
import { parseFile } from "@/data/parseFile";
import { allCustomers as defaultCustomers } from "@/data/customers";
import {
  useCustomerStore,
  type EnrichmentSource,
  type SourceOrigin,
} from "@/data/customerStore";

type ActiveRow = {
  kind: "customer_info" | "calls" | "cease" | "usage";
  origin: "upload" | "live";
  label: string;
  rows_count: number | null;
  dataset_id: string | null;
  connection_id: string | null;
  remote_name: string | null;
};

// Track in-flight / completed runs so two pages mounting at once don't race.
let inflight: Promise<void> | null = null;
let lastSignature: string | null = null;

function signatureFor(rows: ActiveRow[]): string {
  return rows
    .map((r) => `${r.kind}:${r.origin}:${r.dataset_id ?? r.remote_name ?? r.label}`)
    .sort()
    .join("|");
}

export async function hydrateLiveCustomers(opts: { force?: boolean } = {}): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Step 1 — if MotherDuck is the highest-priority enabled connector,
      // pull a live snapshot directly from it (no ingest required).
      const mdHydrated = await tryHydrateFromMotherDuck(opts.force ?? false);
      if (mdHydrated) {
        lastSignature = "motherduck:live";
        return;
      }

      // Step 2 — fall back to the existing snapshot/upload path driven by
      // active_data_sources (ingestions, manual uploads, etc.).
      const { data, error } = await supabase
        .from("active_data_sources")
        .select("kind, origin, label, rows_count, dataset_id, connection_id, remote_name");
      if (error) throw error;
      const rows = ((data ?? []) as ActiveRow[]).filter((r) =>
        ["customer_info", "calls", "cease", "usage"].includes(r.kind),
      );
      if (rows.length === 0) return;

      const sig = signatureFor(rows);
      const store = useCustomerStore.getState();
      const alreadyLoaded =
        store.source.kind === "uploaded" &&
        store.customers !== defaultCustomers &&
        store.customers.length > 0;
      if (!opts.force && alreadyLoaded && sig === lastSignature) return;

      // Process in deterministic order so customers appear before enrichment.
      const ordered = ["customer_info", "calls", "cease", "usage"] as const;
      for (const kind of ordered) {
        const row = rows.find((r) => r.kind === kind);
        if (!row) continue;
        try {
          const parsed = await loadRowsForActive(row);
          if (!parsed) continue;
          await applyToStore(row, parsed);
        } catch (e) {
          console.warn(`[liveCustomerHydrator] failed loading ${kind}`, e);
        }
      }
      lastSignature = sig;
    } catch (e) {
      console.warn("[liveCustomerHydrator] hydrate failed", e);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * If MotherDuck is enabled, fetch a capped live page for every dataset kind
 * and push it through the in-memory store as the active live source.
 *
 * Returns true when MD provided customer data.
 */
async function tryHydrateFromMotherDuck(force: boolean): Promise<boolean> {
  const { data: conn } = await supabase
    .from("data_connections")
    .select("id, enabled, name")
    .eq("kind", "motherduck")
    .maybeSingle();
  if (!conn?.enabled) return false;

  const store = useCustomerStore.getState();
  const alreadyLive =
    store.source.kind === "uploaded" &&
    (store.source as { detail?: string }).detail?.includes("MotherDuck");
  if (!force && alreadyLive) return true;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return false;

  // No row download. Every dashboard panel reads full-base aggregates from
  // /api/admin/connections/aggregate-motherduck (cached in md_aggregate_cache).
  // Per-customer drilldowns hit /api/admin/connections/customer-detail-
  // motherduck on demand. We just label the active source.
  const label = `MotherDuck · ${conn.name ?? "live"}`;
  const remoteName = `motherduck:${conn.id}`;
  const store = useCustomerStore.getState();
  store.setActive([], "MotherDuck (live)", "live", `Live integration · ${label}`);

  // Best-effort: persist MD as the active customer_info source so the label
  // survives refreshes.
  await store.persistActive({
    kind: "customer_info",
    origin: "live",
    label: `${label} · customer_info`,
    rows: 0,
    connectionId: conn.id,
    remoteName,
  }).catch(() => {});

  // Kick off the aggregate fetch (fire-and-forget — the hook on each page
  // will subscribe).
  void fetch("/api/admin/connections/aggregate-motherduck", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({}),
  }).catch(() => {});

  return true;
}

async function loadRowsForActive(row: ActiveRow): Promise<RawCustomerRow[] | null> {
  if (row.origin === "upload") {
    if (!row.dataset_id) return null;
    const { data: ds } = await supabase
      .from("customer_datasets")
      .select("filename, storage_path")
      .eq("id", row.dataset_id)
      .maybeSingle();
    if (!ds) return null;
    const { data: blob, error } = await supabase.storage
      .from("datasets")
      .download(ds.storage_path);
    if (error || !blob) throw error ?? new Error("Storage download failed");
    const file = new File([blob], ds.filename, { type: blob.type });
    const { rows } = await parseFile(file);
    return rows;
  }

  // origin === "live" — read the JSON snapshot the worker writes.
  // Snapshots live under one of: azure/{conn_id}/{kind}.json, gdrive/{conn_id}/{kind}.json,
  // motherduck/{conn_id}/{kind}.json — try each in turn so the same hydrator
  // covers every connector we ship.
  if (!row.connection_id) return null;
  const candidates = [
    `azure/${row.connection_id}/${row.kind}.json`,
    `motherduck/${row.connection_id}/${row.kind}.json`,
    `gdrive/${row.connection_id}/${row.kind}.json`,
  ];
  let blob: Blob | null = null;
  for (const path of candidates) {
    const { data } = await supabase.storage.from("datasets").download(path);
    if (data) {
      blob = data;
      break;
    }
  }
  if (!blob) return null;
  const text = await blob.text();
  const snap = JSON.parse(text) as {
    headers?: string[];
    rows?: unknown[][];
  };
  if (!snap.headers || !snap.rows) return null;
  // Reconstruct objects keyed by header name so the existing mappers/aggregators work.
  const out: RawCustomerRow[] = new Array(snap.rows.length);
  for (let i = 0; i < snap.rows.length; i++) {
    const obj: RawCustomerRow = {};
    const r = snap.rows[i];
    for (let j = 0; j < snap.headers.length; j++) {
      const v = r[j];
      obj[snap.headers[j]] = v as RawCustomerRow[string];
    }
    out[i] = obj;
  }
  return out;
}

async function applyToStore(row: ActiveRow, raw: RawCustomerRow[]): Promise<void> {
  const store = useCustomerStore.getState();
  const origin: SourceOrigin = row.origin;
  const detail =
    origin === "live"
      ? `Live integration · ${row.remote_name ?? row.label}`
      : `Stored upload · ${row.label}`;
  const enrichSrc: EnrichmentSource = {
    filename: row.label,
    rowsAggregated: raw.length,
    uploadedAt: new Date().toISOString(),
    origin,
    detail,
  };

  switch (row.kind) {
    case "customer_info": {
      const mapped = mapCustomers(raw, DEFAULT_MAPPING);
      if (mapped.length > 0) {
        store.setActive(mapped, row.label, origin, detail);
      }
      break;
    }
    case "calls":
      store.applyCalls(aggregateCalls(raw), enrichSrc);
      break;
    case "cease":
      store.applyCease(aggregateCease(raw), enrichSrc);
      break;
    case "usage":
      store.applyUsage(aggregateUsage(raw), enrichSrc);
      break;
  }
}
