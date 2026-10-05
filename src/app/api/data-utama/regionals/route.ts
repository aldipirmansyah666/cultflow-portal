/**
 * GET /api/data-utama/regionals — opsi regional unik via service_role.
 * Butuh login (semua role). Pengganti query browser langsung (anon key)
 * yang kini ditolak RLS (20261006000000_pii_rls_lockdown.sql).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { getRegionalOptions } from "@/core/services/dataUtamaService";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  try {
    const regionals = await getRegionalOptions(getSupabaseAdmin());
    return NextResponse.json({ regionals });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal memuat regional" },
      { status: 500 }
    );
  }
}
