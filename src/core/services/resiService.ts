/**
 * Service tabel `resi` — monitoring + follow-up.
 * Client-agnostic (dipakai server-side via service_role di API routes).
 *
 * Kolom live (terverifikasi 2026-09-22): id, created_at, nomor_resi, agen,
 * kode_layanan, petugas, status_resi, is_selesai, catatan_fu, layanan,
 * no_resi, status_fu, catatan, tgl_tiket, closed_at, status_followup,
 * catatan_followup, followed_up_by, followed_up_at.
 * Nilai status_followup: 'BELUM_FOLLOWUP' | 'SUDAH_FOLLOWUP'.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError } from "./dataUtamaService";

export interface ResiRow {
  id: number;
  created_at: string | null;
  nomor_resi: string | null;
  agen: string;
  kode_layanan: string | null;
  petugas: string;
  status_resi: string | null;
  is_selesai: string | null;
  catatan_fu: string | null;
  layanan: string | null;
  no_resi: string;
  status_fu: string | null;
  catatan: string | null;
  tgl_tiket: string | null;
  closed_at: string | null;
  status_followup: string | null;
  catatan_followup: string | null;
  followed_up_by: string | null;
  followed_up_at: string | null;
}

export type ResiFollowUpFilter = "semua" | "belum" | "sudah" | "selesai";

export type FollowUpStatus =
  | "BELUM_FOLLOWUP"
  | "PROSES_FOLLOWUP"
  | "SUDAH_FOLLOWUP";

/**
 * Pilihan status pada dropdown interaktif: status follow-up + SELESAI
 * (SELESAI dipetakan menjadi SUDAH_FOLLOWUP + flag is_selesai).
 */
export type ResiStatusChoice = FollowUpStatus | "SELESAI";

const FOLLOWUP_PENDING = "BELUM_FOLLOWUP";
const FOLLOWUP_PROGRESS = "PROSES_FOLLOWUP";
const FOLLOWUP_DONE = "SUDAH_FOLLOWUP";

/**
 * Catatan berisi deliv/delivered/retur otomatis menutup resi (CLOSE =
 * SUDAH_FOLLOWUP + flag is_selesai + stempel closed_at).
 */
export const AUTO_CLOSE_NOTE_REGEX = /deliv|delivered|retur/i;

export function isAutoCloseNote(catatan: string | null | undefined): boolean {
  if (catatan === null || catatan === undefined || catatan.trim() === "") {
    return false;
  }
  return AUTO_CLOSE_NOTE_REGEX.test(catatan);
}

/** Resi tertutup terpurge otomatis setelah N hari. */
export const RESI_PURGE_AFTER_DAYS = 2;

