/**
 * GET /api/data-utama/suggest — saran PPID/nama via service_role.
 * Butuh login (semua role). Query: q, limit (default 8, maks 20).
 * Query kosong/pendek → { items: [] } (200, bukan error) agar
 * debounce ketikan di UI tidak memicu status error.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { suggestAgen } from "@/core/services/dataUtamaService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (q === "" || q.length > 100) {
    return NextResponse.json({ items: [] });
  }
  const rawLimit = Number(params.get("limit") ?? 8);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
    : 8;
  try {
    const items = await suggestAgen(getSupabaseAdmin(), q, limit);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Saran gagal dimuat" },
      { status: 500 }
    );
  }
}
