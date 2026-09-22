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

// ---------------------------------------------------------------------------
// Daftar kolom DB yang bisa diisi (tanpa id / created_at)
// ---------------------------------------------------------------------------

const TEXT_FIELDS = [
  "status_syarat",
  "pengajuan_survey",
  "pengajuan_pos",
  "pendaftaran_kurlog",
  "kelengkapan_perangkat",
  "aktivasi_kurlog",
  "aktivasi_sicepat",
  "training",
  "transaksi",
  "catatan",
  "ppid",
  "nama_loket_onpays",
  "nama_loket_kurlog",
  "nama_pemilik",
  "alamat_pemilik_ktp",
  "alamat_lengkap_loket",
  "rt_rw",
  "kel_desa",
  "kec",
  "kab_kot",
  "propinsi",
  "kode_pos",
  "no_ktp",
  "no_npwp",
  "electric_area",
  "rekomendasi",
  "no_hp_pemilik",
  "no_hp_loket",
  "email",
  "no_dirian",
  "location_id",
  "user_mile",
  "password_mile",
  "regional",
  "kcu_kc",
  "nib",
  "no_kbli",
  "nomor_rekening",
  "nama_bank",
  "nama_pemilik_rekening",
  "latitude",
  "longitude",
  "kelengkapan_admin_formulir",
  "form_ajuan_pos",
  "pks",
  "doc_ktp",
  "doc_npwp",
  "doc_nib",
  "doc_kbli",
  "foto_tampak_depan_loket",
  "perangkat_komputer_laptop",
  "perangkat_hp_android",
  "perangkat_printer_sticker",
  "perangkat_timbangan_digital",
  "perangkat_kertas_sticker",
  "perangkat_atk_dari_pos",
  "pola_dana",
  "pengganti_nama",
  "pengganti_alamat",
  "pengganti_no_ktp",
  "pengganti_tgl_lahir",
  "pengganti_npwp",
  "pengganti_telp",
  "pengganti_email",
  "pengganti_status",
  "pengganti_catatan",
  "jenis_usaha_kategori",
  "courier_pos",
  "courier_spx",
  "courier_lion_parcel",
  "courier_wahana",
  "courier_jnt_cargo",
  "courier_jnt_express",
  "courier_sicepat",
  "courier_jne",
  "courier_tiki",
  "courier_sap",
  "courier_id_express",
  "courier_anteraja",
  "courier_lex_id",
] as const;

const BOOL_FIELDS = [
  "kurlog_pos_ppob",
  "kurlog_pos_only",
  "kurlog_sicepat",
] as const;

type DbField = (typeof TEXT_FIELDS)[number] | (typeof BOOL_FIELDS)[number];
type InsertRow = Partial<Record<DbField | "no", string | number | boolean>>;

// ---------------------------------------------------------------------------
// Normalisasi & pemetaan header
// ---------------------------------------------------------------------------

