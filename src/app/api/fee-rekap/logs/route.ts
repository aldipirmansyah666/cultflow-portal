/**
 * GET /api/fee-rekap/logs — riwayat upload dari `public.fee_upload_logs`.
 * Butuh login (semua role). 100 entri terbaru.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { classifyFeeDbError, toUploadLog } from "@/core/services/feeRekapService";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("fee_upload_logs")
      .select("id,tanggal_upload,nama_file,jumlah_baris,periode,diunggah_oleh")
      .order("tanggal_upload", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ logs: (data ?? []).map(toUploadLog) });
  } catch (e) {
    const classified = classifyFeeDbError(
      e as { code?: unknown; message?: unknown },
      "fee_upload_logs",
      e instanceof Error ? e.message : "Gagal memuat riwayat"
    );
    return NextResponse.json(
      { error: classified.message, code: classified.code },
      { status: classified.status }
    );
  }
}
