// File parser supporting CSV (papaparse) and Parquet (hyparquet).
import Papa from "papaparse";
import { parquetReadObjects } from "hyparquet";
import type { RawCustomerRow } from "./customerMapping";

export type ParseResult = {
  rows: RawCustomerRow[];
  columns: string[];
};

export async function parseFile(file: File): Promise<ParseResult> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "parquet") return parseParquet(file);
  return parseCsv(file);
}

export function parseCsv(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        const rows = results.data as RawCustomerRow[];
        const columns = results.meta.fields ?? (rows[0] ? Object.keys(rows[0]) : []);
        resolve({ rows, columns });
      },
      error: (err) => reject(err),
    });
  });
}

export async function parseParquet(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const rows = (await parquetReadObjects({ file: buffer })) as RawCustomerRow[];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return { rows, columns };
}