/** Batas waktu purge (ISO) dari waktu acuan — murni, untuk test. */
export function getPurgeCutoff(now: Date = new Date()): string {
  return new Date(
    now.getTime() - RESI_PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

export interface ResiPurgeResult {
  purged: number;
}

/**
 * Hapus resi tertutup yang kedaluwarsa (>2 hari). Penanda tutup:
 * is_selesai='SELESAI' (atau legacy status_followup='CLOSE'); umur dihitung
 * dari closed_at, fallback followed_up_at bila closed_at kosong.
 */
export async function purgeExpiredResi(
  client: SupabaseClient,
  now: Date = new Date()
): Promise<ResiPurgeResult> {
  const cutoff = getPurgeCutoff(now);
  let purged = 0;
  const markers = [
    { col: "is_selesai", val: SELESAI },
    { col: "status_followup", val: "CLOSE" },
  ];
  for (const marker of markers) {
    const byClosed = await client
      .from("resi")
      .delete()
      .eq(marker.col, marker.val)
      .lte("closed_at", cutoff)
      .select("id");
    if (byClosed.error) {
      logSupabaseError("purge", byClosed.error, "resi");
      throw byClosed.error;
    }
    purged += (byClosed.data ?? []).length;

    const byFollowed = await client
      .from("resi")
      .delete()
      .eq(marker.col, marker.val)
      .is("closed_at", null)
      .lte("followed_up_at", cutoff)
      .select("id");
    if (byFollowed.error) {
      logSupabaseError("purge", byFollowed.error, "resi");
      throw byFollowed.error;
    }
    purged += (byFollowed.data ?? []).length;
  }
  return { purged };
}
/** Flag selesai (kolom is_selesai). Terpisah dari follow-up. */
const SELESAI = "SELESAI";

export interface ResiListParams {
  status?: ResiFollowUpFilter;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Filter rentang tanggal created_at, format YYYY-MM-DD (inklusif). */
  startDate?: string;
  endDate?: string;
}

export interface ResiListResult {
  data: ResiRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const RESI_DEFAULT_PAGE_SIZE = 50;
export const RESI_MAX_PAGE_SIZE = 200;
/** Pilihan dropdown jumlah data per halaman. */
export const RESI_PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

/** Kolom pencarian: no resi + nama loket. */
const RESI_SEARCH_COLUMNS = ["no_resi", "agen"] as const;

/**
 * Kolom yang benar-benar dipakai tabel Monitoring (bukan select('*'))
 * agar payload list paginasi tetap ringan.
 */
export const RESI_LIST_COLUMNS =
  "id,no_resi,agen,layanan,status_resi,status_followup,is_selesai,catatan_followup,followed_up_by,followed_up_at";

function sanitizeKeyword(raw: string): string {
  return raw
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Validasi tanggal YYYY-MM-DD kalender; null bila kosong/undefined. */
export function normalizeFilterDate(value: string | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const t = value.trim();
  if (!DATE_ONLY_REGEX.test(t)) {
    throw new Error(`Tanggal tidak valid: ${value} (format YYYY-MM-DD)`);
  }
  const d = new Date(`${t}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Tanggal tidak valid: ${value}`);
  const [y, m, day] = t.split("-").map(Number);
  if (
    d.getFullYear() !== y ||
    d.getMonth() + 1 !== m ||
    d.getDate() !== day
  ) {
    throw new Error(`Tanggal tidak valid: ${value}`);
  }
  return t;
}

/** True bila resi sudah di-follow-up. */
export function isFollowedUp(row: Pick<ResiRow, "status_followup">): boolean {
  return (
    typeof row.status_followup === "string" &&
    row.status_followup.trim().toUpperCase() === FOLLOWUP_DONE
  );
}

/** True bila resi selesai (flag is_selesai). */
export function isSelesai(row: Pick<ResiRow, "is_selesai">): boolean {
  return (
    typeof row.is_selesai === "string" &&
    row.is_selesai.trim().toUpperCase() === SELESAI
  );
}

export async function getMonitoringResiList(
  client: SupabaseClient,
  params: ResiListParams = {},
): Promise<ResiListResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    RESI_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? RESI_DEFAULT_PAGE_SIZE))
  );

  let query = client
    .from("resi")
    .select(RESI_LIST_COLUMNS, { count: "exact" });

  const status = params.status ?? "semua";
  if (status === "belum") {
    query = query.eq("status_followup", FOLLOWUP_PENDING);
  } else if (status === "sudah") {
    query = query.eq("status_followup", FOLLOWUP_DONE);
  } else if (status === "selesai") {
    query = query.eq("is_selesai", SELESAI);
  }

  const search = sanitizeKeyword(params.search ?? "");
  if (search !== "") {
    const pattern = `%${search}%`;
    query = query.or(
      RESI_SEARCH_COLUMNS.map((col) => `${col}.ilike.${pattern}`).join(",")
    );
  }

  const startDate = normalizeFilterDate(params.startDate);
  const endDate = normalizeFilterDate(params.endDate);
  if (startDate !== null && endDate !== null && startDate > endDate) {
    throw new Error("Rentang tanggal tidak valid (mulai > selesai)");
  }
  if (startDate !== null) {
    query = query.gte("created_at", `${startDate}T00:00:00`);
  }
  if (endDate !== null) {
    query = query.lte("created_at", `${endDate}T23:59:59.999`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Sorting ganda: created_at + id agar urutan stabil (tidak lompat)
  // saat ada baris bertanggal sama atau setelah update status/catatan.
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (error) {
    logSupabaseError("list", error, "resi");
    throw error;
  }

  const total = Math.max(0, count ?? 0);
  return {
    data: (data ?? []) as ResiRow[],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Alias kompatibilitas: nama historis yang dipakai API routes & tests.
 * Kanonis: {@link getMonitoringResiList}.
 */
export const getResiList = getMonitoringResiList;

export interface UpdateFollowUpInput {
  id: number;
  status: FollowUpStatus | string;
  catatan: string;
  userName: string;
}

/** Normalisasi status follow-up (case-insensitive); throw bila asing. */
export function normalizeFollowUpStatus(status: string): FollowUpStatus {
  const norm = status.trim().toUpperCase();
  if (norm === FOLLOWUP_DONE) return FOLLOWUP_DONE;
  if (norm === FOLLOWUP_PROGRESS) return FOLLOWUP_PROGRESS;
  if (norm === FOLLOWUP_PENDING) return FOLLOWUP_PENDING;
  throw new Error(
    `Status follow-up tidak valid: ${status} (harus ${FOLLOWUP_PENDING}/${FOLLOWUP_PROGRESS}/${FOLLOWUP_DONE})`
  );
}

/** Daftar pilihan dropdown status (urutan tampil). */
export const RESI_STATUS_CHOICES: ResiStatusChoice[] = [
  FOLLOWUP_PENDING,
  FOLLOWUP_PROGRESS,
  FOLLOWUP_DONE,
  SELESAI,
];

/**
 * Normalisasi pilihan dropdown: BELUM/PROSES/SUDAH lolos langsung;
 * "SELESAI" dipetakan ke SUDAH_FOLLOWUP + flag is_selesai.
 */
export function normalizeResiStatusChoice(status: string): {
  status_followup: FollowUpStatus;
  is_selesai: string | null;
} {
  const norm = status.trim().toUpperCase();
  if (norm === SELESAI) {
    return { status_followup: FOLLOWUP_DONE, is_selesai: SELESAI };
  }
  return { status_followup: normalizeFollowUpStatus(norm), is_selesai: null };
}

/** Pemisah antar entri riwayat catatan follow-up. */
export const HISTORY_SEPARATOR = "----------------------------------------";

/** Timestamp entri riwayat "DD/MM/YYYY HH:mm" (WIB). Murni, untuk test. */
export function formatHistoryTimestamp(at: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? "00" : (parts.hour ?? "00");
  return `${parts.day ?? "00"}/${parts.month ?? "00"}/${parts.year ?? "0000"} ${hour}:${parts.minute ?? "00"}`;
}

/** Satu entri riwayat: "[23/09/2026 10:30 - CS1]: isi catatan". */
export function formatHistoryEntry(
  userName: string,
  note: string,
  at: Date = new Date()
): string {
  return `[${formatHistoryTimestamp(at)} - ${userName.trim()}]: ${note.trim()}`;
}

/**
 * Gabung entri baru DI ATAS riwayat lama (append history, bukan timpa).
 * Catatan kosong ("") berarti tidak ada entri baru -> riwayat dipertahankan.
 */
export function appendHistoryLog(
  existing: string | null | undefined,
  entry: string
): string | null {
  const old = (existing ?? "").trim();
  const fresh = entry.trim();
  if (fresh === "") return old === "" ? null : existing?.trim() ?? null;
  if (old === "") return fresh;
  return `${fresh}\n${HISTORY_SEPARATOR}\n${old}`;
}

/** Pecah kolom riwayat menjadi daftar entri (terbaru dulu). */
export function parseHistoryLog(log: string | null | undefined): string[] {
  if (!log || log.trim() === "") return [];
  return log
    .split(`\n${HISTORY_SEPARATOR}\n`)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Baca catatan_followup yang tersimpan (untuk digabung, bukan ditimpa). */
async function readCatatanFollowup(
  client: SupabaseClient,
  id: number
): Promise<string | null> {
  const { data, error } = await client
    .from("resi")
    .select("catatan_followup")
    .eq("id", id)
    .single();
  if (error) {
    logSupabaseError("read-catatan", error, "resi");
    throw error;
  }
  return (data as { catatan_followup: string | null } | null)?.catatan_followup ?? null;
}

/**
 * Perbarui status follow-up resi: status_followup + catatan_followup
 * (digabung sebagai riwayat, entri baru di atas) + followed_up_by +
 * followed_up_at (waktu eksekusi ISO).
 * Kolom legacy (status_fu/dll) SENGAJA tak disentuh.
 *
 * Mendukung dua gaya pemanggilan:
 * - Spesifikasi migrasi: `updateFollowUpStatus(client, id, status, catatan, userName)`
 * - Gaya objek (API routes/tests): `updateFollowUpStatus(client, { id, status, catatan, userName })`
 */
export async function updateFollowUpStatus(
  client: SupabaseClient,
  id: number,
  status: FollowUpStatus | string,
  catatan: string,
  userName: string,
): Promise<ResiRow>;
export async function updateFollowUpStatus(
  client: SupabaseClient,
  input: UpdateFollowUpInput,
): Promise<ResiRow>;
export async function updateFollowUpStatus(
  client: SupabaseClient,
  idOrInput: number | UpdateFollowUpInput,
  status?: FollowUpStatus | string,
  catatan?: string,
  userName?: string,
): Promise<ResiRow> {
  const input: UpdateFollowUpInput =
    typeof idOrInput === "object" && idOrInput !== null
      ? idOrInput
      : {
          id: idOrInput as number,
          status: (status ?? "") as FollowUpStatus | string,
          catatan: catatan ?? "",
          userName: userName ?? "",
        };
  const { id } = input;
  if (!Number.isInteger(id)) {
    throw new Error("ID resi tidak valid");
  }
  const normalized = normalizeFollowUpStatus(input.status);
  const executor = input.userName.trim();
  if (executor === "") throw new Error("Nama user tidak boleh kosong");
  const note = input.catatan.trim();
  const nowIso = new Date().toISOString();
  // Otomatisasi CLOSE: catatan berisi deliv/delivered/retur menutup resi.
  const autoClose = isAutoCloseNote(note);
  // Riwayat: entri baru digabung di atas catatan lama (tidak menimpa).
  const existing = await readCatatanFollowup(client, id);
  const merged = appendHistoryLog(
    existing,
    note === "" ? "" : formatHistoryEntry(executor, note)
  );

  const { data, error } = await client
    .from("resi")
    .update({
      status_followup: autoClose ? FOLLOWUP_DONE : normalized,
      ...(autoClose ? { is_selesai: SELESAI, closed_at: nowIso } : {}),
      catatan_followup: merged,
      followed_up_by: executor,
      followed_up_at: nowIso,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    logSupabaseError("update-followup", error, "resi");
    throw error;
  }
  return data as ResiRow;
}

export interface UpdateResiStatusInput {
  id: number;
  status: ResiStatusChoice | string;
  /** Catatan follow-up; wajib diisi bila status SELESAI. */
  catatan?: string;
  userName: string;
}

/**
 * Update status resi interaktif (dropdown tabel): status_followup (+ flag
 * is_selesai bila SELESAI) + catatan_followup + followed_up_by/at.
 * Kolom legacy (status_fu/dll) SENGAJA tak disentuh.
 */
export async function updateResiStatus(
  client: SupabaseClient,
  id: number,
  status: ResiStatusChoice | string,
  catatan: string | undefined,
  userName: string
): Promise<ResiRow>;
export async function updateResiStatus(
  client: SupabaseClient,
  input: UpdateResiStatusInput
): Promise<ResiRow>;
export async function updateResiStatus(
  client: SupabaseClient,
  idOrInput: number | UpdateResiStatusInput,
  status?: ResiStatusChoice | string,
  catatan?: string,
  userName?: string
): Promise<ResiRow> {
  const input: UpdateResiStatusInput =
    typeof idOrInput === "object" && idOrInput !== null
      ? idOrInput
      : {
          id: idOrInput as number,
          status: (status ?? "") as ResiStatusChoice | string,
          catatan,
          userName: userName ?? "",
        };
  const { id } = input;
  if (!Number.isInteger(id)) {
    throw new Error("ID resi tidak valid");
  }
  const { status_followup, is_selesai } = normalizeResiStatusChoice(
    input.status
  );
  const note = (input.catatan ?? "").trim();
  if (is_selesai === SELESAI && note === "") {
    throw new Error("Catatan wajib diisi untuk status SELESAI");
  }
  const executor = input.userName.trim();
  if (executor === "") throw new Error("Nama user tidak boleh kosong");
  const nowIso = new Date().toISOString();
  // Otomatisasi CLOSE: catatan berisi deliv/delivered/retur menutup resi
  // apa pun pilihan statusnya.
  const autoClose = isAutoCloseNote(note);
  const finalStatus = autoClose ? FOLLOWUP_DONE : status_followup;
  const finalSelesai = autoClose ? SELESAI : is_selesai;
  // Riwayat: entri baru digabung di atas catatan lama (tidak menimpa).
  const existing = await readCatatanFollowup(client, id);
  const merged = appendHistoryLog(
    existing,
    note === "" ? "" : formatHistoryEntry(executor, note)
  );

  const { data, error } = await client
    .from("resi")
    .update({
      status_followup: finalStatus,
      is_selesai: finalSelesai,
      ...(finalSelesai === SELESAI ? { closed_at: nowIso } : {}),
      catatan_followup: merged,
      followed_up_by: executor,
      followed_up_at: nowIso,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    logSupabaseError("update-status", error, "resi");
    throw error;
  }
  return data as ResiRow;
}

/** Hapus satu baris resi berdasarkan id. */
export async function deleteResi(
  client: SupabaseClient,
  id: number
): Promise<void> {
  if (!Number.isInteger(id)) {
    throw new Error("ID resi tidak valid");
  }
  const { error } = await client.from("resi").delete().eq("id", id);
  if (error) {
    logSupabaseError("delete", error, "resi");
    throw error;
  }
}

export const RESI_DELETE_MAX_IDS = 2000;
const RESI_DELETE_CHUNK = 500;

export interface ResiDeleteBatchResult {
  deleted: number;
}

/** Hapus banyak resi sekaligus (chunk 500 per klausa .in()). */
export async function deleteResiBatch(
  client: SupabaseClient,
  ids: number[]
): Promise<ResiDeleteBatchResult> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (unique.length === 0) return { deleted: 0 };
  if (unique.length > RESI_DELETE_MAX_IDS) {
    throw new Error(
      `Maksimal ${RESI_DELETE_MAX_IDS} id per hapus massal (pecah menjadi beberapa batch)`
    );
  }
  let deleted = 0;
  for (let i = 0; i < unique.length; i += RESI_DELETE_CHUNK) {
    const chunk = unique.slice(i, i + RESI_DELETE_CHUNK);
    const { data, error } = await client
      .from("resi")
      .delete()
      .in("id", chunk)
      .select("id");
    if (error) {
      logSupabaseError("delete-batch", error, "resi");
      throw error;
    }
    deleted += data != null ? data.length : chunk.length;
  }
  return { deleted };
}

// ---------------------------------------------------------------------------
// Import copy-paste (copas) dari Excel/pesan teks — parser murni + check-merge.
// Format 7 kolom: Tgl Tiket | No. Resi | Agen | Kode Layanan | Petugas |
// Status Resi | Selesai. 5 kolom tanpa tanggal juga diterima (tgl = hari ini
// di sisi DB via default). Baris header otomatis dilewati.
// ---------------------------------------------------------------------------

export interface ResiCopasItem {
  /** YYYY-MM-DD atau null (DB memakai default current_date). */
  tgl_tiket: string | null;
  no_resi: string;
  agen: string;
  kode_layanan: string;
  petugas: string;
  status_resi: string;
  status_followup: FollowUpStatus;
  /** "SELESAI" atau null. */
  is_selesai: string | null;
}

export interface ResiCopasParseResult {
  items: ResiCopasItem[];
  /** Baris dilewati (kosong/header/resi kosong). */
  skipped: number;
}

export const RESI_COPAS_MAX_ROWS = 500;

const COPAS_HEADER_MARKERS = [
  "TGL",
  "TIKET",
  "NO",
  "RESI",
  "AGEN",
  "LAYANAN",
  "PETUGAS",
  "STATUS",
  "SELESAI",
] as const;

/** True bila baris adalah header (memuat ≥2 penanda, termasuk pasangan NO+RESI). */
export function isResiCopasHeader(line: string): boolean {
  const upper = line.toUpperCase();
  let hits = 0;
  for (const marker of COPAS_HEADER_MARKERS) {
    if (upper.includes(marker)) hits += 1;
  }
  if (hits < 2) return false;
  return (
    (upper.includes("NO") && upper.includes("RESI")) ||
    upper.includes("TIKET") ||
    (upper.includes("AGEN") && upper.includes("PETUGAS"))
  );
}

/**
 * Sanitasi nomor resi ala proyek lama: buang karakter tak kasatmata/NBSP,
 * hapus seluruh spasi dalam, uppercase. Dipakai sebelum cek maupun simpan.
 */
export function sanitizeNomorResi(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, "")
    .replace(/[\uFEFF\u200B\u200C\u200D\u2060\u180E]/g, "")
    .replace(/[\t\n\r]/g, "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** Sanitasi teks bebas (agen/petugas): buang tak kasatmata, rapikan spasi. */
function sanitizeCopasText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\uFEFF\u200B\u200C\u200D\u2060\u180E]/g, "")
    .replace(/[\t\n\r]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Pecah kolom: TAB > koma > pipe/semicolon > 2+ spasi > spasi tunggal. */
export function splitCopasColumns(line: string): string[] {
  const trimCells = (cells: string[]) => cells.map((c) => c.trim());
  if (line.includes("\t")) return trimCells(line.split("\t"));
  if (line.includes(",")) return trimCells(line.split(","));
  if (line.includes("|")) return trimCells(line.split("|"));
  if (line.includes(";")) return trimCells(line.split(";"));
  if (/ {2,}/.test(line)) return trimCells(line.split(/ {2,}/));
  return trimCells(line.split(/ +/));
}

function isDateLike(token: string): boolean {
  const t = token.trim();
  return (
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(t) || /^\d{4}-\d{1,2}-\d{1,2}/.test(t)
  );
}

/**
 * "22/09/2026 20:24:04" / "22-09-2026" / "2026-09-22" -> "2026-09-22".
 * Null bila tak dikenali (DB memakai default current_date).
 */
export function parseCopasDate(token: string): string | null {
  const t = token.trim().split(/\s+/)[0] ?? "";
  let d = "";
  let m = "";
  let y = "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    y = iso[1] ?? "";
    m = iso[2] ?? "";
    d = iso[3] ?? "";
  } else {
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
    if (!dmy) return null;
    d = dmy[1] ?? "";
    m = dmy[2] ?? "";
    y = dmy[3] ?? "";
    if (y.length === 2) y = `20${y}`;
  }
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  const day = Number(dd);
  const mon = Number(mm);
  const year = Number(y);
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(mon) ||
    !Number.isInteger(year) ||
    day < 1 ||
    day > 31 ||
    mon < 1 ||
    mon > 12 ||
    year < 2000 ||
    year > 2100
  ) {
    return null;
  }
  return `${y.padStart(4, "0")}-${mm}-${dd}`;
}

/** "BELUM" -> BELUM_FOLLOWUP; "SELESAI"/"SUDAH"/"DONE"/"CLOSED" -> SUDAH_FOLLOWUP. */
export function mapCopasSelesai(token: string | undefined): {
  status_followup: FollowUpStatus;
  is_selesai: string | null;
} {
  const upper = (token ?? "").trim().toUpperCase();
  if (upper === "") return { status_followup: FOLLOWUP_PENDING, is_selesai: null };
  if (upper.includes("BELUM"))
    return { status_followup: FOLLOWUP_PENDING, is_selesai: null };
  if (upper.includes("SELESAI"))
    return { status_followup: FOLLOWUP_DONE, is_selesai: SELESAI };
  if (
    upper.includes("SUDAH") ||
    upper.includes("DONE") ||
    upper.includes("CLOSED")
  )
    return { status_followup: FOLLOWUP_DONE, is_selesai: null };
  return { status_followup: FOLLOWUP_PENDING, is_selesai: null };
}

/**
 * Parser murni teks copas -> item siap import. Dedup berdasarkan no_resi
 * (case-insensitive, baris pertama menang). Melempar bila > 500 baris valid.
 */
export function parseResiCopasText(raw: string): ResiCopasParseResult {
  const items: ResiCopasItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || isResiCopasHeader(line)) {
      if (line !== "" && isResiCopasHeader(line)) skipped += 1;
      continue;
    }
    const cols = splitCopasColumns(line).filter((c) => c !== "");
    if (cols.length === 0) continue;

    // Kolom 1 tanggal bila mirip tanggal; selain itu kolom 1 = no resi.
    const hasDate = isDateLike(cols[0] ?? "");
    const tglToken = hasDate ? (cols[0] ?? "") : "";
    const rest = hasDate ? cols.slice(1) : cols;
    // Sanitasi nomor resi (trim + NBSP/tak kasatmata + uppercase) sebelum cek.
    const noResi = sanitizeNomorResi(rest[0] ?? "");
    if (noResi === "") {
      skipped += 1;
      continue;
    }
    if (seen.has(noResi)) {
      skipped += 1;
      continue;
    }
    seen.add(noResi);

    const { status_followup, is_selesai } = mapCopasSelesai(rest[5]);
    const agen = sanitizeCopasText(rest[1] ?? "");
    const layanan = sanitizeCopasText(rest[2] ?? "").toUpperCase();
    const petugas = sanitizeCopasText(rest[3] ?? "");
    const statusResi = sanitizeCopasText(rest[4] ?? "").toUpperCase();
    items.push({
      tgl_tiket: tglToken === "" ? null : parseCopasDate(tglToken),
      no_resi: noResi,
      agen: agen === "" ? "-" : agen,
      kode_layanan: layanan === "" ? "PE" : layanan,
      petugas: petugas === "" ? "ADMIN" : petugas,
      status_resi: statusResi === "" ? "PERJALANAN" : statusResi,
      status_followup,
      is_selesai,
    });

    if (items.length > RESI_COPAS_MAX_ROWS) {
      throw new Error(
        `Maksimal ${RESI_COPAS_MAX_ROWS} baris per import (pecah menjadi beberapa batch)`
      );
    }
  }

  return { items, skipped };
}

export interface ResiBatchResult {
  inserted: number;
  updated: number;
}

/** Payload baris import: kunci ganda no_resi + nomor_resi, null dilewati. */
function toResiImportPayload(it: ResiCopasItem): Record<string, string> {
  return {
    no_resi: it.no_resi,
    nomor_resi: it.no_resi,
    ...(it.tgl_tiket !== null ? { tgl_tiket: it.tgl_tiket } : {}),
    agen: it.agen,
    kode_layanan: it.kode_layanan,
    layanan: it.kode_layanan,
    petugas: it.petugas,
    status_resi: it.status_resi,
    status_followup: it.status_followup,
    ...(it.is_selesai !== null ? { is_selesai: it.is_selesai } : {}),
  };
}

/**
 * Batch import "check and merge" ala proyek lama — TANPA `.upsert(onConflict)`
 * agar tidak memicu error Postgres 42P10 saat tabel belum punya Unique
 * Constraint:
 * 1. Ambil daftar nomor_resi dari batch.
 * 2. Query `select('id, nomor_resi, status_followup').in('nomor_resi', ...)`
 *    untuk yang sudah ada.
 * 3. Pisahkan `toInsert` (baru) vs `toUpdate` (lama).
 * 4. `.insert()` untuk data baru.
 * 5. `.update().eq('nomor_resi', ...)` per baris lama, tanpa menurunkan
 *    status SUDAH_FOLLOWUP yang sudah dikerjakan user menjadi BELUM.
 */
export async function importResiBatch(
  client: SupabaseClient,
  items: ResiCopasItem[]
): Promise<ResiBatchResult> {
  if (items.length === 0) return { inserted: 0, updated: 0 };
  if (items.length > RESI_COPAS_MAX_ROWS) {
    throw new Error(
      `Maksimal ${RESI_COPAS_MAX_ROWS} baris per import (pecah menjadi beberapa batch)`
    );
  }

  // Sanitasi ulang + dedup (terakhir menang, mengikuti proyek lama).
  const byResi = new Map<string, ResiCopasItem>();
  for (const it of items) {
    const key = sanitizeNomorResi(it.no_resi);
    if (key === "") continue;
    byResi.set(key, { ...it, no_resi: key });
  }
  const deduped = [...byResi.values()];
  if (deduped.length === 0) return { inserted: 0, updated: 0 };

  // 1-2. Ambil nomor_resi yang sudah ada (chunk 500 untuk klausa .in()).
  const CHECK_CHUNK = 500;
  const existing = new Map<string, string | null>();
  for (let i = 0; i < deduped.length; i += CHECK_CHUNK) {
    const chunk = deduped.slice(i, i + CHECK_CHUNK).map((d) => d.no_resi);
    const { data, error } = await client
      .from("resi")
      .select("id, nomor_resi, status_followup")
      .in("nomor_resi", chunk);
    if (error) {
      logSupabaseError("batch-check", error, "resi");
      throw error;
    }
    for (const row of (data ?? []) as {
      nomor_resi: string;
      status_followup: string | null;
    }[]) {
      existing.set(sanitizeNomorResi(row.nomor_resi), row.status_followup ?? null);
    }
  }

  // 3. Pisahkan data baru vs data lama.
  const toInsert = deduped.filter((d) => !existing.has(d.no_resi));
  const toUpdate = deduped.filter((d) => existing.has(d.no_resi));

  // 4. Insert data baru.
  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await client
      .from("resi")
      .insert(toInsert.map(toResiImportPayload))
      .select("id");
    if (error) {
      logSupabaseError("batch-insert", error, "resi");
      throw error;
    }
    inserted = data != null ? data.length : toInsert.length;
  }

  // 5. Update data lama per nomor_resi (paralel terbatas per chunk).
  let updated = 0;
  const UPDATE_CHUNK = 25;
  for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
    const chunk = toUpdate.slice(i, i + UPDATE_CHUNK);
    await Promise.all(
      chunk.map(async (d) => {
        const prev = existing.get(d.no_resi) ?? null;
        const payload = toResiImportPayload(d);
        if (
          prev !== null &&
          prev.trim().toUpperCase() === FOLLOWUP_DONE &&
          d.status_followup === FOLLOWUP_PENDING
        ) {
          payload.status_followup = FOLLOWUP_DONE;
        }
        const { error } = await client
          .from("resi")
          .update(payload)
          .eq("nomor_resi", d.no_resi);
        if (error) {
          logSupabaseError("batch-update", error, "resi");
          throw error;
        }
      })
    );
    updated += chunk.length;
  }

  return { inserted, updated };
}
