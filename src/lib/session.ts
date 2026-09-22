/**
 * Sesi JWT via cookie httpOnly — port dari `kurlog-operations-portal`
 * (lib/auth.ts). Khusus server (route handler / proxy).
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "cultflow_session";
const TOKEN_EXPIRY = "24h";

export interface SessionPayload {
  userId: string;
  username: string;
  name: string;
  role: "ADMIN" | "USER";
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET environment variable is required. Set JWT_SECRET in .env.local (generate with: openssl rand -hex 32)"
    );
  }
  if (secret.length < 32) {
    console.warn(
      "[auth] JWT_SECRET should be at least 32 characters for adequate security"
    );
  }
  return new TextEncoder().encode(secret);
}

/** Buat token sesi JWT HS256 untuk payload user. */
export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

/** Verifikasi token sesi; null bila tidak valid/kedaluwarsa. */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Tulis cookie sesi (httpOnly, 24 jam). */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
}

/** Hapus cookie sesi (logout). */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/** Baca sesi dari request (proxy / route handler). */
export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Baca sesi dari cookie (server component / route handler). */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Path publik yang lolos proxy auth. */
export const PUBLIC_PATHS = ["/login", "/api/auth/login"];

/** true bila pathname publik (eksak atau di bawahnya). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}
