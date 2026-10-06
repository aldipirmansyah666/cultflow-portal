/**
 * POST /api/fee-rekap/verify — rekonsiliasi PPID pasca-impor.
 * Body: { ppids: string[], periode: "YYYY-MM" }.
 * Menjawab "PPID mana yang belum masuk DB" dengan membandingkan daftar
 * PPID preview (dinormalisasi, unik) melawan `fee_loket` + `loket_profiles`
 * via service_role. Butuh login (semua role; hanya membaca eksistensi).
 * ppids dibatasi 20.000; klausa .in() di-chunk 500. Daftar `missing`
 * dipangkas 100 entri (plus missingCount penuh) agar payload ringan.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  canonicalizePeriode,
  normalizePpid,
} from "@/core/services/feeRekapService";

export const dynamic = "force-dynamic";
// Verifikasi 10rb+ PPID = puluhan query .in() ber-chunk; beri ruang
// eksekusi agar tidak timeout (false "gagal sinkron") di serverless.
export const maxDuration = 60;

const MAX_PPIDS = 20000;
const IN_CHUNK = 500;
const MAX_MISSING_LISTED = 100;
/** Konkurrensi query .in() agar verifikasi massal tidak serial lambat. */
const VERIFY_CONCURRENCY = 6;

async function existingPpids(
  table: string,
  ppids: string[],
  periode: string
): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  const found = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < ppids.length; i += IN_CHUNK) {
    chunks.push(ppids.slice(i, i + IN_CHUNK));
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next;
      next += 1;
      if (idx >= chunks.length) return;
      const { data, error } = await admin
        .from(table)
        .select("ppid")
        .eq("periode", periode)
        .in("ppid", chunks[idx] as string[]);
      if (error) throw error;
      for (const row of (data ?? []) as { ppid: unknown }[]) {
        const key = normalizePpid(row.ppid);
        if (key !== "") found.add(key);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, Math.max(1, chunks.length)) }, () =>
      worker()
    )
  );
  return found;
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
  const { ppids, periode } = body as { ppids?: unknown; periode?: unknown };
  if (!Array.isArray(ppids) || ppids.length === 0) {
    return NextResponse.json(
      { error: "ppids harus array tak-kosong" },
      { status: 400 }
    );
  }
  if (ppids.length > MAX_PPIDS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_PPIDS} PPID per verifikasi` },
      { status: 413 }
    );
  }
  const cleanPeriode = canonicalizePeriode(periode);
  if (cleanPeriode === "") {
    return NextResponse.json(
      { error: "periode harus format YYYY-MM atau YYYY-MM-T1..T3" },
      { status: 400 }
    );
  }
  const unique = [...new Set(
    ppids
      .map((p) => normalizePpid(p))
      .filter((p): p is string => p !== "")
  )];
  if (unique.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada PPID valid" },
      { status: 400 }
    );
  }
  try {
    // Sumber kebenaran ganda: legacy fee_loket + Master loket_profiles.
    // PPID dianggap masuk bila ada di SALAH SATU tabel periode tersebut.
    const [inFee, inProfiles] = await Promise.all([
      existingPpids("fee_loket", unique, cleanPeriode).catch(() => new Set<string>()),
      existingPpids("loket_profiles", unique, cleanPeriode).catch(() =>
        new Set<string>()
      ),
    ]);
    const missing = unique.filter((p) => !inFee.has(p) && !inProfiles.has(p));
    return NextResponse.json({
      success: true,
      periode: cleanPeriode,
      total: unique.length,
      found: unique.length - missing.length,
      missingCount: missing.length,
      missing: missing.slice(0, MAX_MISSING_LISTED),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verifikasi gagal" },
      { status: 500 }
    );
  }
}
