"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  PackageSearch,
  PhoneCall,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { ResiRow } from "@/core/services/resiService";
import { cn } from "@/lib/utils";

type FilterTab = "semua" | "belum" | "sudah";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return dateFormatter.format(d);
}

function text(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t === "" ? "—" : t;
}

/** Warna badge status pengiriman mengikuti nilainya. */
function pengirimanBadge(status: string | null): string {
  const s = (status ?? "").trim().toUpperCase();
  if (s === "SUKSES TERKIRIM" || s === "DONE RTS") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (s.includes("KENDALA") || s === "PROSES RETUR") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (s === "POTENSI KENDALA") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (s === "PERJALANAN" || s === "PENGANTARAN") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function isDone(row: ResiRow): boolean {
  return (
    typeof row.status_followup === "string" &&
    row.status_followup.trim().toUpperCase() === "SUDAH_FOLLOWUP"
  );
}

interface ListResponse {
  data: ResiRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error?: string;
}

export default function MonitoringResiPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("semua");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ResiRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResiRow | null>(null);
  const [catatan, setCatatan] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: tab,
        q: debouncedSearch,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/resi?${params.toString()}`);
      const body = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(body.error || "Gagal memuat resi");
      setRows(body.data ?? []);
      setTotal(body.total ?? 0);
      setTotalPages(body.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat resi");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, tab, page]);

  useEffect(() => {
    // Pengambilan data saat query berubah — kasus kanonis efek.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage();
  }, [fetchPage]);

  const rangeLabel = useMemo(() => {
    if (total === 0) return "0 data";
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, total);
    return `${from}–${to} dari ${total.toLocaleString("id-ID")} resi`;
  }, [page, total]);

  function openFollowUp(row: ResiRow) {
    setSelected(row);
    setCatatan(row.catatan_followup ?? "");
    setSaveError(null);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/resi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, catatan }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveError(body.error || "Gagal menyimpan follow-up");
        return;
      }
      setSelected(null);
      await fetchPage();
    } catch {
      setSaveError("Kesalahan jaringan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "semua", label: "Semua" },
    { key: "belum", label: "Belum Follow Up" },
    { key: "sudah", label: "Sudah Follow Up" },
  ];

  return (
    <div className="space-y-5">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <PackageSearch className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Monitoring Resi
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Pantau status pengiriman dan tindak lanjut follow-up resi agen.
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-2 text-center ring-1 ring-white/20 backdrop-blur">
            <p className="text-2xl font-extrabold text-cyan-300">
              {total.toLocaleString("id-ID")}
            </p>
            <p className="text-[11px] font-semibold tracking-wider text-blue-100 uppercase">
              Total Resi
            </p>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="cf-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari no resi atau nama loket…"
            aria-label="Pencarian resi"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
          />
        </label>
        <div
          role="tablist"
          aria-label="Filter status follow-up"
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
              className={cn(
                "cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                tab === t.key
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void fetchPage()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
          Muat Ulang
        </button>
      </section>

      {/* Tabel */}
      <section className="cf-card overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <CircleAlert className="size-10 text-red-400" aria-hidden />
            <div>
              <p className="font-semibold text-slate-900">Gagal memuat resi</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchPage()}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Coba Lagi
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                  <th scope="col" className="px-4 py-3 font-semibold">No Resi</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Agen / Loket</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Kurir</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status Pengiriman</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status Follow Up</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Catatan / Pelaksana</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-slate-100" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                      {tab === "semua" && debouncedSearch === ""
                        ? "Belum ada data resi."
                        : "Tidak ada resi yang cocok dengan filter."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const done = isDone(row);
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-slate-100 transition-colors last:border-0 hover:bg-cyan-50/60"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                          {row.no_resi}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {text(row.agen)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {text(row.layanan)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
                              pengirimanBadge(row.status_resi)
                            )}
                          >
                            {text(row.status_resi)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {done ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="size-3" aria-hidden />
                              SUDAH FOLLOW UP
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              BELUM FOLLOW UP
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <span className="block max-w-56 truncate" title={row.catatan_followup ?? ""}>
                            {row.catatan_followup?.trim() || "—"}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {row.followed_up_by?.trim()
                              ? `${row.followed_up_by} • ${formatDateTime(row.followed_up_at)}`
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openFollowUp(row)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                          >
                            <PhoneCall className="size-3.5" aria-hidden />
                            Tandai Follow Up
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginasi */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">{rangeLabel}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              aria-label="Halaman sebelumnya"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span aria-live="polite" className="min-w-24 px-2 text-center text-xs font-semibold text-slate-700">
              Hal {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              aria-label="Halaman berikutnya"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {/* Modal follow-up */}
      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            {selected && (
              <>
                <div className="mb-1 flex items-start justify-between gap-3">
                  <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                    Tandai Follow Up
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Tutup"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <p className="mb-4 text-sm text-slate-500">
                  <span className="font-mono font-bold text-blue-700">{selected.no_resi}</span>
                  {" • "}
                  {text(selected.agen)}
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    Catatan follow up
                  </span>
                  <textarea
                    value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="cth: Sudah dihubungi, janji kirim besok pagi…"
                    className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                  />
                </label>
                <p className="mt-2 text-[11px] text-slate-400">
                  Menyimpan mengubah status menjadi SUDAH_FOLLOWUP beserta nama
                  dan waktu eksekusi Anda.
                </p>
                {saveError && (
                  <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {saveError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {saving ? "Menyimpan…" : "Simpan Follow Up"}
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
