/**
 * Proxy auth (konvensi Next 16, port dari kurlog-operations-portal):
 * semua route butuh sesi kecuali /login + /api/auth/login;
 * /user-management dan /admin* khusus ADMIN.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isPublicPath,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session";

const ADMIN_PREFIXES = ["/user-management", "/admin"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // API routes menegakkan auth sendiri (401/403 JSON); proxy hanya guard halaman.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) &&
    session.role !== "ADMIN"
  ) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
