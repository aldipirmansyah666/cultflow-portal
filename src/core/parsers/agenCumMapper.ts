/**
 * Mapper Agen CUM — logika murni pemetaan header Excel sheet 'Agen CUM'
 * ke kolom `data_lengkap_utama` + whitelist skema + discovery skema live.
 *
 * SENGAJA tanpa dependensi Node (fs/path) maupun browser-only agar bisa
 * diimpor dari CLI (`src/scripts/importAgenCum.ts`), service browser
 * (`dataUtamaService.importExcelData`), maupun API route server.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Daftar kolom DB yang bisa diisi (tanpa id / created_at)
// ---------------------------------------------------------------------------

export const TEXT_FIELDS = [
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

export const BOOL_FIELDS = [
  "kurlog_pos_ppob",
  "kurlog_pos_only",
  "kurlog_sicepat",
] as const;

export type DbField = (typeof TEXT_FIELDS)[number] | (typeof BOOL_FIELDS)[number];
export type InsertRow = Partial<Record<DbField | "no", string | number | boolean>>;

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
 * pemilik rekening -> sub-header ketat -> gabungan "grup + sub".
 * Kembalikan null bila tidak dikenali.
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
  const clean = sanitizeCell(value);
  if (clean === null) return null;
  if (typeof clean === "number") return String(clean);
  if (typeof clean === "boolean") return clean ? "Ya" : "Tidak";
  return clean;
}

/**
 * Sanitasi satu sel mentah menjadi primitif aman DB:
 * string (trim, kosong -> null), number finite, boolean.
 * Date -> ISO string. Objek/array/DATE tak dikenal -> null
 * (mencegah "[object Object]" tersimpan di database).
 */
export function sanitizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? null : text;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
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
 * pengirim mengisinya dari hasil discovery skema live (irisan statis ∩
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
// Discovery skema live
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

/**
 * Cari baris header: pindai (maks 10 baris awal) baris PERTAMA yang
 * mengandung kata 'PPID' sebagai jangkar, lalu pilih antara baris jangkar
 * dan baris tepat di bawahnya berdasarkan skor kolom dikenali (minimal 3).
 *
 * Rasional (sheet Agen CUM asli): baris jangkar = baris grup (STATUS,
 * KURLOG, PPID, NAMA LOKET DI ONPAYS, ...) dan baris di bawahnya = baris
 * sub-header detail (SYARAT, PENGAJUAN SURVEY KE POS, ...). Baris detail
 * menang skor sehingga data di bawah grup tak terlewat; untuk sheet datar
 * (header = baris jangkar) jangkar sendiri yang menang.
 * Kembalikan -1 bila tak ada jangkar PPID / skor tak mencukupi.
 */
export function findHeaderRowIndex(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 10);
  const hasPpid = (row: unknown[]): boolean =>
    (row ?? []).some((cell) =>
      headerTokens(cell).join(" ").includes("ppid")
    );
  let anchor = -1;
  for (let r = 0; r < limit; r += 1) {
    if (hasPpid(matrix[r] ?? [])) {
      anchor = r;
      break;
    }
  }
  if (anchor === -1) return -1;

  const score = (r: number): number => {
    if (r < 0 || r >= matrix.length) return -1;
    const row = matrix[r] ?? [];
    let recognized = 0;
    for (let c = 0; c < row.length; c++) {
      if (mapHeaderToField(row[c], { index: c }) !== null) recognized += 1;
    }
    return recognized;
  };
  const anchorScore = score(anchor);
  const nextScore = score(anchor + 1);
  const winner = nextScore > anchorScore ? anchor + 1 : anchor;
  const winnerScore = nextScore > anchorScore ? nextScore : anchorScore;
  return winnerScore >= 3 ? winner : -1;
}
