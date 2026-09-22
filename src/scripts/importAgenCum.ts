/**
 * Impor data sheet 'Agen CUM' dari file Excel ke tabel `data_lengkap_utama`.
 *
 * Cara pakai:
 *   npm run db:import-agen -- "datleng kurlog.xlsx" "Agen CUM"
 *   npm run db:import-agen -- ./data.xlsx --dry-run
 *
 * Env yang dibutuhkan (di .env.local / .env / environment):
 *   SUPABASE_URL (atau NEXT_PUBLIC_SUPABASE_URL) dan SUPABASE_SERVICE_ROLE_KEY
 *
 * Strategi upsert: indeks unik PPID di DB bersifat parsial
 * (`WHERE ppid IS NOT NULL AND ppid <> ''`) sehingga `ON CONFLICT (ppid)`
 * ala `upsert(onConflict: 'ppid')` DITOLAK Postgres. Sebagai gantinya script
 * melakukan upsert manual per batch: SELECT ppid yang sudah ada, lalu
 * UPDATE baris lama + INSERT baris baru. Baris tanpa PPID selalu di-INSERT
 * (tidak bisa dicocokkan) dan dilaporkan di ringkasan.
 *
 * Pengaman tulis:
 * - Filter DINAMIS: sebelum tulis, kolom aktual remote dibaca
 *   (SELECT * LIMIT 1) dan payload dipangkas ke irisan whitelist
 *   migrasi ∩ skema live; kolom yang belum migrasi DILEWATI + warning.
 * - Error PER BARIS: batch gagal -> 1x retry (schema-cache) -> fallback
 *   tulis per baris; tiap gagal tercatat berlabel PPID di ringkasan.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  buildEffectiveFields,
  dedupeByPpid,
  fetchRemoteColumns,
  findHeaderRowIndex,
  mapAgenCumRowByIndex,
  resolveAllowedColumns,
  sanitizeRowForDb,
  DB_INSERTABLE_COLUMNS,
} from "@/core/parsers/agenCumMapper";
import type { InsertRow } from "@/core/parsers/agenCumMapper";

// Re-export agar impor lama (`./importAgenCum`) dan test tetap jalan;
// implementasi tunggal di @/core/parsers/agenCumMapper (browser-safe).
export {
  TEXT_FIELDS,
  BOOL_FIELDS,
  DB_INSERTABLE_COLUMNS,
  headerTokens,
  mapHeaderToField,
  parseBoolCell,
  cellToText,
  sanitizeRowForDb,
  fetchRemoteColumns,
  resolveAllowedColumns,
  dedupeByPpid,
  mapAgenCumRow,
  mapAgenCumRowByIndex,
  buildEffectiveFields,
  findHeaderRowIndex,
} from "@/core/parsers/agenCumMapper";
export type {
  DbField,
  EffectiveField,
  HeaderCtx,
  InsertRow,
  RemoteSchema,
} from "@/core/parsers/agenCumMapper";

// ---------------------------------------------------------------------------
// Penanganan error tulis (skema basi + fallback per baris)
// ---------------------------------------------------------------------------

export interface RowFailure {
  /** PPID baris (atau label cadangan bila tanpa PPID). */
  key: string;
  message: string;
}

export interface WriteStats {
  inserted: number;
  updated: number;
  failed: number;
  failures: RowFailure[];
}

/** Kunci identitas baris untuk laporan error. */
export function rowKey(row: InsertRow, fallback: string): string {
  return typeof row.ppid === "string" && row.ppid.trim() !== ""
    ? row.ppid
    : fallback;
}

/**
 * True bila error adalah basi schema-cache PostgREST (PGRST204 /
 * pesan "schema cache"): sinyal bahwa DDL baru dijalankan dan cache
 * belum refresh, atau payload memuat kolom yang tak ada di remote.
 */
export function isSchemaCacheError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  if (
    typeof e.code === "string" &&
    e.code.toUpperCase().includes("PGRST204")
  ) {
    return true;
  }
  const text = [e.message, e.details]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return /schema cache/i.test(text);
}

/** Jeda retry agar cache Supabase Cloud sempat refresh otomatis. */
export const SCHEMA_RELOAD_RETRY_DELAY_MS = 5000;
/** Batas detail baris gagal yang disimpan di laporan (penghitung tetap penuh). */
export const MAX_FAILURE_DETAILS = 50;

