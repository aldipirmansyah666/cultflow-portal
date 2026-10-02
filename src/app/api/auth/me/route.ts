/** GET /api/auth/me — profil sesi aktif (tanpa password, role kanonis UPPER). */
import { NextResponse } from "next/server";
import { getSession, normalizeSessionRole } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  // Normalisasi defensif: token lama mungkin menyimpan "admin" kecil.
  return NextResponse.json({
    user: { ...session, role: normalizeSessionRole(session.role) },
  });
}
