"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronRight,
  CircleUser,
  House,
  LogOut,
  Menu,
  PanelLeft,
  Search,
} from "lucide-react";
import { resolveNavItem } from "@/core/types/navigation";
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
        <span aria-hidden className="h-6 w-px bg-slate-200" />
        <UserMenu />
      </div>
    </header>
  );
}
