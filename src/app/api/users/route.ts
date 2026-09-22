/**
 * /api/users — CRUD tabel public.users, khusus ADMIN (kecuali tanpa sesi).
 * Password TIDAK PERNAH dikembalikan ke browser (toSafeUser).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { hashPassword } from "@/lib/password";
import {
  createUser,
  deleteUser,
  findUserByUsername,
  getUsers,
  normalizeRole,
  toSafeUser,
  updateUser,
} from "@/core/services/userService";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return {
      ok: false,
      res: NextResponse.json({ error: "Payload tidak valid" }, { status: 400 }),
    };
  }
}

/** GET — daftar user (tanpa password). */
export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
    }
    const users = await getUsers(getSupabaseAdmin());
    return NextResponse.json({ users: users.map(toSafeUser) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

/** POST — tambah user {name, username, password, role?}. */
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const { name, username, password, role } = parsed.body as {
    name?: unknown;
    username?: unknown;
    password?: unknown;
    role?: unknown;
  };

  if (
    typeof name !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    name.trim() === "" ||
    username.trim() === "" ||
    password === ""
  ) {
    return NextResponse.json({ error: "Semua field wajib diisi" }, { status: 400 });
  }
  if (name.length > 100 || username.length > 100) {
    return NextResponse.json(
      { error: "Nama/username terlalu panjang (max 100)" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password minimal 6 karakter" },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const existing = await findUserByUsername(supabase, username.trim());
    if (existing) {
      return NextResponse.json(
        { error: "Username sudah digunakan" },
        { status: 409 }
      );
    }
    const created = await createUser(supabase, {
      name: name.trim(),
      username: username.trim(),
      passwordHash: await hashPassword(password),
      role: normalizeRole(role),
    });
    return NextResponse.json({ success: true, user: toSafeUser(created) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal membuat akun" },
      { status: 500 }
    );
  }
}

/** PATCH — edit {id, name?, role?, password?} (password opsional, min 6). */
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const { id, name, role, password } = parsed.body as {
    id?: unknown;
    name?: unknown;
    role?: unknown;
    password?: unknown;
  };

  if (typeof id !== "string" || id === "") {
    return NextResponse.json({ error: "ID wajib diisi" }, { status: 400 });
  }
  if (typeof name === "string" && (name.trim() === "" || name.length > 100)) {
    return NextResponse.json({ error: "Nama tidak valid" }, { status: 400 });
  }
  if (role !== undefined && role !== "ADMIN" && role !== "USER") {
    return NextResponse.json({ error: "Role tidak valid" }, { status: 400 });
  }
  if (
    password !== undefined &&
    password !== "" &&
    (typeof password !== "string" || password.length < 6)
  ) {
    return NextResponse.json(
      { error: "Password minimal 6 karakter" },
      { status: 400 }
    );
  }

  try {
    await updateUser(getSupabaseAdmin(), id, {
      ...(typeof name === "string" && name.trim() !== "" ? { name } : {}),
      ...(role === "ADMIN" || role === "USER" ? { role } : {}),
      ...(typeof password === "string" && password !== ""
        ? { passwordHash: await hashPassword(password) }
        : {}),
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal memperbarui user" },
      { status: 500 }
    );
  }
}

/** DELETE ?id= — hapus user (dilarang hapus akun sendiri). */
export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID wajib diisi" }, { status: 400 });
  }
  if (id === session.userId) {
    return NextResponse.json(
      { error: "Tidak dapat menghapus akun sendiri" },
      { status: 400 }
    );
  }
  try {
    await deleteUser(getSupabaseAdmin(), id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal menghapus akun" },
      { status: 500 }
    );
  }
}
