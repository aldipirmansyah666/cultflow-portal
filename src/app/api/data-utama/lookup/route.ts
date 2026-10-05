/**
 * GET /api/data-utama/lookup — profil agen (PPID persis lalu fuzzy)
 * via service_role. Butuh login (semua role). Query: q (wajib).
 * 404 + { found: false } bila tidak cocok. Dipakai /lookup-agen
 * dan /bagging (lookup no HP) — pengganti query browser langsung
 * yang kini ditolak RLS (20261006000000_pii_rls_lockdown.sql).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  lookupAgenByPpid,
  toAgenProfile,
} from "@/core/services/dataUtamaService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q === "") {
    return NextResponse.json(
      { error: "Parameter q (PPID/nama) wajib diisi" },
      { status: 400 }
    );
  }
  if (q.length > 100) {
    return NextResponse.json(
      { error: "Parameter q terlalu panjang (maksimal 100 karakter)" },
      { status: 400 }
    );
  }
  try {
    const row = await lookupAgenByPpid(getSupabaseAdmin(), q);
    if (!row) {
      return NextResponse.json(
        { found: false, error: `PPID/nama "${q}" tidak ditemukan` },
        { status: 404 }
      );
    }
    return NextResponse.json({ found: true, profile: toAgenProfile(row) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lookup gagal" },
      { status: 500 }
    );
  }
}
