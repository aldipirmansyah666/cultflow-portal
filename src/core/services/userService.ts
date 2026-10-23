/**
 * Service tabel `public.users` — data access + autentikasi.
 * Client-agnostic (terima SupabaseClient, umumnya service_role di server).
 * Password TIDAK PERNAH keluar lewat SafeUser; hash hanya dipakai internal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isLegacyHash,
  verifyPassword,
} from "@/lib/password";

export type UserRole = "ADMIN" | "USER";

export interface DbUser {
  id: string;
  name: string;
  username: string;
  /** Hash bcrypt (internal saja — jangan dikirim ke browser). */
  password: string;
  role: UserRole;
  created_at: string;
  /** Versi sesi JWT; dinaikkan saat logout / role / password berubah. */
  token_version: number;
}

/** Baris user aman untuk browser (tanpa password). */
export interface SafeUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  created_at: string;
}

export interface CreateUserInput {
  name: string;
  username: string;
  /** Hash bcrypt (panggil hashPassword dulu) — BUKAN plaintext. */
  passwordHash: string;
  role: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  /** Hash bcrypt baru (opsional). */
  passwordHash?: string;
}

export interface AuthResult {
  user: SafeUser;
  /** Versi sesi saat login — disalin ke klaim JWT. */
  tokenVersion: number;
  /** True bila hash lama (SHA-256) — pemanggil sebaiknya rehash ke bcrypt. */
  needsRehash: boolean;
}

/**
 * Hash bcrypt valid untuk password acak yang tidak pernah dipakai.
 * Dipakai saat username tidak ditemukan agar biaya verifikasi tetap sama
 * dengan user yang ada (anti timing-based user enumeration).
 * Nilai ini bukan kredensial aplikasi; hanya dummy compare.
 */
const DUMMY_BCRYPT_HASH =
  "$2b$10$ZNUokKSAUsAa9t2bwVj/b.zksH18SVKyvUybidYfTcR3xkBSVVzfa";

/**
 * Validasi + normalisasi role, case-insensitive.
 * "ADMIN"/"admin"/" Admin " -> "ADMIN"; selain itu dipaksa "USER".
 * Ini titik kanonis — semua pembanding role harus lewat sini / isAdminRole().
 */
export function normalizeRole(role: unknown): UserRole {
  if (typeof role === "string" && role.trim().toUpperCase() === "ADMIN") {
    return "ADMIN";
  }
  return "USER";
}

/** True bila role adalah ADMIN (case-insensitive, toleran spasi). */
export function isAdminRole(role: unknown): boolean {
  return normalizeRole(role) === "ADMIN";
}

/** Buang password sebelum data keluar ke browser (role selalu dinormalisasi). */
export function toSafeUser(user: DbUser): SafeUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: normalizeRole(user.role),
    created_at: user.created_at,
  };
}

function dbError(context: string, message: string): Error {
  console.error(`[users:${context}]`, message);
  return new Error(message);
}

/** Ambil seluruh user terurut created_at menaik. */
export async function getUsers(client: SupabaseClient): Promise<DbUser[]> {
  const { data, error } = await client
    .from("users")
    .select("id,name,username,password,role,created_at,token_version")
    .order("created_at", { ascending: true });
  if (error) throw dbError("list", `Gagal membaca tabel users: ${error.message}`);
  return (data ?? []) as DbUser[];
}

/** Cari user by username persis (satu baris). */
export async function findUserByUsername(
  client: SupabaseClient,
  username: string
): Promise<DbUser | null> {
  const { data, error } = await client
    .from("users")
    .select("id,name,username,password,role,created_at,token_version")
    .eq("username", username)
    .limit(1);
  if (error) throw dbError("find", `Gagal mencari user: ${error.message}`);
  const rows = (data ?? []) as DbUser[];
  return rows.length > 0 && rows[0] ? rows[0] : null;
}

/** Hitung total user (untuk guard/validasi). */
export async function countUsers(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) throw dbError("count", `Gagal menghitung user: ${error.message}`);
  return count ?? 0;
}

/** Tambah user; 23505 (username ganda) dipetakan ke pesan ramah. */
export async function createUser(
  client: SupabaseClient,
  input: CreateUserInput
): Promise<DbUser> {
  const { data, error } = await client
    .from("users")
    .insert({
      name: input.name,
      username: input.username,
      password: input.passwordHash,
      role: input.role,
    })
    .select("id,name,username,password,role,created_at,token_version")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw dbError("create", "Username sudah digunakan");
    }
    throw dbError("create", `Gagal membuat user: ${error.message}`);
  }
  return data as DbUser;
}

/** Update nama/role/passwordHash by id. */
export async function updateUser(
  client: SupabaseClient,
  id: string,
  patch: UpdateUserInput
): Promise<void> {
  const payload: Record<string, string> = {};
  if (typeof patch.name === "string" && patch.name.trim() !== "") {
    payload.name = patch.name.trim();
  }
  if (typeof patch.role === "string") {
    // Terima "admin"/"user" campuran huruf dari client, simpan kanonis UPPER.
    const normalized = normalizeRole(patch.role);
    // Hanya tulis bila input memang role yang dikenal (hindari menimpa
    // dengan USER saat client mengirim sampah — validasi di API route).
    if (patch.role.trim().toUpperCase() === "ADMIN" || patch.role.trim().toUpperCase() === "USER") {
      payload.role = normalized;
    }
  }
  if (
    typeof patch.passwordHash === "string" &&
    patch.passwordHash !== ""
  ) {
    payload.password = patch.passwordHash;
  }
  if (Object.keys(payload).length === 0) {
    throw dbError("update", "Tidak ada perubahan yang valid");
  }
  const { error } = await client.from("users").update(payload).eq("id", id);
  if (error) throw dbError("update", `Gagal memperbarui user: ${error.message}`);
}

/**
 * Cabut semua token user dengan menaikkan token_version secara atomik.
 * Dipakai logout dan saat admin mengubah role/password user.
 */
export async function bumpUserTokenVersion(
  client: SupabaseClient,
  id: string
): Promise<number> {
  const { data, error } = await client.rpc("bump_user_token_version", {
    p_user_id: id,
  });
  if (error) {
    throw dbError("bump-token", `Gagal mencabut sesi user: ${error.message}`);
  }
  const version = typeof data === "number" ? data : Number(data);
  if (!Number.isInteger(version) || version < 1) {
    throw dbError("bump-token", "Respons token_version tidak valid");
  }
  return version;
}

/** Hapus user by id. */
export async function deleteUser(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from("users").delete().eq("id", id);
  if (error) throw dbError("delete", `Gagal menghapus user: ${error.message}`);
}

/**
 * Autentikasi username+password terhadap tabel users.
 * null bila user tak ada / password salah (tanpa bocorkan penyebab).
 */
export async function authenticateUser(
  client: SupabaseClient,
  username: string,
  password: string
): Promise<AuthResult | null> {
  const user = await findUserByUsername(client, username);
  // Selalu jalankan bcrypt, termasuk saat user tidak ada, agar waktu respons
  // login tidak membocorkan keberadaan username.
  const valid = await verifyPassword(
    password,
    user?.password ?? DUMMY_BCRYPT_HASH
  );
  if (!user || !valid) return null;
  return {
    user: toSafeUser(user),
    tokenVersion: user.token_version,
    needsRehash: isLegacyHash(user.password),
  };
}
