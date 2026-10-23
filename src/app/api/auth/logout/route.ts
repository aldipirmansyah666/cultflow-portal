/** POST /api/auth/logout — cabut token_version lalu hapus cookie sesi. */
import { NextResponse, type NextRequest } from "next/server";
import {
  clearSessionCookie,
  getSessionFromRequest,
} from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { bumpUserTokenVersion } from "@/core/services/userService";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (session) {
      // Naikkan versi token user: token yang sudah dicuri / disalin tidak
      // berlaku lagi walau cookie-nya masih dipegang penyerang.
      await bumpUserTokenVersion(getSupabaseAdmin(), session.userId);
    }
    await clearSessionCookie();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[auth/logout] gagal mencabut sesi:", e);
    // Cookie tetap dibersihkan agar browser tidak terus mengirim token yang
    // sudah tidak dapat diverifikasi. Klien menerima 503 agar tahu server
    // gagal melakukan revokasi database.
    await clearSessionCookie();
    return NextResponse.json(
      { error: "Gagal mencabut sesi di server. Coba lagi." },
      { status: 503 }
    );
  }
}
