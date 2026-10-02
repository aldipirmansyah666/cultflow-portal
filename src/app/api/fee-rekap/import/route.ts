/**
 * POST /api/fee-rekap/import — upsert baris fee ke `public.fee_loket`
 * (khusus ADMIN) + catat `public.fee_upload_logs` pada chunk terakhir.
 *
 * Protokol chunk (perbaikan 413 untuk 10.000+ baris):
 * Body: { rows, fileName, periode: "YYYY-MM", totalRows?, chunk?: {index,total} }.
 * Klien memecah dataset menjadi chunk kecil (lihat IMPORT_CHUNK_SIZE di
 * feeRekapService) dan POST sequential; tiap chunk di-upsert idempotent,
 * log upload HANYA ditulis saat chunk terakhir (atau request tunggal
 * tanpa info chunk = kompatibilitas mundur).
 *
 * CATATAN body-parser: App Router tidak memiliki opsi `bodyParser`
 * (itu Pages Router) dan limit body ditegakkan platform hosting
 * (mis. ±4.5 MB di Vercel). Chunk kecil per request adalah perbaikan
 * yang benar — bukan menaikkan limit. `maxDuration` di bawah memberi
 * waktu eksekusi lebih panjang untuk upsert batch di platform serverless.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession, isAdminSession } from "@/lib/session";
import {
  classifyFeeDbError,
  FEE_PERIODE_REGEX,
  IMPORT_MAX_ROWS_PER_REQUEST,
  normalizeImportProfil,
  toFeeDbRow,
  type FeeDbMappedRow,
  type FeeImportPayloadItem,
  type LoketDetailDbRow,
  type LoketProfileDbRow,
} from "@/core/services/feeRekapService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Alias kompatibilitas untuk payload impor fee per baris. */
export type FeeImportItem = FeeImportPayloadItem;