export function schemaReloadGuidance(): string {
  return [
    "Kemungkinan schema-cache PostgREST basi / kolom belum ada di remote.",
    "Supabase Cloud me-refresh cache otomatis setelah DDL: tunggu ±60 detik lalu ulangi.",
    "Self-hosted: jalankan NOTIFY pgrst, 'reload schema'; via koneksi postgres langsung.",
    "Bila kolom memang belum ada, terapkan supabase/migrations/20260923000000_align_data_lengkap_utama_v2.sql",
  ].join(" ");
}

function recordFailure(
  stats: WriteStats,
  key: string,
  message: string
): void {
  stats.failed += 1;
  if (stats.failures.length < MAX_FAILURE_DETAILS) {
    stats.failures.push({ key, message });
  }
}

const defaultSleeper = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * INSERT batch dengan fallback per baris: bila batch gagal, catat pola
 * schema-cache (beri panduan + 1x retry setelah jeda reload), lalu tulis
 * ulang baris-per-baris agar 1 baris busuk tak menggugurkan 499 lainnya.
 * Setiap kegagalan per baris masuk stats.failures berlabel PPID.
 */
export async function insertWithRowFallback(
  client: SupabaseClient,
  table: string,
  rows: InsertRow[],
  label: string,
  stats: WriteStats,
  opts: {
    retryDelayMs?: number;
    sleeper?: (ms: number) => Promise<void>;
  } = {}
): Promise<void> {
  if (rows.length === 0) return;
  const sleep = opts.sleeper ?? defaultSleeper;
  const delay = opts.retryDelayMs ?? SCHEMA_RELOAD_RETRY_DELAY_MS;

  const batch = await client.from(table).insert(rows);
  if (!batch.error) {
    stats.inserted += rows.length;
    return;
  }

  if (isSchemaCacheError(batch.error)) {
    console.error(`INSERT ${label} gagal (schema cache): ${batch.error.message}`);
    console.error(schemaReloadGuidance());
    console.error(`Menunggu ${delay} ms untuk reload cache lalu retry 1x...`);
    await sleep(delay);
    const retry = await client.from(table).insert(rows);
    if (!retry.error) {
      stats.inserted += rows.length;
      console.error(`Retry INSERT ${label} BERHASIL.`);
      return;
    }
    console.error(`Retry INSERT ${label} tetap gagal: ${retry.error.message}`);
  } else {
    console.error(`INSERT ${label} gagal (${rows.length} baris): ${batch.error.message}`);
  }

  console.error(`Fallback per baris untuk ${label}...`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as InsertRow;
    const single = await client.from(table).insert([row]);
    if (single.error) {
      recordFailure(stats, rowKey(row, `${label}#${i + 1}`), single.error.message);
    } else {
      stats.inserted += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Util CLI / env
// ---------------------------------------------------------------------------

/** Muat .env lalu .env.local (tanpa dependensi) ke process.env bila kosong. */
function loadEnvFiles(): void {
  for (const file of [".env", ".env.local"]) {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

interface CliOptions {
  file: string;
  sheet: string;
  dryRun: boolean;
  batchSize: number;
  /** Lewati baris tanpa PPID (impor ulang idempoten). */
  skipNoPpid: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let dryRun = false;
  let batchSize = 500;
  let skipNoPpid = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--skip-no-ppid") skipNoPpid = true;
    else if (arg.startsWith("--batch-size=")) {
      batchSize = Math.max(1, Number(arg.split("=")[1]) || 500);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }
  return {
    file: positional[0] ?? "datleng kurlog.xlsx",
    sheet: positional[1] ?? "Agen CUM",
    dryRun,
    batchSize,
    skipNoPpid,
  };
}

// ---------------------------------------------------------------------------
// Baca file/sheet (sumber tunggal untuk main + backfill)
// ---------------------------------------------------------------------------

export interface SheetMatrix {
  sheetName: string;
  matrix: unknown[][];
}

/**
 * Baca file Excel + pilih sheet "Agen CUM" (EKSak, tanpa fallback).
 * Dipakai main() dan skrip backfill agar parsing file tunggal sumbernya.
 * @throws Error bila file tak ditemukan / sheet absen.
 */
export function readSheetMatrix(file: string, sheet: string): SheetMatrix {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    const siblings = fs
      .readdirSync(process.cwd())
      .filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls"));
    throw new Error(
      `File tidak ditemukan: ${filePath}` +
        (siblings.length > 0
          ? ` File Excel di direktori ini: ${siblings.join(", ")}`
          : "")
    );
  }
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.includes(sheet) ? sheet : undefined;
  if (!sheetName) {
    throw new Error(`Sheet '${sheet}' tidak ditemukan dalam file Excel.`);
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(
    workbook.Sheets[sheetName] as never,
    { header: 1, defval: null, raw: true }
  ) as unknown[][];
  return { sheetName, matrix };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvFiles();
  const opts = parseArgs(process.argv.slice(2));
  let sheetName: string;
  let matrix: unknown[][];
  try {
    ({ sheetName, matrix } = readSheetMatrix(opts.file, opts.sheet));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }
  const headerIndex = findHeaderRowIndex(matrix);
  if (headerIndex === -1) {
    console.error(
      `Baris header tidak dikenali di sheet "${sheetName}" (dipindai 10 baris pertama).`
    );
    process.exitCode = 1;
    return;
  }

  const headers = (matrix[headerIndex] ?? []).map((h) =>
    h === null || h === undefined ? "" : String(h)
  );
  // Baris grup = tepat di atas baris header (kosong bila header di baris 1).
  const groupRow = headerIndex > 0 ? (matrix[headerIndex - 1] ?? []) : [];
  const rowsAbove =
    headerIndex > 1 ? [(matrix[headerIndex - 2] ?? [])] : [];
  const effective = buildEffectiveFields(headers, groupRow, rowsAbove);
  const mappedCount = effective.filter((e) => e.field !== null).length;

  const unmappedFills = new Map<string, number>();
  const rows: InsertRow[] = [];
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const cells = matrix[r] ?? [];
    const mapped = mapAgenCumRowByIndex(
      cells,
      effective.map((e) => e.field),
      effective.map((e) => e.label)
    );
    if (mapped) rows.push(mapped);
    // Lacak kolom tak terpetakan yang BERISI data (transparansi drop).
    effective.forEach((e, c) => {
      if (e.field !== null) return;
      const label = e.label === "" ? `(kolom ${c + 1} tanpa header)` : e.label;
      const v = cells[c];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        unmappedFills.set(label, (unmappedFills.get(label) ?? 0) + 1);
      }
    });
  }

  console.log(`Sheet      : ${sheetName} (header baris ${headerIndex + 1})`);
  console.log(
    `Kolom terpetakan: ${mappedCount} dari ${effective.length} (whitelist DB: ${DB_INSERTABLE_COLUMNS.size})`
  );
  console.log(`Baris valid: ${rows.length}`);
  if (unmappedFills.size > 0) {
    console.log(`Header tak terpetakan namun berisi data (DILEWATI):`);
    for (const [label, n] of [...unmappedFills.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  - "${label}": ${n} sel terisi`);
    }
  }

  const withPpid = rows.filter(
    (r) => typeof r.ppid === "string" && r.ppid.trim() !== ""
  );
  const withoutPpidAll = rows.filter(
    (r) => typeof r.ppid !== "string" || r.ppid.trim() === ""
  );
  console.log(`Dengan PPID: ${withPpid.length}, tanpa PPID: ${withoutPpidAll.length}`);

  if (opts.dryRun || rows.length === 0) {
    if (rows.length > 0) {
      console.log("Contoh baris pertama:");
      console.log(JSON.stringify(rows[0], null, 2));
    }
    console.log(opts.dryRun ? "Mode --dry-run: tidak ada data ditulis." : "Tidak ada data untuk diimpor.");
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Env belum lengkap: butuh SUPABASE_URL (atau NEXT_PUBLIC_SUPABASE_URL) dan SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exitCode = 1;
    return;
  }
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Filter DINAMIS dari skema live: hanya kolom yang benar-benar ada
  // di remote yang ditulis (drift -> warning, bukan PGRST204).
  const schema = await fetchRemoteColumns(supabase);
  if (schema.live) {
    console.log(
      `Skema live: ${schema.columns.size} kolom terdeteksi di remote.`
    );
  } else {
    console.log(`Skema: ${schema.note}; pakai whitelist statis.`);
  }
  const { allowed, missingInRemote } = resolveAllowedColumns(schema.columns);
  if (missingInRemote.length > 0) {
    console.log(
      `PERINGATAN: ${missingInRemote.length} kolom belum ada di remote dan DILEWATI saat tulis:`
    );
    console.log(`  ${missingInRemote.join(", ")}`);
    console.log(
      `  Terapkan supabase/migrations/20260923000000_align_data_lengkap_utama_v2.sql untuk melengkapinya.`
    );
  }

  const stats: WriteStats = { inserted: 0, updated: 0, failed: 0, failures: [] };

  const withoutPpid = opts.skipNoPpid ? [] : withoutPpidAll;
  if (opts.skipNoPpid && withoutPpidAll.length > 0) {
    console.log(
      `Lewati ${withoutPpidAll.length} baris tanpa PPID (--skip-no-ppid).`
    );
  }

  // Baris tanpa PPID: selalu INSERT (tidak bisa dicocokkan).
  for (let i = 0; i < withoutPpid.length; i += opts.batchSize) {
    const batch = withoutPpid
      .slice(i, i + opts.batchSize)
      .map((r) => sanitizeRowForDb(r, allowed));
    await insertWithRowFallback(
      supabase,
      "data_lengkap_utama",
      batch,
      `tanpa-PPID batch ${Math.floor(i / opts.batchSize) + 1}`,
      stats
    );
  }

  // Baris ber-PPID: upsert manual (SELECT -> UPDATE + INSERT).
  for (let i = 0; i < withPpid.length; i += opts.batchSize) {
    const rawBatch = withPpid.slice(i, i + opts.batchSize);
    // Dedup intra-batch dulu (last-wins) agar UNIQUE(ppid) tak menggagalkan batch.
    const { rows: batch, dupCount, dupKeys } = dedupeByPpid(rawBatch);
    if (dupCount > 0) {
      console.log(
        `Batch ${Math.floor(i / opts.batchSize) + 1}: ${dupCount} PPID ganda di file (last-wins): ${dupKeys.slice(0, 5).join(", ")}${dupKeys.length > 5 ? "…" : ""}`
      );
    }
    const ppids = batch.map((r) => r.ppid as string);
    const { data: existing, error: selectError } = await supabase
      .from("data_lengkap_utama")
      .select("ppid")
      .in("ppid", ppids);
    if (selectError) {
      console.error(`SELECT PPID gagal: ${selectError.message}`);
      if (isSchemaCacheError(selectError)) {
        console.error(schemaReloadGuidance());
      }
      for (const r of batch) {
        recordFailure(stats, rowKey(r, "ppid?"), `SELECT: ${selectError.message}`);
      }
      continue;
    }
    const existingSet = new Set((existing ?? []).map((r) => r.ppid as string));
    const toUpdate = batch
      .filter((r) => existingSet.has(r.ppid as string))
      .map((r) => sanitizeRowForDb(r, allowed));
    const toInsert = batch
      .filter((r) => !existingSet.has(r.ppid as string))
      .map((r) => sanitizeRowForDb(r, allowed));

    if (toInsert.length > 0) {
      await insertWithRowFallback(
        supabase,
        "data_lengkap_utama",
        toInsert,
        `PPID batch ${Math.floor(i / opts.batchSize) + 1}`,
        stats
      );
    }

    const CONCURRENCY = 25;
    for (let u = 0; u < toUpdate.length; u += CONCURRENCY) {
      const chunk = toUpdate.slice(u, u + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((r) =>
          supabase.from("data_lengkap_utama").update(r).eq("ppid", r.ppid as string)
        )
      );
      results.forEach((res, idx) => {
        if (res.error) {
          if (isSchemaCacheError(res.error)) {
            console.error(`UPDATE PPID ${chunk[idx]?.ppid} (schema cache): ${res.error.message}`);
            console.error(schemaReloadGuidance());
          }
          recordFailure(
            stats,
            rowKey(chunk[idx] as InsertRow, `update#${u + idx + 1}`),
            res.error.message
          );
        } else {
          stats.updated += 1;
        }
      });
    }

    console.log(
      `Batch ${Math.floor(i / opts.batchSize) + 1}: +${toInsert.length} baru / ~${toUpdate.length} update`
    );
  }

  console.log("Selesai.");
  console.log(`  INSERT: ${stats.inserted}`);
  console.log(`  UPDATE: ${stats.updated}`);
  console.log(`  GAGAL : ${stats.failed}`);
  if (stats.failures.length > 0) {
    console.log(`  Rincian ${stats.failures.length} kegagalan pertama:`);
    for (const f of stats.failures) {
      console.log(`    - ${f.key}: ${f.message}`);
    }
    if (stats.failed > stats.failures.length) {
      console.log(`    ... dan ${stats.failed - stats.failures.length} lainnya.`);
    }
  }
  if (withoutPpidAll.length > 0 && !opts.skipNoPpid) {
    console.log(
      `  Catatan: ${withoutPpidAll.length} baris tanpa PPID selalu di-INSERT (risiko duplikat saat impor ulang).`
    );
  }
  if (stats.failed > 0) process.exitCode = 1;
}

const isMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url).replace(/\.ts$/, ".ts");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
