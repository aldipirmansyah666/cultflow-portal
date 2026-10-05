"use client";

/**
 * Error boundary segmen-level: tampil bila Server/Client Component di
 * bawah `src/app/` melempar error saat render atau fetch data.
 * `reset()` mencoba me-render ulang segmen tanpa reload penuh.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, LayoutDashboard } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app:error]", error);
  }, [error]);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <AlertTriangle className="size-6 text-amber-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Terjadi kesalahan
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Halaman gagal dimuat. Coba lagi, atau kembali ke dashboard.
            </p>
          </div>
        </div>
      </section>

      <section className="cf-card space-y-4 p-4 sm:p-5" role="alert">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs break-all text-red-700">
          {error.message || "Kesalahan tak dikenal."}
          {error.digest ? ` (digest: ${error.digest})` : ""}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:opacity-90"
          >
            <RotateCcw className="size-4" aria-hidden />
            Coba Lagi
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
