"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { MobileSidebar, Sidebar } from "./Sidebar";

const STORAGE_KEY = "cultflow:sidebar-collapsed";

function readInitialCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface LayoutShellProps {
  children: React.ReactNode;
}

/** Kerangka portal: Sidebar + Header + area konten fleksibel. */
export function LayoutShell({ children }: LayoutShellProps) {
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Role sesi untuk menyaring menu terbatas (null = tamu/belum termuat).
  const [role, setRole] = useState<string | null>(null);
  const pathname = usePathname();

  // Muat role sekali saat mount (callback async = aman dari aturan lint).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const body = (await res.json()) as { user?: { role?: string } };
        if (!cancelled && typeof body.user?.role === "string") {
          setRole(body.user.role);
        }
      } catch {
        // abaikan: menu terbatas tetap tersembunyi
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // abaikan: persistensi hanya nice-to-have
      }
      return next;
    });
  };

  // Halaman login tampil polos (tanpa sidebar/header/footer).
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="tech-grid flex min-h-screen bg-[#f8fafc] text-slate-900 antialiased">
      <Sidebar collapsed={collapsed} role={role} />
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white/60 px-4 py-4 backdrop-blur-md sm:px-6">
          <p className="mx-auto max-w-7xl text-center font-mono text-[11px] text-slate-400">
            © 2026 CultFlow Workspace — Engineered by{" "}
            <span className="font-semibold text-slate-600">Aldi Pirmansyah</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
