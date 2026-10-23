/** POST /api/reconcile/runs — catat audit hasil validasi Reconcile (semua role login). */
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  pruneReconcileHistory,
  recordReconcileRun,
  validateReconcileRunInput,
} from "@/core/services/reconcileRunService";

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    return NextResponse.json({ error: "Payload terlalu besar" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload terlalu besar" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const input = validateReconcileRunInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "Data audit tidak valid" },
      { status: 400 }
    );
  }

  try {
    const client = getSupabaseAdmin();
    const run = await recordReconcileRun(client, session.userId, input);

    // Best-effort: audit sudah tersimpan. Gagal cleanup tidak boleh
    // mengubah respons sukses atau memicu client mengulang insert.
    try {
      await pruneReconcileHistory(client);
    } catch (e) {
      console.error("[reconcile/runs] gagal menjalankan retensi:", e);
    }

    return NextResponse.json({ run }, { status: 201 });
  } catch (e) {
    console.error("[reconcile/runs] gagal menyimpan audit:", e);
    return NextResponse.json(
      { error: "Gagal menyimpan audit Reconcile. Coba lagi." },
      { status: 503 }
    );
  }
}
