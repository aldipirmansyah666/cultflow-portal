"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleUser,
  House,
  LogOut,
  Menu,
  PanelLeft,
  Search,
  XCircle,
} from "lucide-react";
import { resolveNavItem } from "@/core/types/navigation";
import type {
  PendingPrefixSuggestionsResult,
  StoredPrefixSuggestion,
} from "@/core/services/prefixSuggestionService";
import {
  emitPrefixSuggestionsChanged,
  PREFIX_SUGGESTIONS_CHANGED_EVENT,
} from "@/lib/reconcileEvents";
import { cn } from "@/lib/utils";

interface HeaderProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileNav: () => void;
}

function Breadcrumb() {
  const pathname = usePathname();
  const current = resolveNavItem(pathname);
  const fallback =
    pathname === "/"
      ? undefined
      : pathname.split("/").filter(Boolean).pop()?.replace(/-/g, " ");

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link
        href="/"
        aria-label="Ke Dashboard"
        className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600"
      >
        <House className="size-4" aria-hidden />
      </Link>
      <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
      <span className="truncate font-semibold text-slate-900 capitalize">
        {current?.title ?? fallback ?? "Dashboard"}
      </span>
    </nav>
  );
}

/** Badge status koneksi realtime (placeholder — wiring Supabase Realtime menyusul). */
function LiveBadge() {
  return (
    <span
      role="status"
      aria-label="Status koneksi realtime: live"
      title="Terhubung ke channel realtime"
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      Live
    </span>
  );
}

/** Pemicu command palette (placeholder — implementasi palette menyusul). */
function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      title="Buka pencarian cepat (segera hadir)"
      aria-label="Buka pencarian cepat"
      className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 sm:inline-flex"
    >
      <Search className="size-4" aria-hidden />
      <span>Cari…</span>
      <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-500 shadow-xs">
        Ctrl K
      </kbd>
    </button>
  );
}

const EMPTY_PENDING: PendingPrefixSuggestionsResult = {
  pendingCount: 0,
  suggestions: [],
};

function suggestionKey(
  suggestion: Pick<StoredPrefixSuggestion, "productName" | "suggestedPrefix">,
) {
  return `${suggestion.productName}\u0000${suggestion.suggestedPrefix}`;
}

function toastMessage(result: PendingPrefixSuggestionsResult): string | null {
  const first = result.suggestions[0];
  if (!first || result.pendingCount < 1) return null;

  const detail = `${first.suggestedPrefix} - ${first.productName}`;
  if (result.pendingCount === 1) {
    return `Ada 1 usulan prefix baru (${detail}) dari User yang memerlukan persetujuan.`;
  }
  return `Ada ${result.pendingCount} usulan prefix baru, terbaru (${detail}) dari User yang memerlukan persetujuan.`;
}

/**
 * Lonceng usulan prefix + toast. Endpoint hanya untuk ADMIN; role lain
 * mendapat 403 sehingga lonceng tidak dirender.
 */
