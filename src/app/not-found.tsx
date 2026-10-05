/**
 * Halaman 404 segmen-level: tampil untuk route yang tidak ada.
 */

import Link from "next/link";
import { SearchX, LayoutDashboard } from "lucide-react";

export default function AppNotFound() {
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <SearchX className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Halaman tidak ditemukan
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Alamat yang Anda tuju tidak ada atau sudah dipindahkan. (404)
            </p>
          </div>
        </div>
      </section>

      <section className="cf-card p-4 sm:p-5">
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:opacity-90"
        >
          <LayoutDashboard className="size-4" aria-hidden />
          Kembali ke Dashboard
        </Link>
      </section>
    </div>
  );
}
