/**
 * GET /api/fee-rekap/lookup — Lookup Profil Agen meniru sheet `Cari`.
 * Butuh login (semua role). Query: q (PPID/nama, wajib), periode (opsional).
 *
 * Alur persis sheet `Cari`:
 *  1. Normalisasi PPID (buang spasi/invisible, UPPER) lalu cocok persis
 *     (`eq`) ke `loket_profiles` — cepat via indeks ppid.
 *  2. Fallback substring (`ilike`) PPID / nama loket bila tak ada yang persis.
 *  2b. Fallback hyphen-insensitive (fuzzy `%`-recall + seleksi presisi JS).
 *  3. Ambil rincian modul dari `loket_transaction_details`
 *     (MODUL | LEMBAR | FEE/LEMBAR | TOTAL) untuk ppid+periode terpilih.
 *  4. Fallback legacy `fee_loket` bila tabel baru belum dimigrasi/kosong
 *     (profil ringkas tanpa rincian, flag `legacy: true`).
 * 404 bila tidak ditemukan di mana pun.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  canonicalFeeSearch,
  canonicalizePeriode,
  classifyFeeDbError,
  exactPpidCandidates,
  normalizePpid,
  ppidFuzzyPattern,
  ppidSearchKey,
  type LoketProfilDbRow,
} from "@/core/services/feeRekapService";

export const dynamic = "force-dynamic";

/**
 * Kolom profil Master yang dibaca eksplisit (TANPA select('*')):
 * identitas + seluruh nominal slip `Cari`. Kolom yang belum dimigrasi
 * melempar error → 503 MIGRATION_MISSING yang actionable, bukan Rp 0 diam.
 */
