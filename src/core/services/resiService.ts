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

export type ResiFollowUpFilter = "semua" | "belum" | "sudah";

export type FollowUpStatus = "BELUM_FOLLOWUP" | "SUDAH_FOLLOWUP";

const FOLLOWUP_PENDING = "BELUM_FOLLOWUP";
const FOLLOWUP_DONE = "SUDAH_FOLLOWUP";

export interface ResiListParams {
  status?: ResiFollowUpFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ResiListResult {
  data: ResiRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const RESI_DEFAULT_PAGE_SIZE = 20;
export const RESI_MAX_PAGE_SIZE = 100;

/** Kolom pencarian: no resi + nama loket. */
const RESI_SEARCH_COLUMNS = ["no_resi", "agen"] as const;

function sanitizeKeyword(raw: string): string {
  return raw
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** True bila resi sudah di-follow-up. */
export function isFollowedUp(row: Pick<ResiRow, "status_followup">): boolean {
  return (
    typeof row.status_followup === "string" &&
    row.status_followup.trim().toUpperCase() === FOLLOWUP_DONE
  );
}

export async function getResiList(
  client: SupabaseClient,
  params: ResiListParams = {}
): Promise<ResiListResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    RESI_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? RESI_DEFAULT_PAGE_SIZE))
  );

  let query = client.from("resi").select("*", { count: "exact" });

  const status = params.status ?? "semua";
  if (status === "belum") {
    query = query.eq("status_followup", FOLLOWUP_PENDING);
  } else if (status === "sudah") {
    query = query.eq("status_followup", FOLLOWUP_DONE);
  }

  const search = sanitizeKeyword(params.search ?? "");
  if (search !== "") {
    const pattern = `%${search}%`;
    query = query.or(
      RESI_SEARCH_COLUMNS.map((col) => `${col}.ilike.${pattern}`).join(",")
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
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
  if (norm === FOLLOWUP_PENDING) return FOLLOWUP_PENDING;
  throw new Error(
    `Status follow-up tidak valid: ${status} (harus ${FOLLOWUP_DONE}/${FOLLOWUP_PENDING})`
  );
}

/**
 * Perbarui status follow-up resi: status_followup + catatan_followup +
 * followed_up_by (nama user) + followed_up_at (waktu eksekusi ISO).
 * Kolom legacy (status_fu/dll) SENGAJA tak disentuh.
 */
export async function updateFollowUpStatus(
  client: SupabaseClient,
  input: UpdateFollowUpInput
): Promise<ResiRow> {
  if (!Number.isInteger(input.id)) {
    throw new Error("ID resi tidak valid");
  }
  const status = normalizeFollowUpStatus(input.status);
  const userName = input.userName.trim();
  if (userName === "") throw new Error("Nama user tidak boleh kosong");

  const { data, error } = await client
    .from("resi")
    .update({
      status_followup: status,
      catatan_followup: input.catatan.trim() === "" ? null : input.catatan.trim(),
      followed_up_by: userName,
      followed_up_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    logSupabaseError("update-followup", error, "resi");
    throw error;
  }
  return data as ResiRow;
}
