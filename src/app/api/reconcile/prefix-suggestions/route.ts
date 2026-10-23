/**
 * /api/reconcile/prefix-suggestions — simpan & tinjau usulan prefix (ADMIN).
 *
 * POST  : upsert kelompok prefix dari satu hasil validasi.
 * PATCH : setujui/abaikan satu usulan berdasarkan produk + prefix, lalu
 *         sinkronkan prefix aktif ke tabel master dalam RPC atomik.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdminSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  listStoredPrefixSuggestions,
  recordPrefixSuggestions,
  updatePrefixSuggestionStatus,
  validatePrefixSuggestionDecision,
  validatePrefixSuggestions,
  type StoredPrefixSuggestion,
} from "@/core/services/prefixSuggestionService";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_DECISION_BODY_BYTES = 4 * 1024;

async function readJsonBody(
  req: NextRequest,
  maxBytes: number
): Promise<{ body: unknown } | { error: NextResponse }> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      error: NextResponse.json(
        { error: "Payload terlalu besar" },
        { status: 413 }
      ),
    };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return {
      error: NextResponse.json(
        { error: "Payload tidak valid" },
        { status: 400 }
      ),
    };
  }
  if (raw.length > maxBytes) {
    return {
      error: NextResponse.json(
        { error: "Payload terlalu besar" },
        { status: 413 }
      ),
    };
  }

  try {
    return { body: JSON.parse(raw) };
  } catch {
    return {
      error: NextResponse.json(
        { error: "Payload tidak valid" },
        { status: 400 }
      ),
    };
  }
}

async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if ("error" in parsed) return parsed.error;

  const body = parsed.body;
  const suggestions =
    typeof body === "object" && body !== null
      ? validatePrefixSuggestions(
          (body as Record<string, unknown>).suggestions
        )
      : null;
  if (!suggestions) {
    return NextResponse.json(
      { error: "Data usulan prefix tidak valid" },
      { status: 400 }
    );
  }

  try {
    const client = getSupabaseAdmin();
    const saved = await recordPrefixSuggestions(client, suggestions);

    // Best-effort: id/status hanya untuk tombol keputusan di UI. Kegagalan
    // membaca ulang tidak boleh membuat client mengulang upsert (yang akan
    // menambah occurrence_count lagi).
    let stored: StoredPrefixSuggestion[] = [];
    try {
      stored = await listStoredPrefixSuggestions(client, suggestions);
    } catch (e) {
      console.error(
        "[reconcile/prefix-suggestions] gagal membaca ulang usulan:",
        e
      );
    }

    return NextResponse.json({ saved, suggestions: stored });
  } catch (e) {
    console.error("[reconcile/prefix-suggestions] gagal menyimpan:", e);
    return NextResponse.json(
      { error: "Gagal menyimpan usulan prefix. Coba lagi." },
      { status: 503 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const parsed = await readJsonBody(req, MAX_DECISION_BODY_BYTES);
  if ("error" in parsed) return parsed.error;

  const decision = validatePrefixSuggestionDecision(parsed.body);
  if (!decision) {
    return NextResponse.json(
      { error: "Keputusan usulan prefix tidak valid" },
      { status: 400 }
    );
  }

  try {
    const suggestion = await updatePrefixSuggestionStatus(
      getSupabaseAdmin(),
      decision
    );
    if (!suggestion) {
      return NextResponse.json(
        { error: "Usulan prefix tidak ditemukan" },
        { status: 404 }
      );
    }
    return NextResponse.json({ suggestion });
  } catch (e) {
    console.error("[reconcile/prefix-suggestions] gagal memperbarui:", e);
    return NextResponse.json(
      { error: "Gagal memperbarui usulan prefix. Coba lagi." },
      { status: 503 }
    );
  }
}
