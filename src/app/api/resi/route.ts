/**
 * /api/resi — monitoring resi (butuh login, semua role).
 * GET: daftar + filter status/search/paginasi.
 * PATCH: tandai follow-up {id, catatan} (user dari sesi).
 * POST: batch import copas {rows: ResiCopasItem[]} (maks 500).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  deleteResiBatch,
  getResiList,
  importResiBatch,
  normalizeFilterDate,
  normalizeFollowUpStatus,
  purgeExpiredResi,
  RESI_COPAS_MAX_ROWS,
  RESI_STATUS_CHOICES,
  sanitizeNomorResi,
  updateFollowUpStatus,
  updateResiStatus,
  type ResiCopasItem,
  type ResiFollowUpFilter,
} from "@/core/services/resiService";

const VALID_STATUS: ResiFollowUpFilter[] = ["semua", "belum", "sudah", "selesai"];

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
    let startDate: string | undefined;
    let endDate: string | undefined;
    try {
      startDate = normalizeFilterDate(params.get("startDate") ?? "") ?? undefined;
      endDate = normalizeFilterDate(params.get("endDate") ?? "") ?? undefined;
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Tanggal tidak valid" },
        { status: 400 }
      );
    }
    if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
      return NextResponse.json(
        { error: "Rentang tanggal tidak valid (mulai > selesai)" },
        { status: 400 }
      );
    }
    const admin = getSupabaseAdmin();
    // Pembersihan otomatis resi tertutup >2 hari (fire-and-forget,
    // mengikuti pola proyek lama — tidak menggagalkan list bila error).
    purgeExpiredResi(admin).catch((e: unknown) => {
      console.error(
        "[api/resi] auto-purge:",
        e instanceof Error ? e.message : e
      );
    });
    const result = await getResiList(admin, {
      status,
      search: params.get("q") ?? "",
      page: Number(params.get("page") ?? 1),
      pageSize: Number(params.get("pageSize") ?? 50),
      startDate,
      endDate,
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
  const { id, catatan, status } = body as {
    id?: unknown;
    catatan?: unknown;
    status?: unknown;
  };
  if (typeof id !== "number" || !Number.isInteger(id)) {
    return NextResponse.json({ error: "ID resi tidak valid" }, { status: 400 });
  }
  if (catatan !== undefined && typeof catatan !== "string") {
    return NextResponse.json({ error: "Catatan tidak valid" }, { status: 400 });
  }
  if (typeof catatan === "string" && catatan.length > 2000) {
    return NextResponse.json({ error: "Catatan terlalu panjang" }, { status: 400 });
  }
  const note = typeof catatan === "string" ? catatan : "";
  // Jalur baru: update status interaktif (dropdown tabel).
  if (status !== undefined) {
    if (typeof status !== "string") {
      return NextResponse.json({ error: "Status tidak valid" }, { status: 400 });
    }
    const choice = status.trim().toUpperCase();
    if (!(RESI_STATUS_CHOICES as string[]).includes(choice)) {
      return NextResponse.json(
        { error: `Status tidak valid (harus ${RESI_STATUS_CHOICES.join("/")})` },
        { status: 400 }
      );
    }
    if (choice === "SELESAI" && note.trim() === "") {
      return NextResponse.json(
        { error: "Catatan wajib diisi untuk status SELESAI" },
        { status: 400 }
      );
    }
    try {
      const updated = await updateResiStatus(getSupabaseAdmin(), {
        id,
        status: choice,
        catatan: note,
        userName: session.name,
      });
      return NextResponse.json({ success: true, resi: updated });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Gagal memperbarui status" },
        { status: 500 }
      );
    }
  }
  try {
    const updated = await updateFollowUpStatus(getSupabaseAdmin(), {
      id,
      status: "SUDAH_FOLLOWUP",
      catatan: note,
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

export async function DELETE(req: Request) {
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
  const { id, ids } = body as { id?: unknown; ids?: unknown };
  const list: number[] = [];
  if (id !== undefined) {
    if (typeof id !== "number" || !Number.isInteger(id)) {
      return NextResponse.json({ error: "ID resi tidak valid" }, { status: 400 });
    }
    list.push(id);
  }
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids harus array tak-kosong" }, { status: 400 });
    }
    for (const v of ids) {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        return NextResponse.json({ error: "ids memuat ID tidak valid" }, { status: 400 });
      }
      list.push(v);
    }
  }
  if (list.length === 0) {
    return NextResponse.json({ error: "ID/ids wajib diisi" }, { status: 400 });
  }
  try {
    const result = await deleteResiBatch(getSupabaseAdmin(), list);
    return NextResponse.json({ success: true, deleted: result.deleted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal menghapus resi" },
      { status: 500 }
    );
  }
}

function cleanStr(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "" || t.length > max) return null;
  return t;
}

/** Validasi satu baris copas dari client sebelum upsert. */
function toCopasItem(raw: unknown): ResiCopasItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // Sanitasi nomor resi (trim + NBSP/tak kasatmata + uppercase) sebelum cek.
  const noResi = sanitizeNomorResi(r.no_resi);
  if (!noResi || noResi.length > 50) return null;
  let statusFollowup: ResiCopasItem["status_followup"];
  try {
    statusFollowup = normalizeFollowUpStatus(String(r.status_followup ?? "BELUM_FOLLOWUP"));
  } catch {
    return null;
  }
  const tglRaw = r.tgl_tiket;
  const tglTiket =
    tglRaw === null || tglRaw === undefined
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(String(tglRaw).trim())
        ? String(tglRaw).trim()
        : null;
  if (tglRaw !== null && tglRaw !== undefined && tglTiket === null) return null;
  const isSelesai = r.is_selesai;
  if (isSelesai !== null && isSelesai !== undefined && isSelesai !== "SELESAI") {
    return null;
  }
  return {
    tgl_tiket: tglTiket,
    no_resi: noResi,
    agen: cleanStr(r.agen, 120) ?? "-",
    kode_layanan: cleanStr(r.kode_layanan, 30) ?? "PE",
    petugas: cleanStr(r.petugas, 120) ?? "ADMIN",
    status_resi: cleanStr(r.status_resi, 40)?.toUpperCase() ?? "PERJALANAN",
    status_followup: statusFollowup,
    is_selesai: isSelesai === "SELESAI" ? "SELESAI" : null,
  };
}

export async function POST(req: Request) {
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
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows harus array tak-kosong" }, { status: 400 });
  }
  if (rows.length > RESI_COPAS_MAX_ROWS) {
    return NextResponse.json(
      { error: `Maksimal ${RESI_COPAS_MAX_ROWS} baris per import` },
      { status: 400 }
    );
  }
  const items: ResiCopasItem[] = [];
  for (const raw of rows) {
    const item = toCopasItem(raw);
    if (!item) {
      return NextResponse.json(
        { error: "Ada baris tidak valid (no_resi/status/tanggal)" },
        { status: 400 }
      );
    }
    items.push(item);
  }
  try {
    const result = await importResiBatch(getSupabaseAdmin(), items);
    return NextResponse.json({
      success: true,
      inserted: result.inserted,
      updated: result.updated,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal mengimpor resi" },
      { status: 500 }
    );
  }
}
