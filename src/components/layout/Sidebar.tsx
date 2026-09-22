"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Code,
  Database,
  Layers,
  LayoutDashboard,
  MessagesSquare,
  Package,
  PackageOpen,
  PackageSearch,
  Scale,
  Search,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { NAV_ITEMS, filterNavByRole, isNavActive, type NavItem } from "@/core/types/navigation";
import { cn } from "@/lib/utils";

/** Pemetaan nama ikon (string di `NavItem.icon`) ke komponen Lucide. */
const NAV_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Database,
  Package,
  PackageOpen,
  PackageSearch,
  Scale,
  Search,
  MessagesSquare,
  Users,
};

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  /** Role sesi (ADMIN/USER/null). Menu ber-`roles` disaring. */
  role?: string | null;
}

function SidebarNav({ collapsed = false, onNavigate, role }: SidebarNavProps) {
  const pathname = usePathname();
  const visibleItems = filterNavByRole(NAV_ITEMS, role);

  return (
    <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 py-4">
      <p
        className={cn(
          "px-2 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase",
          collapsed && "sr-only",
        )}
      >
        Menu Utama
      </p>
      <ul className="space-y-1">
        {visibleItems.map((item: NavItem) => {
          const Icon = NAV_ICONS[item.icon] ?? LayoutDashboard;
          const active = isNavActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? item.title : undefined}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon
                  className={cn("size-5 shrink-0", active && "text-cyan-300")}
                  strokeWidth={active ? 2.25 : 2}
                  aria-hidden
                />
                {!collapsed && <span className="min-w-0 flex-1 truncate">{item.title}</span>}
                {!collapsed && item.badge != null && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-16 items-center gap-2.5 border-b border-slate-200 px-4",
        collapsed && "justify-center px-0",
      )}
    >
      {collapsed ? (
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm shadow-blue-600/30">
          <Layers className="size-5" aria-hidden />
        </span>
      ) : (
        <span className="flex items-center rounded-xl bg-slate-900 px-2.5 py-1.5 shadow-sm">
          <Image
            src="/cultflow-icon.png"
            alt="CultFlow Logo"
            width={1213}
            height={308}
            priority
            className="h-10 w-auto"
          />
        </span>
      )}
    </div>
  );
}

/** Kartu watermark creator di dasar sidebar. */
function CreatorCard() {
  return (
    <div className="cf-card p-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 font-mono text-xs font-bold text-white shadow-sm"
        >
          AP
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-mono text-xs font-bold text-slate-900">
            CultFlow Engine v2.0
          </p>
          <p className="truncate font-mono text-[10px] text-slate-500">Built by</p>
          <p className="flex items-center gap-1 truncate font-mono text-[10px] font-semibold text-blue-700">
            <Code className="size-3 shrink-0" aria-hidden />
            Aldi Pirmansyah
          </p>
        </div>
      </div>
    </div>
  );
}

interface SidebarProps {
  collapsed: boolean;
  role?: string | null;
}

/** Sidebar desktop: sticky, collapse ke mode ikon. */
export function Sidebar({ collapsed, role }: SidebarProps) {
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ease-in-out md:flex",
        collapsed ? "w-[76px]" : "w-[260px]",
      )}
    >
      <SidebarBrand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} role={role} />
      <div className="border-t border-slate-200 p-3">
        {collapsed ? (
          <span
            title="CultFlow Engine v2.0 — Built by Aldi Pirmansyah"
            aria-label="CultFlow Engine v2.0 — Built by Aldi Pirmansyah"
            className="mx-auto flex size-9 items-center justify-center rounded-lg bg-slate-900 font-mono text-xs font-bold text-white shadow-sm"
          >
            AP
          </span>
        ) : (
          <CreatorCard />
        )}
      </div>
    </aside>
  );
}

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  role?: string | null;
}

/** Drawer navigasi untuk layar kecil (< md). */
export function MobileSidebar({ open, onClose, role }: MobileSidebarProps) {
  return (
    <div className={cn("fixed inset-0 z-50 md:hidden", !open && "pointer-events-none")}>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-slate-950/40 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <aside
        aria-label="Sidebar mobile"
        className={cn(
          "absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-slate-200 bg-white shadow-xl shadow-slate-900/5 transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <SidebarBrand />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup navigasi"
            className="mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <SidebarNav onNavigate={onClose} role={role} />
        <div className="border-t border-slate-200 p-3">
          <CreatorCard />
        </div>
      </aside>
    </div>
  );
}