/** "No. HP Pemilik" -> ["no","hp","pemilik"] */
export function headerTokens(value: unknown): string[] {
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (typeof value !== "string") return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Kata pengisi yang boleh diabaikan saat pencocokan token. */
const STOPWORDS = new Set([
  "no",
  "nomor",
  "nomer",
  "nama",
  "data",
  "info",
  "keterangan",
  "di",
]);

/** Alias eksplisit: gabungan token header -> kolom DB. */
const HEADER_ALIASES: Record<string, DbField> = {
  provinsi: "propinsi",
  kabupatenkota: "kab_kot",
  kabkota: "kab_kot",
  kabupaten: "kab_kot",
  kota: "kab_kot",
  kecamatan: "kec",
  kelurahan: "kel_desa",
  desa: "kel_desa",
  kodepos: "kode_pos",
  lat: "latitude",
  lon: "longitude",
  long: "longitude",
  lng: "longitude",
  kcu: "kcu_kc",
  kbli: "no_kbli",
  telepon: "pengganti_telp",
  telp: "pengganti_telp",
  // Varian header asli sheet Agen CUM (typo, imbuhan, keterangan kurung)
  alamatpemiilikktp: "alamat_pemilik_ktp",
  pengajuansurveykepos: "pengajuan_survey",
  tanggallahir: "pengganti_tgl_lahir",
  nibnoindukberusaha: "nib",
  jenisusahaagen: "jenis_usaha_kategori",
  // Kolom ATK berada di rentang merge grup pengganti -> alias eksplisit
  atkdaripos: "perangkat_atk_dari_pos",
};

const FIELD_TOKEN_MAP: Map<string, DbField> = new Map();
for (const field of [...TEXT_FIELDS, ...BOOL_FIELDS]) {
  FIELD_TOKEN_MAP.set(field.split("_").join(" "), field);
}

/** Konteks kolom untuk disambiguasi (grup merged header, posisi, tetangga). */
export interface HeaderCtx {
  /** Indeks kolom (aturan posisi blok dokumen/kurir). */
  index?: number;
  /** Label grup dari baris header grup ("" bila tidak ada). */
  group?: string;
  /** Label header tetangga (untuk "Nama Pemilik" vs pemilik rekening). */
  neighbors?: string[];
}

/** Header satu-token pada blok dokumen (grup kosong/PKS) -> kolom doc_*. */
const DOC_SINGLE_TOKENS: Record<string, DbField> = {
  ktp: "doc_ktp",
  npwp: "doc_npwp",
  nib: "doc_nib",
  kbli: "doc_kbli",
};

/** Nama kurir (tanpa imbuhan) -> kolom courier_*. */
const COURIER_BY_NAME: Record<string, DbField> = {
  pos: "courier_pos",
  spx: "courier_spx",
  lionparcel: "courier_lion_parcel",
  wahana: "courier_wahana",
  jntcargo: "courier_jnt_cargo",
  jntexpress: "courier_jnt_express",
  sicepat: "courier_sicepat",
  jne: "courier_jne",
  tiki: "courier_tiki",
  sap: "courier_sap",
  idexpress: "courier_id_express",
  anteraja: "courier_anteraja",
  lexid: "courier_lex_id",
};

/** Tetangga penanda kolom pemilik rekening (vs nama pemilik loket). */
const REK_NEIGHBORS = new Set(["nomorrekening", "namabank"]);

function groupTokens(group: string | undefined): string[] {
  return headerTokens(group ?? "");
}

/** Pencocokan ketat: persis -> "no" -> alias -> subset dua arah. */
function strictMatch(tokens: string[]): DbField | "no" | null {
  if (tokens.length === 0) return null;
  const joined = tokens.join(" ");

  const exact = FIELD_TOKEN_MAP.get(joined);
  if (exact) return exact;
  if (joined === "no") return "no";

  const alias = HEADER_ALIASES[tokens.join("")];
  if (alias) return alias;

  const content = tokens.filter((t) => !STOPWORDS.has(t));
  if (content.length === 0) return null;

  const candidates: DbField[] = [];
  for (const [fieldJoined, field] of FIELD_TOKEN_MAP) {
    const fieldTokens = fieldJoined.split(" ");
    const fieldCovered = fieldTokens.every((t) => tokens.includes(t));
    const headerCovered = content.every((t) => fieldTokens.includes(t));
    if (fieldCovered && headerCovered) candidates.push(field);
  }
  if (candidates.length === 0) return null;
  // Paling spesifik (token terbanyak) menang; stabil untuk determinisme.
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

/**
 * Pencocokan longgar: semua token field harus hadir di header.
 * Kandidat dibatasi >= 2 token agar "nib" tidak menelan grup tak dikenal.
 * Paling spesifik (token terbanyak, lalu nama terpanjang) menang —
 * mis. "NO KTP" di grup pengganti -> pengganti_no_ktp (3 token),
 * bukan no_ktp (2 token).
 */
function relaxedMatch(tokens: string[]): DbField | null {
  if (tokens.length === 0) return null;
  let best: DbField | null = null;
  let bestTokens = 1;
  let bestLen = -1;
  for (const [fieldJoined, field] of FIELD_TOKEN_MAP) {
    const fieldTokens = fieldJoined.split(" ");
    if (fieldTokens.length < 2) continue;
    if (!fieldTokens.every((t) => tokens.includes(t))) continue;
    if (
      fieldTokens.length > bestTokens ||
      (fieldTokens.length === bestTokens && field.length > bestLen)
    ) {
      best = field;
      bestTokens = fieldTokens.length;
      bestLen = field.length;
    }
  }
  return best;
}

/**
 * Petakan satu sel header Excel ke kolom DB.
 * Urutan: konteks grup pengganti -> token tunggal dokumen -> nama kurir ->
 * pemilik rekening -> sub-header ketat -> gabungan "grup + sub" ->
 * grup saja. Kembalikan null bila tidak dikenali.
 */
export function mapHeaderToField(
  header: unknown,
  ctx: HeaderCtx = {}
): DbField | "no" | null {
  const tokens = headerTokens(header);
  if (tokens.length === 0) return null;
  const group = groupTokens(ctx.group);
  const groupJoined = group.join("");

  // 1. Konteks grup PENGGANTI: relaksasi pada gabungan grup+sub.
  if (group.includes("pengganti")) {
    const hit = relaxedMatch([...group, ...tokens]);
    if (hit) return hit;
  }

  // 2. Token tunggal dokumen (KTP/NPWP/NIB/KBLI) di blok dokumen.
  if (tokens.length === 1) {
    const doc = DOC_SINGLE_TOKENS[tokens[0] as string];
    if (doc && (groupJoined === "" || groupJoined === "pks")) return doc;
  }

  // 3. Nama kurir — kecuali di grup KURLOG (mis. "SICEPAT" aktivasi).
  const courier = COURIER_BY_NAME[tokens.join("")];
  if (courier) {
    const g = group.join(" ");
    if (
      !g.includes("kurlog") &&
      (g.includes("jenis usaha") || g === "" || (ctx.index ?? 0) >= 75)
    ) {
      return courier;
    }
  }

  // 4. "Nama Pemilik" di samping kolom rekening -> pemilik rekening.
  if (tokens.join("") === "namapemilik") {
    const neighborHits = (ctx.neighbors ?? []).map((n) =>
      headerTokens(n).join("")
    );
    if (neighborHits.some((n) => REK_NEIGHBORS.has(n))) {
      return "nama_pemilik_rekening";
    }
  }

  // 5. Sub-header apa adanya.
  const direct = strictMatch(tokens);
  if (direct) return direct;

  // 6. Gabungan "grup + sub" (ketat lalu longgar).
  // (Sengaja TANPA fallback "grup saja": sub yang tak cocok tak boleh
  // mewarisi field grup — label vertikal sudah ditangani eksplisit di
  // buildEffectiveFields.)
  if (group.length > 0) {
    const combined = [...group, ...tokens];
    const cStrict = strictMatch(combined);
    if (cStrict) return cStrict;
    const cRelaxed = relaxedMatch(combined);
    if (cRelaxed) return cRelaxed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pembersih nilai
// ---------------------------------------------------------------------------

const TRUE_TOKENS = new Set([
  "y",
  "ya",
  "yes",
  "true",
  "1",
  "v",
  "ada",
  "aktif",
  "ok",
  "sudah",
  "lengkap",
  "terpasang",
  "x",
]);
const FALSE_TOKENS = new Set([
  "n",
  "no",
  "tidak",
  "tidakada",
  "tdk",
  "false",
  "0",
  "-",
  "kosong",
  "belum",
  "belumada",
  "nonaktif",
]);

/** "Ya"/"V"/1 -> true, "Tidak"/"-"/kosong -> false, tak dikenal -> null. */
export function parseBoolCell(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;
  if (value.trim() === "-") return false;
  const norm = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (norm === "" || norm === "null" || norm === "na") return null;
  if (TRUE_TOKENS.has(norm)) return true;
  if (FALSE_TOKENS.has(norm)) return false;
  return null;
}

/** Sel Excel -> string rapi; kosong -> null (kolom diabaikan). */
export function cellToText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  const text = String(value).trim();
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// Whitelist kolom + pemetaan dua tingkat (grup + sub header)
// ---------------------------------------------------------------------------

/**
 * Daftar kolom yang benar-benar ada di tabel `data_lengkap_utama`
 * (migrasi supabase/migrations/20260921000000_init_schema.sql,
 * tanpa id / created_at). Satu-satunya sumber kebenaran untuk payload.
 */
export const DB_INSERTABLE_COLUMNS: ReadonlySet<string> = new Set([
  ...TEXT_FIELDS,
  ...BOOL_FIELDS,
  "no",
]);

/**
 * Jaminan invariant: objek yang di-upsert HANYA memuat kolom yang ada di
 * database. `allowed` default = whitelist statis migrasi; saat impor,
 * main() mengisinya dari hasil discovery skema live (irisan statis ∩
 * remote) sehingga drift skema (kolom belum migrasi) terbuang di sini
 * alih-alih meledak sebagai PGRST204 di PostgREST.
 */
export function sanitizeRowForDb(
  row: InsertRow,
  allowed: ReadonlySet<string> = DB_INSERTABLE_COLUMNS
): InsertRow {
  const clean: InsertRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (allowed.has(key)) {
      (clean as Record<string, string | number | boolean>)[key] = value as
        | string
        | number
        | boolean;
    }
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Discovery skema live + penanganan error tulis
// ---------------------------------------------------------------------------

export interface RemoteSchema {
  /** Kolom aktual tabel remote (dari satu baris SELECT *). */
  columns: Set<string>;
  /** true bila benar-benar dibaca dari remote (false = fallback statis). */
  live: boolean;
  /** Alasan fallback ("" bila live). */
  note: string;
}

/**
 * Baca kolom aktual tabel remote via SELECT * LIMIT 1 (PostgREST
 * mengembalikan SEMUA kolom termasuk yang null). Read-only dan aman.
 * Fallback ke whitelist statis bila tabel kosong / error jaringan.
 */
export async function fetchRemoteColumns(
  client: SupabaseClient,
  table = "data_lengkap_utama"
): Promise<RemoteSchema> {
  const fallback = (note: string): RemoteSchema => ({
    columns: new Set(DB_INSERTABLE_COLUMNS),
    live: false,
    note,
  });
  try {
    const { data, error } = await client.from(table).select("*").limit(1);
    if (error) return fallback(`baca skema gagal (${error.message})`);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0 || !rows[0]) {
      return fallback("tabel remote kosong; kolom tak terdeteksi");
    }
    return { columns: new Set(Object.keys(rows[0])), live: true, note: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fallback(`baca skema gagal (${msg})`);
  }
}

/**
 * Irisan whitelist statis ∩ skema live = kolom yang aman ditulis.
 * `missingInRemote` = kolom migrasi yang BELUM ada di remote
 * (terapkan supabase/migrations/20260923000000_align_data_lengkap_utama_v2.sql).
 */
export function resolveAllowedColumns(remote: ReadonlySet<string>): {
  allowed: Set<string>;
  missingInRemote: string[];
} {
  const allowed = new Set<string>();
  const missing: string[] = [];
  for (const col of DB_INSERTABLE_COLUMNS) {
    if (remote.has(col)) allowed.add(col);
    else missing.push(col);
  }
  missing.sort();
  return { allowed, missingInRemote: missing };
}

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
 * Hilangkan duplikat PPID DALAM satu batch (last-wins, selaras semantik
 * upsert) agar 1 PPID ganda di file tak menggugurkan batch 500 baris
 * (remote memakai UNIQUE(ppid) penuh: data_lengkap_utama_ppid_key).
 * Baris tanpa PPID tidak didedup (tak ada kunci).
 */
export function dedupeByPpid(rows: InsertRow[]): {
  rows: InsertRow[];
  dupCount: number;
  dupKeys: string[];
} {
  const seen = new Map<string, InsertRow>();
  const loose: InsertRow[] = [];
  const dupKeys: string[] = [];
  for (const row of rows) {
    const ppid =
      typeof row.ppid === "string" && row.ppid.trim() !== "" ? row.ppid : null;
    if (ppid === null) {
      loose.push(row);
      continue;
    }
    if (seen.has(ppid) && !dupKeys.includes(ppid)) dupKeys.push(ppid);
    seen.set(ppid, row);
  }
  return { rows: [...seen.values(), ...loose], dupCount: dupKeys.length, dupKeys };
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

/** Isi satu field dari satu sel; true bila nilai valid tersimpan. */
function assignField(
  row: InsertRow,
  field: DbField | "no",
  value: unknown
): boolean {
  if (field === "no") {
    const num =
      typeof value === "number" ? value : Number(String(value).trim());
    if (Number.isFinite(num) && String(value).trim() !== "") {
      row.no = num;
      return true;
    }
    return false;
  }
  if ((BOOL_FIELDS as readonly string[]).includes(field)) {
    const parsed = parseBoolCell(value);
    if (parsed !== null) {
      (row as Record<string, boolean>)[field] = parsed;
      return true;
    }
    return false;
  }
  const text = cellToText(value);
  if (text !== null) {
    (row as Record<string, string>)[field] = text;
    return true;
  }
  return false;
}

/**
 * Petakan satu baris sheet (header asli -> nilai) menjadi baris DB.
 * Kembalikan null bila baris kosong / tanpa identitas (tanpa PPID sekaligus
 * tanpa nama loket & nama pemilik).
 */
export function mapAgenCumRow(
  raw: Record<string, unknown>,
  warnUnmapped: (header: string) => void = () => {}
): InsertRow | null {
  const headers = Object.keys(raw);
  const fields = headers.map((h) => mapHeaderToField(h));
  return mapAgenCumRowByIndex(
    headers.map((h) => raw[h]),
    fields,
    headers,
    warnUnmapped
  );
}

/**
 * Varian berbasis indeks kolom: dipakai run nyata agar dua kolom berlabel
 * sama namun konteks berbeda (mis. "NAMA PEMILIK" vs "Nama Pemilik" di
 * samping bank) tetap terpetakan benar via ctx per kolom.
 */
export function mapAgenCumRowByIndex(
  cells: unknown[],
  fields: (DbField | "no" | null)[],
  labels: string[] = [],
  warnUnmapped: (header: string) => void = () => {}
): InsertRow | null {
  const row: InsertRow = {};
  let hasAnyValue = false;

  fields.forEach((field, c) => {
    if (!field) {
      const label = labels[c] ?? "";
      if (label !== "" && cellToText(cells[c]) !== null) warnUnmapped(label);
      return;
    }
    if (assignField(row, field, cells[c])) hasAnyValue = true;
  });

  if (!hasAnyValue) return null;
  const identity =
    (row.ppid as string | undefined) ??
    (row.nama_loket_kurlog as string | undefined) ??
    (row.nama_loket_onpays as string | undefined) ??
    (row.nama_pemilik as string | undefined);
  if (!identity || identity.trim() === "") return null;
  return row;
}

/** Label header tetangga (2 kiri + 2 kanan, tanpa yang kosong). */
function neighborLabels(headerRow: string[], c: number): string[] {
  const out: string[] = [];
  for (const i of [c - 2, c - 1, c + 1, c + 2]) {
    const v = headerRow[i];
    if (typeof v === "string" && v.trim() !== "") out.push(v);
  }
  return out;
}

/** Grup kolom = sel grup terdekat ke kiri (mendukung merged header grup). */
function groupForColumn(groupRow: unknown[], c: number): string {
  for (let i = c; i >= 0; i--) {
    const v = groupRow[i];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "";
}

export interface EffectiveField {
  field: DbField | "no" | null;
  /** Label untuk laporan (sub-header, atau grup bila sub kosong). */
  label: string;
}

/**
 * Bangun pemetaan per kolom dari header dua tingkat: sub-header
 * (baris header) + grup (baris di atasnya). Bila sub kosong (label
 * vertikal seperti PPID/LATITUDE), label grup dipakai sebagai header.
 */
export function buildEffectiveFields(
  headerRow: string[],
  groupRow: unknown[],
  rowsAbove: unknown[][] = []
): EffectiveField[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  /** Sel non-kosong pertama ke atas: grup, lalu maks 1 baris ringkasan. */
  const directLabelUp = (c: number): string => {
    const direct = String(groupRow[c] ?? "").trim();
    if (direct !== "") return direct;
    for (const row of rowsAbove) {
      const v = String(row[c] ?? "").trim();
      if (v !== "") return v;
    }
    return "";
  };
  return headerRow.map((h, c) => {
    const sub = (h ?? "").trim();
    if (sub === "") {
      // Label vertikal: sel non-kosong pertama hasil pindai ke ATAS
      // pada kolom yang sama (grup, lalu baris ringkasan). Tanpa warisan
      // ke kiri agar kolom kosong tak menelan label tetangga.
      // Sel angka (nomor urut baris 1) tidak terpetakan -> null.
      const direct = directLabelUp(c).trim();
      if (direct === "") return { field: null, label: "" };
      return {
        field: mapHeaderToField(direct, {
          index: c,
          group: "",
          neighbors: neighborLabels(headerRow, c),
        }),
        label: direct,
      };
    }
    const group = groupForColumn(groupRow, c).trim();
    const useGroup =
      group !== "" && norm(group) !== norm(sub) ? group : "";
    return {
      field: mapHeaderToField(sub, {
        index: c,
        group: useGroup,
        neighbors: neighborLabels(headerRow, c),
      }),
      label: sub,
    };
  });
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

/**
 * Cari baris header: baris (maks 10 baris awal) dengan kolom dikenali
 * TERBANYAK (minimal 3). Sheet Agen CUM memakai dua tingkat: baris grup
 * (STATUS, KURLOG, ...) di atas baris sub-header detail — baris detail
 * selalu menang skor sehingga data di bawah grup tak terlewat.
 */
export function findHeaderRowIndex(matrix: unknown[][]): number {
  let best = -1;
  let bestScore = 2;
  const limit = Math.min(matrix.length, 10);
  for (let r = 0; r < limit; r += 1) {
    const row = matrix[r] ?? [];
    let recognized = 0;
    for (let c = 0; c < row.length; c++) {
      if (mapHeaderToField(row[c], { index: c }) !== null) recognized += 1;
    }
    if (recognized > bestScore) {
      bestScore = recognized;
      best = r;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Baca file/sheet (sumber tunggal untuk main + backfill)
// ---------------------------------------------------------------------------

export interface SheetMatrix {
  sheetName: string;
  matrix: unknown[][];
}

/**
 * Baca file Excel + pilih sheet (persis, lalu fallback tanpa-spasi
 * case-insensitive) + ubah ke matriks AOA. Dipakai main() dan skrip
 * backfill agar parsing file tunggal sumbernya.
 * @throws Error bila file/sheet tak ditemukan.
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
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const sheetName = workbook.SheetNames.includes(sheet)
    ? sheet
    : workbook.SheetNames.find((n) => norm(n) === norm(sheet));
  if (!sheetName) {
    throw new Error(
      `Sheet "${sheet}" tidak ditemukan. Sheet tersedia: ${workbook.SheetNames.join(", ")}`
    );
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
  if (withoutPpid.length > 0) {
    console.log(
      `  Catatan: ${withoutPpid.length} baris tanpa PPID selalu di-INSERT (risiko duplikat saat impor ulang).`
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