function cleanStr(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json(
      { error: "Hanya ADMIN yang boleh menyimpan rekap fee" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { rows, fileName, periode, totalRows, chunk } = body as {
    rows?: unknown;
    fileName?: unknown;
    periode?: unknown;
    totalRows?: unknown;
    chunk?: unknown;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows harus array tak-kosong" }, { status: 400 });
  }
  if (rows.length > IMPORT_MAX_ROWS_PER_REQUEST) {
    return NextResponse.json(
      {
        error:
          `Terlalu banyak baris per request (${rows.length}). ` +
          `Kirim sebagai chunk ≤ ${IMPORT_MAX_ROWS_PER_REQUEST} baris ` +
          `dengan { chunk: { index, total } } (lihat saveFeeImport).`,
        code: "CHUNK_TOO_LARGE",
      },
      { status: 413 }
    );
  }
  const declaredPeriode = cleanStr(periode, 7);
  if (!FEE_PERIODE_REGEX.test(declaredPeriode)) {
    return NextResponse.json(
      { error: "periode harus format YYYY-MM" },
      { status: 400 }
    );
  }
  const cleanFileName = cleanStr(fileName, 200) || "rekap-fee.xlsx";

  // Info chunk (opsional, backward-compatible): log hanya ditulis di akhir.
  let chunkIndex = 0;
  let chunkTotal = 1;
  if (typeof chunk === "object" && chunk !== null) {
    const { index, total } = chunk as { index?: unknown; total?: unknown };
    if (typeof index === "number" && typeof total === "number") {
      chunkIndex = Math.max(0, Math.floor(index));
      chunkTotal = Math.max(1, Math.floor(total));
    }
  }
  const isLastChunk = chunkIndex >= chunkTotal - 1;
  const grandTotal =
    typeof totalRows === "number" && Number.isFinite(totalRows) && totalRows > 0
      ? Math.floor(totalRows)
      : rows.length;

  // Sanitasi via mapper terpusat (`toFeeDbRow`: PPID kanonis, periode
  // otoritatif = declaredPeriode, total_fee defensif) + dedup
  // ppid||periode (terakhir menang). Jejak audit jumlah dihitung di sini
  // agar "preview bernominal tapi tersimpan 0" langsung ketahuan.
  // Paralel: profil Master (`normalizeImportProfil`) + details modul
  // (sheet Cari) didedup dengan kunci yang sama untuk tabel relasional
  // baru `loket_profiles` / `loket_transaction_details`.
  const byKey = new Map<string, FeeDbMappedRow>();
  const profilByKey = new Map<string, LoketProfileDbRow>();
  const detailsByKey = new Map<string, LoketDetailDbRow>();
  let skipped = 0;
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) {
      skipped += 1;
      continue;
    }
    const mapped = toFeeDbRow(raw as FeeImportPayloadItem, declaredPeriode);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    byKey.set(`${mapped.ppid}||${mapped.periode}`, mapped);
    const master = normalizeImportProfil(
      raw as FeeImportPayloadItem,
      declaredPeriode
    );
    if (master) {
      profilByKey.set(
        `${master.profil.ppid}||${master.profil.periode}`,
        master.profil
      );
      for (const d of master.details) {
        detailsByKey.set(
          `${d.ppid}||${d.periode}||${d.modul_nama}`,
          d
        );
      }
    }
  }
  const deduped = [...byKey.values()];
  if (deduped.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada baris valid (PPID wajib diisi)" },
      { status: 400 }
    );
  }
  const receivedSum = deduped.reduce((s, r) => s + r.rawTotal, 0);
  const storedSum = deduped.reduce((s, r) => s + r.total_fee, 0);
  const zeroRows = deduped.filter((r) => r.total_fee === 0).length;

  try {
    const admin = getSupabaseAdmin();
    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH);
      // Kolom DB eksplisit (tanpa field audit internal rawTotal/clamped).
      const payload = batch.map(
        ({ rawTotal: _raw, clamped: _clamped, ...dbRow }) => dbRow
      );
      const { error } = await admin
        .from("fee_loket")
        .upsert(payload, { onConflict: "ppid,periode" });
      if (error) throw error;
      upserted += batch.length;
    }
    // Upsert relasional Master (idempoten; 0 bila payload legacy tanpa
    // profil). Details bisa besar (10rb loket x modul aktif) sehingga
    // di-batch 500 seperti fee utama.
    const profils = [...profilByKey.values()];
    let profilesUpserted = 0;
    for (let i = 0; i < profils.length; i += BATCH) {
      const batch = profils.slice(i, i + BATCH);
      const { error } = await admin
        .from("loket_profiles")
        .upsert(batch, { onConflict: "ppid,periode" });
      if (error) throw error;
      profilesUpserted += batch.length;
    }
    const details = [...detailsByKey.values()];
    let detailsUpserted = 0;
    for (let i = 0; i < details.length; i += BATCH) {
      const batch = details.slice(i, i + BATCH);
      const { error } = await admin
        .from("loket_transaction_details")
        .upsert(batch, { onConflict: "ppid,periode,modul_nama" });
      if (error) throw error;
      detailsUpserted += batch.length;
    }
    // Log upload hanya pada chunk terakhir agar 1 file = 1 baris log
    // dengan jumlah_baris = total seluruh chunk (bukan per chunk).
    let logRow: unknown = null;
    if (isLastChunk) {
      const { data, error: logError } = await admin
        .from("fee_upload_logs")
        .insert({
          nama_file: cleanFileName,
          jumlah_baris: grandTotal,
          periode: declaredPeriode,
          diunggah_oleh: session.username,
        })
        .select("id,tanggal_upload,nama_file,jumlah_baris,periode,diunggah_oleh")
        .single();
      if (logError) throw logError;
      logRow = data;
    }
    return NextResponse.json({
      success: true,
      upserted,
      profilesUpserted,
      detailsUpserted,
      periode: declaredPeriode,
      chunkIndex,
      chunkTotal,
      // Gema audit nilai: klien membandingkan receivedSum vs storedSum
      // untuk mendeteksi mapping-loss (preview bernominal tapi DB 0).
      receivedSum,
      storedSum,
      zeroRows,
      skipped,
      log: logRow,
    });
  } catch (e) {
    const classified = classifyFeeDbError(
      e as { code?: unknown; message?: unknown },
      "fee_loket",
      e instanceof Error ? e.message : "Gagal menyimpan fee"
    );
    return NextResponse.json(
      { error: classified.message, code: classified.code },
      { status: classified.status }
    );
  }
}
