/** GET /api/reconcile/prefixes — prefix tambahan aktif untuk validator (semua role login). */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { listActiveProductPrefixes } from "@/core/services/productPrefixService";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  try {
    const prefixes = await listActiveProductPrefixes(getSupabaseAdmin());
    return NextResponse.json(
      { prefixes },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[reconcile/prefixes] gagal membaca master prefix:", e);
    return NextResponse.json(
      { error: "Gagal memuat prefix aktif. Coba lagi." },
      { status: 503 }
    );
  }
}
