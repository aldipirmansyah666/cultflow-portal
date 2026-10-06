/**
 * GET /api/fee-rekap — daftar fee loket (sumber kebenaran Master).
 * Butuh login (semua role). Query: q, periode, page, pageSize.
 * Mengembalikan baris + daftar periode + ringkasan untuk stat cards.
 *
 * Sumber data: `loket_profiles` DULU (kolom nominal eksplisit:
 * fee_bulan_ini, total_fee, fee_siap_transfer, ...) — inilah perbaikan
 * bug "Total Fee Rp 0": query lama hanya membaca `fee_loket` yang
 * tidak memuat kolom Master. Bila tabel profil belum dimigrasi/kosong,
 * fallback ke `fee_loket` (legacy) dengan perilaku lama.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession, isAdminSession } from "@/lib/session";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalFeeSearch,
  classifyFeeDbError,
  isPaidStatus,
  normalizeDeleteIds,
  parseAmount,
  ppidFuzzyPattern,
  toFeeRekapRow,
} from "@/core/services/feeRekapService";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 1000;
/**
 * Batas halaman MAKSIMAL = 1000 — SELARAS dengan `max_rows = 1000`
 * PostgREST (supabase/config.toml:18; default hosting sama). Respons di
 * atas itu DIPOTONG DIAM-DIAM oleh server (tanpa error), sehingga
 * pageSize lebih besar membuat baris >1000 tak terjangkau + matematika
 * halaman klien kacau. Jangan naikkan tanpa menaikkan max_rows dulu.
 */
const MAX_PAGE_SIZE = 1000;
/** Batch baca fallback paginasi (agregasi lengkap tanpa batas 5000). */
const SUMMARY_FALLBACK_BATCH = 1000;

interface FeeSummary {
  periods: string[];
  latestPeriode: string;
  totalLoket: number;
  totalTerbayarAktif: number;
}

/**
 * Koersi integer aman untuk angka keuangan.
 * `parseAmount` melakukan finite-check eksplisit + Math.round untuk
 * Number/bigint/string ("1500000" bigint PostgREST, "Rp 1.500.000"),
 * dan 0 hanya untuk kosong/tak-valid — TANPA pola `Number(x) || 0`
 * yang melewatkan float tanpa pembulatan dan menelan NaN diam-diam.
 * (Penjumlahan rupiah dalam integer aman hingga Number.MAX_SAFE_INTEGER;
 * total fee loket realistis < 1e13 sehingga presisi terjaga.)
 */
function toSafeRupiah(value: unknown): number {
  return parseAmount(value);
}

/**
 * Ringkasan via agregasi SQL langsung (`fee_rekap_summary()`:
 * DISTINCT periode, COUNT(DISTINCT ppid), SUM(total_fee) — lihat migration
 * 20260925000000). Null bila RPC gagal (mis. fungsi belum dimigrasi)
 * agar pemanggil jatuh ke fallback paginasi.
 */
async function loadSummaryViaRpc(
  admin: SupabaseClient
): Promise<{ summary: FeeSummary } | null> {
  const { data, error } = await admin.rpc("fee_rekap_summary");
  if (error || data === null || typeof data !== "object") return null;
  const s = data as {
    periods?: unknown;
    latestPeriode?: unknown;
    totalLoket?: unknown;
    totalTerbayarAktif?: unknown;
  };
  const periods = (Array.isArray(s.periods) ? s.periods : [])
    .map((p) => String(p ?? ""))
    .filter((p) => p !== "")
    .sort((a, b) => b.localeCompare(a));
  const latestPeriode =
    typeof s.latestPeriode === "string" ? s.latestPeriode : "";
  return {
    summary: {
      periods,
      latestPeriode,
      totalLoket: toSafeRupiah(s.totalLoket),
      totalTerbayarAktif: toSafeRupiah(s.totalTerbayarAktif),
    },
  };
}

