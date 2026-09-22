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
  /** True bila hash lama (SHA-256) — pemanggil sebaiknya rehash ke bcrypt. */
  needsRehash: boolean;
}

/** Validasi + normalisasi role (selain ADMIN dipaksa USER). */
export function normalizeRole(role: unknown): UserRole {
  return role === "ADMIN" ? "ADMIN" : "USER";
}

/** Buang password sebelum data keluar ke browser. */
export function toSafeUser(user: DbUser): SafeUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
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
    .select("id,name,username,password,role,created_at")
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
    .select("id,name,username,password,role,created_at")
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
    .select("id,name,username,password,role,created_at")
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
  if (patch.role === "ADMIN" || patch.role === "USER") {
    payload.role = patch.role;
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
  if (!user) return null;
  const valid = await verifyPassword(password, user.password);
  if (!valid) return null;
  return { user: toSafeUser(user), needsRehash: isLegacyHash(user.password) };
}
