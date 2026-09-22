/**
 * POST /api/data-utama/import — upsert matriks AOA Excel ke
 * `data_lengkap_utama` (khusus ADMIN). Body: { matrix: unknown[][] }.
 * Upsert service_role `onConflict: 'ppid'` (UNIQUE penuh di remote).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  IMPORT_MAX_COLS,
  IMPORT_MAX_ROWS,
  importAgenMatrix,
} from "@/core/services/dataUtamaService";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  if (session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Hanya ADMIN yang boleh mengimpor data" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const matrix = (body as { matrix?: unknown }).matrix;
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return NextResponse.json(
      { error: "Matrix sheet kosong / tak terbaca" },
      { status: 400 }
    );
  }
  if (matrix.length > IMPORT_MAX_ROWS + 30) {
    return NextResponse.json(
      { error: `Terlalu banyak baris (maksimal ${IMPORT_MAX_ROWS})` },
      { status: 413 }
    );
  }
  const width = Math.max(
    0,
    ...matrix
      .slice(0, 10)
      .map((r) => (Array.isArray(r) ? (r as unknown[]).length : 0))
  );
  if (width > IMPORT_MAX_COLS) {
    return NextResponse.json(
      { error: `Terlalu banyak kolom (maksimal ${IMPORT_MAX_COLS})` },
      { status: 413 }
    );
  }
  if (matrix.some((r) => !Array.isArray(r))) {
    return NextResponse.json(
      { error: "Format matrix tidak valid (baris harus array)" },
      { status: 400 }
    );
  }

  try {
    const summary = await importAgenMatrix(
      getSupabaseAdmin(),
      matrix as unknown[][]
    );
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Impor gagal di server" },
      { status: 500 }
    );
  }
}