function PrefixNotifications() {
  const pathname = usePathname();
  const shouldToast = pathname === "/" || pathname === "/reconcile";
  const [mode, setMode] = useState<"loading" | "admin" | "guest" | "error">(
    "loading",
  );
  const [pending, setPending] =
    useState<PendingPrefixSuggestionsResult>(EMPTY_PENDING);
  const [toast, setToast] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const lastToastKey = useRef("");

  const loadPending = useCallback(async (notify: boolean) => {
    try {
      const res = await fetch("/api/reconcile/prefix-suggestions", {
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        setMode("guest");
        setPending(EMPTY_PENDING);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as Partial<PendingPrefixSuggestionsResult>;
      const suggestions = Array.isArray(body.suggestions)
        ? body.suggestions
        : [];
      const result: PendingPrefixSuggestionsResult = {
        pendingCount:
          typeof body.pendingCount === "number"
            ? body.pendingCount
            : suggestions.length,
        suggestions,
      };

      setMode("admin");
      setPending(result);

      if (notify) {
        const message = toastMessage(result);
        const first = result.suggestions[0];
        const key = first
          ? `${result.pendingCount}:${first.id}:${first.updatedAt}`
          : "";
        if (message && key && key !== lastToastKey.current) {
          lastToastKey.current = key;
          setToast(message);
        }
      }
    } catch {
      setMode((current) => (current === "admin" ? "admin" : "error"));
    }
  }, []);

  useEffect(() => {
    // Sinkronisasi awal dengan API notifikasi (bukan derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPending(shouldToast);
  }, [loadPending, pathname, shouldToast]);

  useEffect(() => {
    const refresh = () => void loadPending(false);
    window.addEventListener(PREFIX_SUGGESTIONS_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(
      () => void loadPending(shouldToast),
      60_000,
    );
    return () => {
      window.removeEventListener(PREFIX_SUGGESTIONS_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [loadPending, shouldToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 9000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function decide(
    suggestion: StoredPrefixSuggestion,
    status: "approved" | "rejected",
  ) {
    const key = suggestionKey(suggestion);
    setSavingKey(key);
    setActionError(null);
    try {
      const res = await fetch("/api/reconcile/prefix-suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: suggestion.productName,
          suggestedPrefix: suggestion.suggestedPrefix,
          status,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; suggestion?: StoredPrefixSuggestion }
        | null;
      if (!res.ok) {
        throw new Error(body?.error ?? "Gagal memperbarui usulan prefix.");
      }

      setPending((current) => ({
        pendingCount: Math.max(0, current.pendingCount - 1),
        suggestions: current.suggestions.filter(
          (item) => suggestionKey(item) !== key,
        ),
      }));
      setToast(null);
      if (body?.suggestion) emitPrefixSuggestionsChanged(body.suggestion);
      else void loadPending(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Gagal memperbarui usulan prefix.",
      );
      void loadPending(false);
    } finally {
      setSavingKey(null);
    }
  }

  if (mode !== "admin") return null;

  const badge =
    pending.pendingCount > 99 ? "99+" : String(pending.pendingCount);

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => open && void loadPending(false)}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={
              pending.pendingCount > 0
                ? `Notifikasi usulan prefix, ${pending.pendingCount} menunggu persetujuan`
                : "Notifikasi usulan prefix"
            }
            className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-600"
          >
            <Bell className="size-5" aria-hidden />
            {pending.pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-bold text-white shadow-sm">
                {badge}
              </span>
            )}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            aria-label="Notifikasi usulan prefix"
            className="z-50 w-[min(92vw,390px)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10"
          >
            <div className="flex items-center justify-between gap-3 px-1 pb-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Usulan Prefix
                </p>
                <p className="text-[11px] text-slate-500">
                  {pending.pendingCount > 0
                    ? `${pending.pendingCount} menunggu persetujuan`
                    : "Tidak ada usulan pending"}
                </p>
              </div>
              <Bell className="size-4 text-slate-400" aria-hidden />
            </div>

            {actionError && (
              <p
                role="alert"
                className="mx-1 mb-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700"
              >
                {actionError}
              </p>
            )}

            {pending.suggestions.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                Semua usulan sudah ditinjau.
              </p>
            ) : (
              <ul className="max-h-[22rem] space-y-2 overflow-y-auto">
                {pending.suggestions.map((suggestion) => {
                  const key = suggestionKey(suggestion);
                  const saving = savingKey === key;
                  return (
                    <li
                      key={suggestion.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-semibold text-slate-900">
                          <span className="font-mono text-blue-700">
                            {suggestion.suggestedPrefix}
                          </span>
                          <span className="px-1 text-slate-300">·</span>
                          <span className="truncate">
                            {suggestion.productName}
                          </span>
                        </p>
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          {suggestion.occurrenceCount} baris
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                        Contoh resi: {suggestion.sampleResi ?? "-"}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void decide(suggestion, "approved")}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          {saving ? "Menyimpan…" : "Setujui"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void decide(suggestion, "rejected")}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <XCircle className="size-3.5" aria-hidden />
                          Abaikan
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {pending.pendingCount > pending.suggestions.length && (
              <p className="px-1 pt-1.5 text-[10px] text-slate-500">
                Menampilkan {pending.suggestions.length} terbaru dari{" "}
                {pending.pendingCount} usulan.
              </p>
            )}

            <DropdownMenu.Separator className="my-2 h-px bg-slate-100" />
            <Link
              href="/reconcile"
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-blue-700 outline-none hover:bg-blue-50"
            >
              Buka Reconcile Validator
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 right-4 z-[60] w-[min(92vw,380px)] rounded-xl border border-blue-200 bg-white p-3 shadow-xl shadow-blue-900/10"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <Bell className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Usulan prefix baru
              </p>
              <p className="mt-0.5 text-xs text-slate-600">{toast}</p>
              <Link
                href="/reconcile"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                Tinjau sekarang
                <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            <button
              type="button"
              aria-label="Tutup notifikasi"
              onClick={() => setToast(null)}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <XCircle className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Menu profil pengguna (sesi dari /api/auth/me + logout). */
function UserMenu() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const body = (await res.json()) as {
          user?: { name?: string; role?: string };
        };
        if (!cancelled && body.user) {
          setName(body.user.name ?? null);
          setRole(body.user.role ?? null);
        }
      } catch {
        // abaikan: tampil sebagai tamu
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const initials =
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Buka menu pengguna"
          className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-slate-100"
        >
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-xs font-bold text-white shadow-sm shadow-blue-600/30"
          >
            {initials}
          </span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-sm font-semibold text-slate-900">
              {name ?? "Tamu"}
            </span>
            <span className="block text-[11px] text-slate-500">
              {role ?? "Belum masuk"}
            </span>
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/5"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-slate-500">
            {name ? `Masuk sebagai ${name}` : "Belum masuk"}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          {name ? (
            <DropdownMenu.Item
              onSelect={() => void handleLogout()}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-red-600 outline-none select-none hover:bg-red-50"
            >
              <LogOut className="size-4" aria-hidden />
              Logout
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item asChild>
              <Link
                href="/login"
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 outline-none select-none hover:bg-slate-100"
              >
                <CircleUser className="size-4" aria-hidden />
                Masuk
              </Link>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Header({ collapsed, onToggleSidebar, onOpenMobileNav }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur-md sm:px-4">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Buka navigasi"
        className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={collapsed ? "Bentangkan sidebar" : "Ciutkan sidebar"}
        aria-expanded={!collapsed}
        title={collapsed ? "Bentangkan sidebar" : "Ciutkan sidebar"}
        className={cn(
          "hidden rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-600 md:inline-flex",
        )}
      >
        <PanelLeft className="size-5" aria-hidden />
      </button>
      <Breadcrumb />
      <div className="ml-auto flex items-center gap-2">
        <CommandPaletteTrigger />
        <LiveBadge />
        <PrefixNotifications />
        <span aria-hidden className="h-6 w-px bg-slate-200" />
        <UserMenu />
      </div>
    </header>
  );
}
