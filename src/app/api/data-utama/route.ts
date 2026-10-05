/**
 * GET /api/data-utama — daftar data_lengkap_utama via service_role.
 * Butuh login (semua role). Query: q (alias: search), regional,
 * page, pageSize. Pengganti query browser langsung (anon key) yang
 * kini ditolak RLS (20261006000000_pii_rls_lockdown.sql).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  classifySupabaseError,
  getDataUtamaList,
  MAX_PAGE_SIZE,
} from "@/core/services/dataUtamaService";

export const dynamic = "force-dynamic";

function toPositiveInt(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? params.get("search") ?? "").trim();
  if (q.length > 100) {
    return NextResponse.json(
      { error: "Kata kunci terlalu panjang (maksimal 100 karakter)" },
      { status: 400 }
    );
  }
  const regional = (params.get("regional") ?? "").trim();
  if (regional.length > 100) {
    return NextResponse.json(
      { error: "Filter regional terlalu panjang" },
      { status: 400 }
    );
  }
  const page = toPositiveInt(params.get("page"), 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    toPositiveInt(params.get("pageSize"), 50)
  );
  try {
    const result = await getDataUtamaList(getSupabaseAdmin(), {
      search: q,
      regional,
      page,
      pageSize,
    });
    return NextResponse.json(result);
  } catch (e) {
    const classified = classifySupabaseError(e as { code?: unknown });
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Gagal memuat data",
        code: classified.code || undefined,
      },
      { status: 500 }
    );
  }
}
