"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ListedUser {
  id: string;
  name: string;
  username: string;
  role: "ADMIN" | "USER";
  created_at: string;
}

interface SessionUser {
  userId: string;
  username: string;
  name: string;
  role: "ADMIN" | "USER";
}

type ModalState =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; user: ListedUser };

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter.format(d);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

export default function UserManagementPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form modal
  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<"ADMIN" | "USER">("USER");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [meRes, usersRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/users"),
      ]);
      if (meRes.ok) {
        const meJson = (await meRes.json()) as { user: SessionUser };
        setMe(meJson.user);
        // Proteksi client-side: non-ADMIN langsung kembali ke dashboard.
        // (Proxy + API 403 tetap menjadi lapis pertahanan utama.)
        if (meJson.user?.role !== "ADMIN") {
          router.replace("/");
          return;
        }
      }
      if (usersRes.status === 403) {
        setForbidden(true);
        setUsers([]);
        return;
      }
      if (!usersRes.ok) {
        const body = (await usersRes.json()) as { error?: string };
        throw new Error(body.error || "Gagal memuat daftar user");
      }
      const body = (await usersRes.json()) as { users: ListedUser[] };
      setUsers(body.users ?? []);
      setForbidden(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Pengambilan awal saat mount — kasus kanonis efek sinkronisasi data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }, [users, search]);

  function openAdd() {
    setFormName("");
    setFormUsername("");
    setFormPassword("");
    setFormRole("USER");
    setFormError(null);
    setModal({ mode: "add" });
  }

  function openEdit(user: ListedUser) {
    setFormName(user.name);
    setFormUsername(user.username);
    setFormPassword("");
    setFormRole(user.role);
    setFormError(null);
    setModal({ mode: "edit", user });
  }

  async function handleSave() {
    setFormError(null);
    if (formName.trim() === "" || formUsername.trim() === "") {
      setFormError("Nama dan username wajib diisi");
      return;
    }
    if (modal.mode === "add" && formPassword.length < 6) {
      setFormError("Password minimal 6 karakter");
      return;
    }
    if (formPassword !== "" && formPassword.length < 6) {
      setFormError("Password minimal 6 karakter");
      return;
    }
    setSaving(true);
    try {
      if (modal.mode === "closed") return;
      const editingId = modal.mode === "edit" ? modal.user.id : null;
      const res =
        modal.mode === "add"
          ? await fetch("/api/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: formName.trim(),
                username: formUsername.trim(),
                password: formPassword,
                role: formRole,
              }),
            })
          : await fetch("/api/users", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: editingId,
                name: formName.trim(),
                role: formRole,
                ...(formPassword !== "" ? { password: formPassword } : {}),
              }),
            });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(body.error || "Gagal menyimpan");
        return;
      }
      setModal({ mode: "closed" });
      await load();
    } catch {
      setFormError("Kesalahan jaringan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Gagal menghapus");
        return;
      }
      setConfirmDeleteId(null);
      await load();
    } catch {
      setError("Kesalahan jaringan. Coba lagi.");
    }
  }

  return (
    <div className="space-y-5">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Users className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              User Management
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Kelola akun portal langsung dari tabel users Supabase — khusus
              ADMIN.
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-2 text-center ring-1 ring-white/20 backdrop-blur">
            <p className="text-2xl font-extrabold text-cyan-300">{users.length}</p>
            <p className="text-[11px] font-semibold tracking-wider text-blue-100 uppercase">
              Total User
            </p>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="cf-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau username…"
            aria-label="Pencarian user"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          Tambah User
        </button>
      </section>

      {/* Konten */}
      {loading ? (
        <div className="cf-card flex items-center justify-center gap-2 p-12 text-sm text-slate-500" role="status">
          <Loader2 className="size-5 animate-spin text-cyan-600" aria-hidden />
          Memuat daftar user…
        </div>
      ) : forbidden ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-12 text-center">
          <ShieldAlert className="size-10 text-amber-500" aria-hidden />
          <p className="font-semibold text-amber-800">Akses ditolak</p>
          <p className="max-w-md text-sm text-amber-700">
            Halaman ini khusus ADMIN. Masuk dengan akun berole ADMIN untuk
            mengelola user.
          </p>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-sm font-medium text-red-700">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="cf-card flex flex-col items-center border-dashed py-16 text-center">
          <Users className="mb-3 size-8 text-slate-300" aria-hidden />
          <p className="text-sm font-semibold text-slate-900">
            {users.length === 0 ? "Belum ada user" : "Tidak ada hasil"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {users.length === 0
              ? "Tambahkan user pertama lewat tombol di atas."
              : "Coba kata kunci lain."}
          </p>
        </div>
      ) : (
        <section className="cf-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                  <th scope="col" className="px-4 py-3 font-semibold">Nama</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Username</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Role</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Dibuat</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-[11px] font-bold text-white"
                        >
                          {initials(u.name)}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {u.name}
                          {me?.userId === u.id && (
                            <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
                              ANDA
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {u.username}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                          u.role === "ADMIN"
                            ? "border-violet-200 bg-violet-50 text-violet-700"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                        )}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          aria-label={`Edit ${u.username}`}
                          title="Edit"
                          className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-blue-600"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        {confirmDeleteId === u.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleDelete(u.id)}
                              className="rounded-lg bg-red-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-red-700"
                            >
                              Ya, hapus
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(u.id)}
                            aria-label={`Hapus ${u.username}`}
                            title="Hapus"
                            disabled={me?.userId === u.id}
                            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal tambah/edit */}
      <Dialog.Root
        open={modal.mode !== "closed"}
        onOpenChange={(open) => {
          if (!open) setModal({ mode: "closed" });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                {modal.mode === "add" ? "Tambah User" : "Edit User"}
              </Dialog.Title>
              <Dialog.Close
                aria-label="Tutup"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Nama</span>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Username</span>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  disabled={modal.mode === "edit"}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Password{" "}
                  <span className="font-normal text-slate-400">
                    {modal.mode === "add" ? "(min 6)" : "(kosongkan bila tak diubah)"}
                  </span>
                </span>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Role</span>
                <select
                  value={formRole}
                  onChange={(e) =>
                    setFormRole(e.target.value === "ADMIN" ? "ADMIN" : "USER")
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </label>

              {formError && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {formError}
                </p>
              )}

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="w-full rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Menyimpan…" : modal.mode === "add" ? "Tambah" : "Simpan"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
