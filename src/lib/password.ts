/**
 * Util password — port dari `kurlog-operations-portal` (lib/auth.ts).
 * Murni (tanpa dependensi Next) agar aman diuji dan dipakai di mana saja.
 */

import bcrypt from "bcryptjs";

export const BCRYPT_ROUNDS = 10;

/** True bila hash berformat bcrypt ($2a$/$2b$/$2y$). */
export function isBcryptHash(hash: string): boolean {
  return (
    hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")
  );
}

/** True bila hash LEGACY (bukan bcrypt) — kandidat auto-rehash saat login. */
export function isLegacyHash(hash: string): boolean {
  return !isBcryptHash(hash);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return toHex(new Uint8Array(hash));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Hash password baru (selalu bcrypt). */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verifikasi password terhadap hash tersimpan:
 * bcrypt.compare untuk hash bcrypt, fallback SHA-256 legacy
 * (format `salt$hash` atau tanpa salt) untuk data lama.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (isBcryptHash(hash)) {
    return bcrypt.compare(password, hash);
  }

  if (hash.includes("$")) {
    const [salt, expected] = hash.split("$");
    if (!salt || !expected) return false;
    const computed = await sha256Hex(salt + password);
    return timingSafeEqual(computed, expected);
  }

  const legacy = await sha256Hex(password);
  return timingSafeEqual(legacy, hash);
}