/**
 * Ringkasan Master via agregasi SQL (`loket_profiles_summary()`:
 * DISTINCT periode, COUNT(DISTINCT ppid), SUM(total_fee) status terbayar —
 * lihat migration 20261007000000). Null bila RPC gagal (mis. fungsi belum
 * dimigrasi) agar pemanggil jatuh ke fallback paginasi.
 * Status terbayar mengikuti isPaidStatus(): TERBAYAR/KE_DEPOSIT/
 * TRANSFER_REKENING/TOPUP_SISA — konsisten dengan agregasi JS.
 */
async function loadProfilesSummaryViaRpc(
  admin: SupabaseClient
): Promise<{ summary: FeeSummary } | null> {
  const { data, error } = await admin.rpc("loket_profiles_summary");
  if (error || data === null || typeof data !== "object") return null;
  const s = data as {
    periods?: unknown;
    latestPeriode?: unknown;
    totalLoket?: unknown;
    totalTerbayarAktif?: unknown;
  };
  const periods = (Array.isArray(s.periods) ? s.periods : [])
    .map((p) => String(p ?? ""))
    .filter((p) => p !== "")
    .sort((a, b) => b.localeCompare(a));
  const latestPeriode =
    typeof s.latestPeriode === "string" ? s.latestPeriode : "";
  return {
    summary: {
      periods,
      latestPeriode,
      totalLoket: toSafeRupiah(s.totalLoket),
      totalTerbayarAktif: toSafeRupiah(s.totalTerbayarAktif),
    },
  };
}

/**
 * Fallback bila RPC belum tersedia: agregasi lengkap via paginasi
 * `.range()` (tanpa `.limit(5000)` yang memotong diam-diam).
 * Melempar error DB asli agar diklasifikasi pemanggil.
 */
async function loadSummaryFallback(admin: SupabaseClient): Promise<FeeSummary> {
  const periodSet = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("fee_loket")
      .select("periode")
      .range(offset, offset + SUMMARY_FALLBACK_BATCH - 1);
    if (error) throw error;
    const rows = (data ?? []) as { periode: unknown }[];
    for (const r of rows) {
      const p = String(r.periode ?? "");
      if (p !== "") periodSet.add(p);
    }
    if (rows.length < SUMMARY_FALLBACK_BATCH) break;
    offset += SUMMARY_FALLBACK_BATCH;
  }
  const periods = [...periodSet].sort((a, b) => b.localeCompare(a));
  const latest = periods[0] ?? "";

  let totalLoket = 0;
  let totalTerbayarAktif = 0;
  if (latest !== "") {
    const loketSet = new Set<string>();
    let sum = 0;
    offset = 0;
    for (;;) {
      const { data, error } = await admin
        .from("fee_loket")
        .select("ppid,total_fee,status")
        .eq("periode", latest)
        .range(offset, offset + SUMMARY_FALLBACK_BATCH - 1);
      if (error) throw error;
      const rows = (data ?? []) as {
        ppid: unknown;
        total_fee: unknown;
        status: unknown;
      }[];
      for (const r of rows) {
        const ppid = String(r.ppid ?? "");
        if (ppid !== "") loketSet.add(ppid);
        if (String(r.status ?? "").trim().toUpperCase() === "TERBAYAR") {
          sum += toSafeRupiah(r.total_fee);
        }
      }
      if (rows.length < SUMMARY_FALLBACK_BATCH) break;
      offset += SUMMARY_FALLBACK_BATCH;
    }
    totalLoket = loketSet.size;
    totalTerbayarAktif = sum;
  }
  return { periods, latestPeriode: latest, totalLoket, totalTerbayarAktif };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  try {
    const params = new URL(req.url).searchParams;
    // Pola ganda: PPID dikanonisasi persis seperti saat simpan
    // (`normalizePpid`) sehingga cocok dengan isi DB; nama memakai
    // sanitasi longgar agar substring alami tetap ketemu.
    const { ppid: qPpid, nama: qNama } = canonicalFeeSearch(
      params.get("q") ?? ""
    );
    const rawQ = (params.get("q") ?? "").trim();
    const periode = (params.get("periode") ?? "").trim();
    const page = Math.max(1, Math.floor(Number(params.get("page") ?? 1) || 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(Number(params.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))
    );

    const admin = getSupabaseAdmin();
    // Jalur Master dulu; fallback legacy bila tabel profil belum
    // dimigrasi (MIGRATION_MISSING) atau kosong (data lama di fee_loket
    // tetap tampil hingga re-import Master selesai).
    try {
      const master = await queryProfiles(admin, {
        qPpid,
        qNama,
        rawQ,
        periode,
        page,
        pageSize,
      });
      if (master) {
        return NextResponse.json(master);
      }
    } catch (e) {
      const c = classifyFeeDbError(
        e as { code?: unknown; message?: unknown },
        "loket_profiles",
        ""
      );
      if (c.code !== "MIGRATION_MISSING") throw e;
    }
    return NextResponse.json(
      await queryLegacy(admin, { qPpid, qNama, rawQ, periode, page, pageSize })
    );
  } catch (e) {
    // 500 generik (mis. tabel belum dimigrasi) dipetakan menjadi pesan
    // JSON yang jelas + code mesin (MIGRATION_MISSING → 503).
    const classified = classifyFeeDbError(
      e as { code?: unknown; message?: unknown },
      "loket_profiles",
      e instanceof Error ? e.message : "Gagal memuat fee"
    );
    return NextResponse.json(
      { error: classified.message, code: classified.code },
      { status: classified.status }
    );
  }
}