const PROFIL_COLUMNS =
  "ppid,nama_loket,bank,no_rekening,nama_pemilik,rekomender,elektrik_area,periode,fee_bulan_ini,fee_bulan_sebelumnya,subsidi_antar_loket,total_fee,minus,hold,potongan_lainnya,potongan_ongkir,total_fee_transfer,fee_ke_deposit,fee_transfer_rekening,sisa_fee,keterangan,tanggal_transfer,fee_siap_transfer,status_pembayaran";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const rawQ = (params.get("q") ?? "").trim();
  if (rawQ === "") {
    return NextResponse.json(
      { error: "Parameter q (PPID/nama) wajib diisi" },
      { status: 400 }
    );
  }
  const periodeParam = (params.get("periode") ?? "").trim();
  const periode =
    periodeParam !== "" && periodeParam.toUpperCase() !== "SEMUA"
      ? canonicalizePeriode(periodeParam)
      : "";
  if (periodeParam !== "" && periodeParam.toUpperCase() !== "SEMUA" && periode === "") {
    return NextResponse.json(
      { error: "periode harus format YYYY-MM atau YYYY-MM-T1..T3" },
      { status: 400 }
    );
  }
  const { ppid: qPpid, nama: qNama } = canonicalFeeSearch(rawQ);
  const exactPpid = normalizePpid(rawQ);

  try {
    const admin = getSupabaseAdmin();

    // 1) Cocok persis PPID ternormalisasi (jalur cepat + akurat).
    // Kedua varian hyphen (dengan/tanpa "-") via .in() agar tak bergantung
    // posisi dalam recall fuzzy + jendela limit.
    const exactCandidates = exactPpidCandidates(rawQ);
    if (exactCandidates.length > 0) {
      let query = admin
        .from("loket_profiles")
        .select(
          PROFIL_COLUMNS
        )
        .in("ppid", exactCandidates);
      if (periode !== "") query = query.eq("periode", periode);
      const { data, error } = await query
        .order("periode", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = (data ?? []) as LoketProfilDbRow[];
      if (rows.length > 0) {
        const picked = rows[0] as LoketProfilDbRow;
        const { data: det, error: detError } = await admin
          .from("loket_transaction_details")
          .select("modul_nama,jumlah_lembar,fee_per_lembar,total_fee")
          .eq("ppid", String(picked.ppid ?? ""))
          .eq("periode", String(picked.periode ?? ""))
          .order("total_fee", { ascending: false })
          .limit(200);
        if (detError) throw detError;
        return NextResponse.json({
          found: true,
          profile: picked,
          details: det ?? [],
          legacy: false,
        });
      }
    }

    // 2) Fallback substring PPID / nama loket (abaikan case) +
    // selalu sertakan pola hyphen-insensitive (ilike): ilike persis
    // gagal bila salah satu sisi memakai "-" (query tanpa hubung vs
    // DB berhubung atau sebaliknya).
    const ors: string[] = [];
    if (qPpid !== "") ors.push(`ppid.ilike.%${qPpid}%`);
    if (qNama !== "") ors.push(`nama_loket.ilike.%${qNama}%`);
    const subFuzzy = ppidFuzzyPattern(rawQ);
    if (subFuzzy !== null) ors.push(`ppid.ilike.${subFuzzy}`);
    if (ors.length > 0) {
      let query = admin
        .from("loket_profiles")
        .select(
          PROFIL_COLUMNS
        )
        .or(ors.join(","));
      if (periode !== "") query = query.eq("periode", periode);
      const { data, error } = await query
        .order("periode", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = (data ?? []) as LoketProfilDbRow[];
      // Prioritaskan kecocokan presisi: hyphen-insensitive dulu
      // ("SBPOS-CKM-001" == "SBPOSCKM001"), lalu persis dinormalisasi.
      const keyFreeSub = ppidSearchKey(rawQ);
      const exact =
        exactPpid !== ""
          ? (rows.find((r) => ppidSearchKey(r.ppid) === keyFreeSub) ??
            rows.find((r) => normalizePpid(r.ppid) === exactPpid))
          : undefined;
      const picked = exact ?? rows[0];
      if (picked) {
        const { data: det, error: detError } = await admin
          .from("loket_transaction_details")
          .select("modul_nama,jumlah_lembar,fee_per_lembar,total_fee")
          .eq("ppid", String(picked.ppid ?? ""))
          .eq("periode", String(picked.periode ?? ""))
          .order("total_fee", { ascending: false })
          .limit(200);
        if (detError) throw detError;
        return NextResponse.json({
          found: true,
          profile: picked,
          details: det ?? [],
          legacy: false,
        });
      }
    }

    // 2b) Fallback hyphen-insensitive: pola fuzzy (karakter dihubungkan
    // %) untuk recall (ilike agar case-insensitive), lalu JS memilih
    // presisi (ppidSearchKey equality > substring). Dibatasi 20 kandidat.
    // Dijalankan SELALU saat substring tak cocok (bukan hanya bila query
    // berhubung): query tanpa hubung vs DB berhubung gagal di semua
    // tahap sebelumnya.
    const keyFree = ppidSearchKey(rawQ);
    const fuzzy = ppidFuzzyPattern(rawQ);
    if (keyFree !== "" && fuzzy !== null) {
      let query = admin
        .from("loket_profiles")
        .select(
          PROFIL_COLUMNS
        )
        .ilike("ppid", fuzzy);
      if (periode !== "") query = query.eq("periode", periode);
      const { data, error } = await query
        .order("periode", { ascending: false })
        .limit(20);
      if (error) throw error;
      const rows = (data ?? []) as LoketProfilDbRow[];
      const exact =
        rows.find((r) => ppidSearchKey(r.ppid) === keyFree) ??
        rows.find((r) => ppidSearchKey(r.ppid).includes(keyFree));
      if (exact) {
        const { data: det, error: detError } = await admin
          .from("loket_transaction_details")
          .select("modul_nama,jumlah_lembar,fee_per_lembar,total_fee")
          .eq("ppid", String(exact.ppid ?? ""))
          .eq("periode", String(exact.periode ?? ""))
          .order("total_fee", { ascending: false })
          .limit(200);
        if (detError) throw detError;
        return NextResponse.json({
          found: true,
          profile: exact,
          details: det ?? [],
          legacy: false,
        });
      }
    }

    // 3) Fallback legacy fee_loket (data lama tanpa profil Master).
    const legacyOrs: string[] = [];
    if (qPpid !== "") legacyOrs.push(`ppid.ilike.%${qPpid}%`);
    if (qNama !== "") legacyOrs.push(`nama_loket.ilike.%${qNama}%`);
    const legacyFuzzy = ppidFuzzyPattern(rawQ);
    if (legacyFuzzy !== null) legacyOrs.push(`ppid.ilike.${legacyFuzzy}`);
    if (legacyOrs.length > 0) {
      let query = admin
        .from("fee_loket")
        .select("ppid,nama_loket,periode,total_fee,status")
        .or(legacyOrs.join(","));
      if (periode !== "") query = query.eq("periode", periode);
      const { data, error } = await query
        .order("periode", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = (data ?? []) as {
        ppid: unknown;
        nama_loket: unknown;
        periode: unknown;
        total_fee: unknown;
        status: unknown;
      }[];
      const keyFreeSubLegacy = ppidSearchKey(rawQ);
      const exact =
        exactPpid !== ""
          ? (rows.find((r) => ppidSearchKey(r.ppid) === keyFreeSubLegacy) ??
            rows.find((r) => normalizePpid(r.ppid) === exactPpid))
          : undefined;
      const picked = exact ?? rows[0];
      if (picked) {
        return NextResponse.json({
          found: true,
          profile: {
            ppid: String(picked.ppid ?? ""),
            nama_loket: String(picked.nama_loket ?? ""),
            bank: "",
            no_rekening: "",
            nama_pemilik: "",
            rekomender: "",
            elektrik_area: "",
            periode: String(picked.periode ?? ""),
            fee_bulan_ini: picked.total_fee ?? 0,
            fee_bulan_sebelumnya: 0,
            subsidi_antar_loket: 0,
            total_fee: picked.total_fee ?? 0,
            minus: 0,
            hold: 0,
            potongan_lainnya: 0,
            potongan_ongkir: 0,
            total_fee_transfer: picked.total_fee ?? 0,
            fee_ke_deposit: 0,
            fee_transfer_rekening: 0,
            sisa_fee: 0,
            keterangan: "",
            tanggal_transfer: "",
            fee_siap_transfer: picked.total_fee ?? 0,
            status_pembayaran: String(picked.status ?? "PENDING"),
          },
          details: [],
          legacy: true,
        });
      }
    }

    return NextResponse.json(
      { found: false, error: `PPID/nama "${rawQ}" tidak ditemukan` },
      { status: 404 }
    );
  } catch (e) {
    const classified = classifyFeeDbError(
      e as { code?: unknown; message?: unknown },
      "loket_profiles",
      e instanceof Error ? e.message : "Lookup loket gagal"
    );
    return NextResponse.json(
      { error: classified.message, code: classified.code },
      { status: classified.status }
    );
  }
}
