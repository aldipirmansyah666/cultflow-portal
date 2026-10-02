/**
 * DELETE /api/fee-rekap/drop-all — reset TOTAL database fee (khusus ADMIN).
 *
 * Menghapus SELURUH baris pada:
 *   1. `loket_transaction_details` (rincihan modul — dihapus dulu karena
 *      secara logis bergantung pada profil),
 *   2. `loket_profiles` (identitas + ringkasan Master),
 *   3. `fee_loket` (cermin legacy agar tidak ada sisa yatim).
 * Riwayat `fee_upload_logs` DIPERTAHANKAN sebagai jejak audit.
 *
 * Mengembalikan { success, deleted: { details, profiles, feeLoket } }.
 * Konfirmasi "Are you sure?" ditangani di UI (dialog) — endpoint ini
 * tidak bisa dipanggil tanpa sesi ADMIN.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession, isAdminSession } from "@/lib/session";
import { classifyFeeDbError } from "@/core/services/feeRekapService";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** UUID yang mustahil ada — filter delete-all yang selalu benar. */
const NEVER_ID = "00000000-0000-0000-0000-000000000000";

async function deleteAll(
  admin: SupabaseClient,
  table: string
): Promise<number> {
  const { data, error } = await admin
    .from(table)
    .delete()
    .neq("id", NEVER_ID)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json(
      { error: "Hanya ADMIN yang boleh menghapus seluruh data fee" },
      { status: 403 }
    );
  }
  try {
    const admin = getSupabaseAdmin();
    // Urutan: details → profiles → legacy (anak dulu, lalu induk).
    const details = await deleteAll(admin, "loket_transaction_details");
    const profiles = await deleteAll(admin, "loket_profiles");
    const feeLoket = await deleteAll(admin, "fee_loket");
    return NextResponse.json({
      success: true,
      deleted: { details, profiles, feeLoket },
    });
  } catch (e) {
    const classified = classifyFeeDbError(
      e as { code?: unknown; message?: unknown },
      "loket_profiles",
      e instanceof Error ? e.message : "Gagal menghapus seluruh data fee"
    );
    return NextResponse.json(
      { error: classified.message, code: classified.code },
      { status: classified.status }
    );
  }
}