/**
 * Kolom nominal Master yang dibaca eksplisit (TANPA select('*')) agar
 * salah pemetaan kolom langsung terlihat sebagai error, bukan Rp 0 diam.
 */
const PROFIL_COLUMNS =
  "id,ppid,nama_loket,bank,no_rekening,nama_pemilik,rekomender,elektrik_area,periode,fee_bulan_ini,fee_bulan_sebelumnya,subsidi_antar_loket,total_fee,minus,hold,potongan_lainnya,potongan_ongkir,total_fee_transfer,fee_ke_deposit,fee_transfer_rekening,sisa_fee,keterangan,tanggal_transfer,fee_siap_transfer,status_pembayaran,updated_at";

/** Status yang dihitung "terbayar" pada agregasi ringkasan Master. */
interface ProfilQuery {
  qPpid: string;
  qNama: string;
  rawQ: string;
  periode: string;
  page: number;
  pageSize: number;
}

interface ProfilListResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  truncated: boolean;
  summarySource: string;
  periods: string[];
  summary: { totalLoket: number; totalTerbayarAktif: number; latestPeriode: string };
}

/** Bangun kondisi OR pencarian (persis + substring + fuzzy hyphen). */
function profilOrs(qPpid: string, qNama: string, rawQ: string): string[] {
  const ors: string[] = [];
  if (qPpid !== "") ors.push(`ppid.ilike.%${qPpid}%`);
  if (qNama !== "") ors.push(`nama_loket.ilike.%${qNama}%`);
  // Selalu sertakan pola hyphen-insensitive (ilike, bukan like):
  // ilike persis gagal bila salah satu sisi memakai "-" (query tanpa
  // hubung vs DB berhubung atau sebaliknya). Recall luas, presisi
  // dipilih di JS.
  const fuzzy = ppidFuzzyPattern(rawQ);
  if (fuzzy !== null) {
    ors.push(`ppid.ilike.${fuzzy}`);
  }
  return ors;
}

/**
 * Query `loket_profiles`. Melempar error DB asli bila tabel/kolom belum
 * dimigrasi (pemanggil membedakan MIGRATION_MISSING → fallback legacy).
 * Return null bila tabel ADA tetapi kosong — pemanggil lanjut legacy agar
 * data lama tetap tampil hingga re-import Master selesai.
 */
