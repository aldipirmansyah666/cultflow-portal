/**
 * POST /api/auth/login — autentikasi terhadap tabel public.users.
 * Rate-limit sederhana: 5 percobaan/menit/IP (in-memory per instance).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  createSessionToken,
  setSessionCookie,
} from "@/lib/session";
import { hashPassword } from "@/lib/password";
import {
  authenticateUser,
  findUserByUsername,
  normalizeRole,
  updateUser,
} from "@/core/services/userService";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Coba lagi dalam 1 menit." },
        { status: 429 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }
    const { username, password } = body as {
      username?: unknown;
      password?: unknown;
    };

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.trim() === "" ||
      password === ""
    ) {
      return NextResponse.json(
        { error: "Username dan password harus diisi" },
        { status: 400 }
      );
    }
    if (username.length > 100 || password.length > 200) {
      return NextResponse.json({ error: "Input terlalu panjang" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const auth = await authenticateUser(supabase, username.trim(), password);
    if (!auth) {
      // Sengaja generik: tanpa bocorkan user-ada vs password-salah.
      return NextResponse.json(
        { error: "Username atau Password salah" },
        { status: 401 }
      );
    }

    // Auto-rehash hash legacy (SHA-256) ke bcrypt setelah login sukses.
    if (auth.needsRehash) {
      try {
        const newHash = await hashPassword(password);
        const full = await findUserByUsername(supabase, username.trim());
        if (full) await updateUser(supabase, full.id, { passwordHash: newHash });
      } catch (e) {
        console.warn("[auth] auto-rehash legacy password failed:", e);
      }
    }

    const token = await createSessionToken({
      userId: auth.user.id,
      username: auth.user.username,
      name: auth.user.name,
      role: normalizeRole(auth.user.role),
    });
    await setSessionCookie(token);

    return NextResponse.json({
      success: true,
      user: {
        id: auth.user.id,
        name: auth.user.name,
        username: auth.user.username,
        role: normalizeRole(auth.user.role),
      },
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
