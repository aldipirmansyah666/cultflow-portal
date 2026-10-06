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
  canonicalizePeriode,
  classifyFeeDbError,
  IMPORT_MAX_ROWS_PER_REQUEST,
  normalizeImportProfil,
  runBatchesIsolated,
  toFeeDbRow,
  type BatchIssue,
  type FeeDbMappedRow,
  type FeeImportPayloadItem,
  type LoketDetailDbRow,
  type LoketProfileDbRow,
} from "@/core/services/feeRekapService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Konkurrensi worker untuk batch upsert (diteruskan ke
 * runBatchesIsolated): 4 paralel cukup memangkas waktu fan-out
 * details tanpa membanjiri PostgREST.
 */
const UPSERT_CONCURRENCY = 4;

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
  // Periode dikanonisasi (BUKAN dipotong 7 karakter — slice(0,7) akan
  // membuang sufiks termin "-T1" sehingga T1/T2/T3 saling menimpa).
  // Menerima "2026-09-T1" maupun "September 2026 - T1".
  const declaredPeriode = canonicalizePeriode(periode);
  if (declaredPeriode === "") {
    return NextResponse.json(
      { error: "periode harus format YYYY-MM atau YYYY-MM-T1..T3 (contoh: September 2026 - T1)" },
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
    const issues: BatchIssue[] = [];
    // Tiga tabel ditulis via batch independen terisolasi (lihat
    // runBatchesIsolated): batch gagal + fallback per baris dicatat di
    // issues TANPA menggugurkan batch lain — 10rb+ baris tuntas walau
    // ada baris busuk.
    // Kolom DB eksplisit (tanpa field audit internal rawTotal/clamped).
    const feePayload = deduped.map(
      ({ rawTotal: _raw, clamped: _clamped, ...dbRow }) => dbRow
    );
    const feeRes = await runBatchesIsolated(feePayload, {
      batchSize: BATCH,
      concurrency: UPSERT_CONCURRENCY,
      table: "fee_loket",
      keyOf: (r) => r.ppid,
      upsertBatch: async (batch) => {
        const { error } = await admin
          .from("fee_loket")
          .upsert(batch, { onConflict: "ppid,periode" });
        if (error) throw error;
      },
      upsertOne: async (row) => {
        const { error } = await admin
          .from("fee_loket")
          .upsert(row, { onConflict: "ppid,periode" });
        if (error) throw error;
      },
      issues,
    });
    const upserted = feeRes.succeeded;
    // Upsert relasional Master (idempoten; 0 bila payload legacy tanpa
    // profil). Details bisa besar (10rb loket x modul aktif) sehingga
    // di-batch 500 seperti fee utama — pool konkuren di dalamnya.
    const profils = [...profilByKey.values()];
    const profRes = await runBatchesIsolated(profils, {
      batchSize: BATCH,
      concurrency: UPSERT_CONCURRENCY,
      table: "loket_profiles",
      keyOf: (r) => r.ppid,
      upsertBatch: async (batch) => {
        const { error } = await admin
          .from("loket_profiles")
          .upsert(batch, { onConflict: "ppid,periode" });
        if (error) throw error;
      },
      upsertOne: async (row) => {
        const { error } = await admin
          .from("loket_profiles")
          .upsert(row, { onConflict: "ppid,periode" });
        if (error) throw error;
      },
      issues,
    });
    const profilesUpserted = profRes.succeeded;
    const details = [...detailsByKey.values()];
    const detRes = await runBatchesIsolated(details, {
      batchSize: BATCH,
      concurrency: UPSERT_CONCURRENCY,
      table: "loket_transaction_details",
      keyOf: (r) => `${r.ppid}::${r.modul_nama}`,
      upsertBatch: async (batch) => {
        const { error } = await admin
          .from("loket_transaction_details")
          .upsert(batch, { onConflict: "ppid,periode,modul_nama" });
        if (error) throw error;
      },
      upsertOne: async (row) => {
        const { error } = await admin
          .from("loket_transaction_details")
          .upsert(row, { onConflict: "ppid,periode,modul_nama" });
        if (error) throw error;
      },
      issues,
    });
    const detailsUpserted = detRes.succeeded;
    // Prune rincian yatim: upsert tak menghapus modul yang HILANG dari
    // file baru (mis. re-upload tinggal 70 dari 79 modul) sehingga rincian
    // basi menumpuk/duplikat secara logis di lookup. Untuk tiap
    // (ppid,periode) chunk ini, hapus modul_nama yang tidak ada di payload
    // chunk ini. Idempoten & aman di-retry: chunk pemilik modul akan
    // me-re-upsert-nya saat gilirannya; chunk yang sama diulang pun
    // menghasilkan himpunan akhir yang sama. Non-fatal (masuk issues) agar
    // pembersihan tak menggagalkan penyimpanan utama.
    if (details.length > 0) {
      try {
        const keepByPpid = new Map<string, Set<string>>();
        for (const d of details) {
          const key = `${d.ppid}||${d.periode}`;
          let set = keepByPpid.get(key);
          if (!set) {
            set = new Set<string>();
            keepByPpid.set(key, set);
          }
          set.add(d.modul_nama);
        }
        const ppids = [...keepByPpid.keys()].map((k) => k.split("||")[0] as string);
        const existing = new Map<string, Set<string>>();
        for (let i = 0; i < ppids.length; i += 500) {
          const { data, error } = await admin
            .from("loket_transaction_details")
            .select("ppid,modul_nama")
            .eq("periode", declaredPeriode)
            .in("ppid", ppids.slice(i, i + 500));
          if (error) throw error;
          for (const r of (data ?? []) as { ppid: unknown; modul_nama: unknown }[]) {
            const ppid = String(r.ppid ?? "");
            const mod = String(r.modul_nama ?? "");
            if (ppid === "" || mod === "") continue;
            let set = existing.get(`${ppid}||${declaredPeriode}`);
            if (!set) {
              set = new Set<string>();
              existing.set(`${ppid}||${declaredPeriode}`, set);
            }
            set.add(mod);
          }
        }
        let pruned = 0;
        for (const [key, keep] of keepByPpid) {
          const have = existing.get(key);
          if (!have) continue;
          const [ppid] = key.split("||");
          for (const mod of have) {
            if (keep.has(mod)) continue;
            const { error } = await admin
              .from("loket_transaction_details")
              .delete()
              .eq("ppid", ppid as string)
              .eq("periode", declaredPeriode)
              .eq("modul_nama", mod);
            if (error) throw error;
            pruned += 1;
          }
        }
        if (pruned > 0) {
          issues.push({
            batch: 0,
            table: "loket_transaction_details",
            message: `${pruned} rincian modul yatim dibersihkan (tidak ada di file baru).`,
          });
        }
      } catch (e) {
        issues.push({
          batch: 0,
          table: "loket_transaction_details",
          message: `Pembersihan rincian yatim dilewati: ${e instanceof Error ? e.message : "gagal"}. Data utama tetap tersimpan.`,
        });
      }
    }
    // PPID yang benar-benar hilang dari fee_loket (urutan pertama =
    // tabel kebenaran utama; rincian details menyusul per PPID::modul).
    const failedPpids = feeRes.failedIds.slice(0, 100);
    // Log upload hanya pada chunk terakhir agar 1 file = 1 baris log
    // dengan jumlah_baris = total seluruh chunk (bukan per chunk).
    // Dilewati bila chunk ini nol baris tersimpan (impor gagal total).
    let logRow: unknown = null;
    if (isLastChunk && upserted > 0) {
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
      // Akuntansi chunk: received = baris valid ter-dedup yang diproses
      // chunk ini. Klien menegaskan upserted + failedCount === received;
      // selisih berarti ada baris hilang diam-diam (silent failure).
      received: deduped.length,
      skipped,
      // Gema audit nilai: klien membandingkan receivedSum vs storedSum
      // untuk mendeteksi mapping-loss (preview bernominal tapi DB 0).
      receivedSum,
      storedSum,
      zeroRows,
      // Isolasi batch: masalah per batch + PPID yang gagal total agar
      // klien dapat melanjutkan/menandai tanpa menebak.
      batchErrors: issues,
      failedPpids,
      failedCount: feeRes.failedIds.length,
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