async function queryProfiles(
  admin: SupabaseClient,
  q: ProfilQuery
): Promise<ProfilListResult | null> {
  const ors = profilOrs(q.qPpid, q.qNama, q.rawQ);
  let query = admin.from("loket_profiles").select(PROFIL_COLUMNS, {
    count: "exact",
  });
  if (q.periode !== "" && q.periode !== "SEMUA") {
    query = query.eq("periode", q.periode);
  }
  if (ors.length > 0) query = query.or(ors.join(","));
  // Satu query list + count exact: total 0 = tabel kosong → fallback
  // legacy (hemat scan ringkasan yang sia-sia).
  const from = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query
    .order("periode", { ascending: false })
    .order("ppid", { ascending: true })
    .range(from, from + q.pageSize - 1);
  if (error) throw error;
  const total = Math.max(0, count ?? 0);
  if (total === 0) return null;
  const rows = data ?? [];
  // Ringkasan SELALU lengkap: agregasi SQL via RPC dulu (1 round-trip),
  // fallback paginasi penuh bila fungsi belum dimigrasi. Tidak ada lagi
  // full-table scan PostgREST di setiap request bila RPC tersedia.
  const viaRpc = await loadProfilesSummaryViaRpc(admin);
  const summary = viaRpc ? viaRpc.summary : await summarizeProfiles(admin);
  return {
    // Baris mentah snake_case (angka bigint bisa string) — klien memetakan
    // via toFeeRekapRowFromProfil dengan koersi parseAmount per kolom.
    data: rows,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    truncated: from + rows.length < total,
    summarySource: "profiles",
    periods: summary.periods,
    summary: {
      totalLoket: summary.totalLoket,
      totalTerbayarAktif: summary.totalTerbayarAktif,
      latestPeriode: summary.latestPeriode,
    },
  };
}

/**
 * FALLBACK agregasi ringkasan dari `loket_profiles` via paginasi penuh
 * (dipakai bila RPC `loket_profiles_summary` belum dimigrasi):
 * periode unik, terbaru, COUNT(DISTINCT ppid) + SUM(total_fee) status
 * terbayar pada periode terbaru. Melempar error DB asli.
 */
async function summarizeProfiles(admin: SupabaseClient): Promise<FeeSummary> {
  const periodSet = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("loket_profiles")
      .select("periode")
      .range(offset, offset + SUMMARY_FALLBACK_BATCH - 1);
    if (error) throw error;
    const rows = (data ?? []) as { periode: unknown }[];
    for (const r of rows) {
      const p = String(r.periode ?? "");
      if (p !== "") periodSet.add(p);
    }
    if (rows.length < SUMMARY_FALLBACK_BATCH) break;
    offset += SUMMARY_FALLBACK_BATCH;
  }
  const periods = [...periodSet].sort((a, b) => b.localeCompare(a));
  const latest = periods[0] ?? "";
  let totalLoket = 0;
  let totalTerbayarAktif = 0;
  if (latest !== "") {
    const loketSet = new Set<string>();
    let sum = 0;
    offset = 0;
    for (;;) {
      const { data, error } = await admin
        .from("loket_profiles")
        .select("ppid,total_fee,status_pembayaran")
        .eq("periode", latest)
        .range(offset, offset + SUMMARY_FALLBACK_BATCH - 1);
      if (error) throw error;
      const rows = (data ?? []) as {
        ppid: unknown;
        total_fee: unknown;
        status_pembayaran: unknown;
      }[];
      for (const r of rows) {
        const ppid = String(r.ppid ?? "");
        if (ppid !== "") loketSet.add(ppid);
        if (isPaidStatus(String(r.status_pembayaran ?? "").trim().toUpperCase())) {
          sum += toSafeRupiah(r.total_fee);
        }
      }
      if (rows.length < SUMMARY_FALLBACK_BATCH) break;
      offset += SUMMARY_FALLBACK_BATCH;
    }
    totalLoket = loketSet.size;
    totalTerbayarAktif = sum;
  }
  return { periods, latestPeriode: latest, totalLoket, totalTerbayarAktif };
}

