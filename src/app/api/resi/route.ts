/**
 * /api/resi — monitoring resi (butuh login, semua role).
 * GET: daftar + filter status/search/paginasi.
 * PATCH: tandai follow-up {id, catatan} (user dari sesi).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  getResiList,
  updateFollowUpStatus,
  type ResiFollowUpFilter,
} from "@/core/services/resiService";

const VALID_STATUS: ResiFollowUpFilter[] = ["semua", "belum", "sudah"];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  try {
    const params = new URL(req.url).searchParams;
    const rawStatus = (params.get("status") ?? "semua").toLowerCase();
    const status: ResiFollowUpFilter = VALID_STATUS.includes(
      rawStatus as ResiFollowUpFilter
    )
      ? (rawStatus as ResiFollowUpFilter)
      : "semua";
    const result = await getResiList(getSupabaseAdmin(), {
      status,
      search: params.get("q") ?? "",
      page: Number(params.get("page") ?? 1),
      pageSize: Number(params.get("pageSize") ?? 20),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal memuat resi" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { id, catatan } = body as { id?: unknown; catatan?: unknown };
  if (typeof id !== "number" || !Number.isInteger(id)) {
    return NextResponse.json({ error: "ID resi tidak valid" }, { status: 400 });
  }
  if (catatan !== undefined && typeof catatan !== "string") {
    return NextResponse.json({ error: "Catatan tidak valid" }, { status: 400 });
  }
  if (typeof catatan === "string" && catatan.length > 2000) {
    return NextResponse.json({ error: "Catatan terlalu panjang" }, { status: 400 });
  }
  try {
    const updated = await updateFollowUpStatus(getSupabaseAdmin(), {
      id,
      status: "SUDAH_FOLLOWUP",
      catatan: typeof catatan === "string" ? catatan : "",
      userName: session.name,
    });
    return NextResponse.json({ success: true, resi: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal menyimpan follow-up" },
      { status: 500 }
    );
  }
}
