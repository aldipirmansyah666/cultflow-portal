/** GET /api/auth/me — profil sesi aktif (tanpa password). */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }
  return NextResponse.json({ user: session });
}