/**
 * Jalur legacy `fee_loket` (tabel profil belum dimigrasi/kosong).
 * Perilaku lama dipertahankan 1:1 (paginasi + RPC/fallback ringkasan).
 */
async function queryLegacy(
  admin: SupabaseClient,
  q: { qPpid: string; qNama: string; rawQ: string; periode: string; page: number; pageSize: number }
): Promise<ProfilListResult> {
  let query = admin
    .from("fee_loket")
    .select("id,ppid,nama_loket,periode,total_fee,status,rincian,updated_at", {
      count: "exact",
    });

  if (q.periode !== "" && q.periode !== "SEMUA") {
    query = query.eq("periode", q.periode);
  }
  const ors: string[] = [];
  if (q.qPpid !== "") ors.push(`ppid.ilike.%${q.qPpid}%`);
  if (q.qNama !== "") ors.push(`nama_loket.ilike.%${q.qNama}%`);
  const legacyFuzzy = ppidFuzzyPattern(q.rawQ);
  if (legacyFuzzy !== null) {
    ors.push(`ppid.ilike.${legacyFuzzy}`);
  }
  if (ors.length > 0) {
    query = query.or(ors.join(","));
  }

  const from = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query
    .order("periode", { ascending: false })
    .order("ppid", { ascending: true })
    .range(from, from + q.pageSize - 1);
  if (error) throw error;

  const rows = (data ?? []).map(toFeeRekapRow);
  const total = Math.max(0, count ?? 0);

  // Ringkasan SELALU lengkap: agregasi SQL via RPC dulu, fallback
  // paginasi penuh bila fungsi belum dimigrasi. Tidak ada lagi
  // `.limit(5000)` + reduce JS yang terpotong diam-diam.
  const viaRpc = await loadSummaryViaRpc(admin);
  let summary: FeeSummary;
  let summarySource: "rpc" | "fallback";
  if (viaRpc) {
    summary = viaRpc.summary;
    summarySource = "rpc";
  } else {
    summary = await loadSummaryFallback(admin);
    summarySource = "fallback";
  }

  // Flag pemotongan halaman: true bila masih ada baris di luar halaman
  // ini (klien menampilkan banner peringatan, bukan diam).
  const truncated = from + rows.length < total;

  return {
    data: rows,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    truncated,
    periods: summary.periods,
    summary: {
      totalLoket: summary.totalLoket,
      totalTerbayarAktif: summary.totalTerbayarAktif,
      latestPeriode: summary.latestPeriode,
    },
    summarySource,
  };
}

/**
 * DELETE /api/fee-rekap — hapus baris fee by id (khusus ADMIN).
 * Body: { id: string } atau { ids: string[] } (maks 500/request).
 * Dipakai tombol Hapus per baris + dialog konfirmasi di UI.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json(
      { error: "Hanya ADMIN yang boleh menghapus fee" },
      { status: 403 }
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { id, ids } = body as { id?: unknown; ids?: unknown };
  let list: string[];
  try {
    list = normalizeDeleteIds(
      id !== undefined ? [id, ...(Array.isArray(ids) ? ids : [])] : ids
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ID tidak valid" },
      { status: 400 }
    );
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("fee_loket")
      .delete()
      .in("id", list)
      .select("id");
    if (error) throw error;
    return NextResponse.json({ success: true, deleted: (data ?? []).length });
  } catch (e) {
    const classified = classifyFeeDbError(
      e as { code?: unknown; message?: unknown },
      "fee_loket",
      e instanceof Error ? e.message : "Gagal menghapus fee"
    );
    return NextResponse.json(
      { error: classified.message, code: classified.code },
      { status: classified.status }
    );
  }
}
