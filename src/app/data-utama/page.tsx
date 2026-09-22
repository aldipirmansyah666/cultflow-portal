"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileWarning,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  User,
  X,
} from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  DATA_UTAMA_FIELD_COUNT,
  DATA_UTAMA_FIELD_GROUPS,
  getDataUtamaList,
  getRegionalOptions,
  type DataUtamaRow,
} from "@/core/services/dataUtamaService";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
}

function displayLoket(row: DataUtamaRow): string {
  return (
    row.nama_loket_kurlog?.trim() ||
    row.nama_loket_onpays?.trim() ||
    "—"
  );
}

/** Satu sel nilai di drawer detail: boolean jadi badge, kosong jadi strip. */
function FieldValue({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
          value
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-50 text-slate-500"
        )}
      >
        {value ? "Ya" : "Tidak"}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-sm text-slate-800">{value}</span>;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return <span className="text-sm text-slate-300">—</span>;
  return <span className="text-sm break-words text-slate-800">{text}</span>;
}

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

export default function DataUtamaPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [regional, setRegional] = useState("SEMUA");
  const [regionals, setRegionals] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DataUtamaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DataUtamaRow | null>(null);

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
      const client = getSupabaseBrowser();
      const result = await getDataUtamaList(client, {
        search: debouncedSearch,
        regional,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memuat data. Coba lagi."
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, regional, page]);

  useEffect(() => {
    // Pengambilan data saat query (search/regional/page) berubah —
    // kasus kanonis efek sinkronisasi data dari server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage();
  }, [fetchPage]);

  // Opsi regional dimuat sekali (tidak bergantung pada filter aktif).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getSupabaseBrowser();
        const options = await getRegionalOptions(client);
        if (!cancelled) setRegionals(options);
      } catch {
        if (!cancelled) setRegionals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeLabel = useMemo(() => {
    if (total === 0) return "0 data";
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, total);
    return `${from}–${to} dari ${total.toLocaleString("id-ID")} agen`;
  }, [page, total]);

  const selectedTitle = selected ? displayLoket(selected) : "";

  return (
    <div className="space-y-5">
      {/* Banner Steel Blue -> Cyan */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(255 255 255 / 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.25) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
            <Database className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Data Lengkap Utama
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Direktori agen Kurlog (sheet Agen CUM) — cari PPID, nama loket,
              atau pemilik secara real-time.
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-2 text-center ring-1 ring-white/20 backdrop-blur">
            <p className="text-2xl font-extrabold text-cyan-300">
              {total.toLocaleString("id-ID")}
            </p>
            <p className="text-[11px] font-semibold tracking-wider text-blue-100 uppercase">
              Total Agen
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
            placeholder="Cari nama loket, PPID, atau nama pemilik…"
            aria-label="Pencarian agen"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-slate-400" aria-hidden />
          <span className="sr-only">Filter regional</span>
          <select
            value={regional}
            onChange={(e) => {
              setRegional(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 focus:outline-none"
          >
            <option value="SEMUA">Semua Regional</option>
            {regionals.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void fetchPage()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw
            className={cn("size-4", loading && "animate-spin")}
            aria-hidden
          />
          Muat Ulang
        </button>
      </section>

      {/* Tabel */}
      <section className="cf-card overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <FileWarning className="size-10 text-red-400" aria-hidden />
            <div>
              <p className="font-semibold text-slate-900">Gagal memuat data</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">{error}</p>
              {error.includes("NEXT_PUBLIC_SUPABASE") && (
                <p className="mt-2 max-w-md text-xs text-slate-400">
                  Isi NEXT_PUBLIC_SUPABASE_URL dan
                  NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local lalu jalankan
                  ulang dev server.
                </p>
              )}
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
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    PPID
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Nama Loket
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Pemilik
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Regional
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    KCU / KC
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Status Syarat
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-slate-100" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      Tidak ada agen yang cocok. Ubah kata kunci atau filter
                      regional.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelected(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setSelected(row);
                      }}
                      tabIndex={0}
                      className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-cyan-50/60 focus:bg-cyan-50/60 focus:outline-none"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                        {row.ppid?.trim() || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                          <Building2
                            className="size-3.5 shrink-0 text-cyan-600"
                            aria-hidden
                          />
                          {displayLoket(row)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <User
                            className="size-3.5 shrink-0 text-slate-400"
                            aria-hidden
                          />
                          {row.nama_pemilik?.trim() || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.regional?.trim() ? (
                          <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            {row.regional}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.kcu_kc?.trim() || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.status_syarat?.trim() || "—"}
                      </td>
                    </tr>
                  ))
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
            <span
              aria-live="polite"
              className="min-w-24 px-2 text-center text-xs font-semibold text-slate-700"
            >
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

      {/* Drawer detail */}
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
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl focus:outline-none"
          >
            {selected && (
              <>
                <div className="bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-5 text-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Dialog.Title className="truncate text-lg font-extrabold tracking-tight">
                        {selectedTitle}
                      </Dialog.Title>
                      <p className="mt-1 font-mono text-xs text-cyan-300">
                        PPID: {selected.ppid?.trim() || "—"}
                        {selected.no != null && ` · No: ${selected.no}`}
                      </p>
                    </div>
                    <Dialog.Close
                      aria-label="Tutup detail"
                      className="rounded-lg p-1.5 text-blue-100 hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-5" aria-hidden />
                    </Dialog.Close>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {selected.nama_pemilik?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/20">
                        <User className="size-3" aria-hidden />
                        {selected.nama_pemilik}
                      </span>
                    )}
                    {selected.regional?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/20">
                        <MapPin className="size-3" aria-hidden />
                        {selected.regional}
                      </span>
                    )}
                    {selected.no_hp_loket?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/20">
                        <Phone className="size-3" aria-hidden />
                        {selected.no_hp_loket}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <p className="mb-4 text-xs font-medium text-slate-500">
                    {DATA_UTAMA_FIELD_COUNT} bidang · terorganisir per kategori
                  </p>
                  <div className="space-y-5">
                    {DATA_UTAMA_FIELD_GROUPS.map((group) => (
                      <section
                        key={group.title}
                        className="overflow-hidden rounded-xl border border-slate-200"
                      >
                        <h3 className="border-b border-slate-200 bg-gradient-to-r from-slate-900 to-blue-800 px-4 py-2 text-xs font-bold tracking-wider text-cyan-300 uppercase">
                          {group.title}
                        </h3>
                        <dl className="divide-y divide-slate-100">
                          {group.fields.map((field) => (
                            <div
                              key={field.key}
                              className="grid grid-cols-[160px_1fr] gap-3 px-4 py-2 sm:grid-cols-[200px_1fr]"
                            >
                              <dt className="text-xs font-medium text-slate-500">
                                {field.label}
                              </dt>
                              <dd className="min-w-0">
                                {field.key === "created_at" ? (
                                  <span className="text-sm text-slate-800">
                                    {formatDate(
                                      selected.created_at as string | null
                                    )}
                                  </span>
                                ) : (
                                  <FieldValue
                                    value={selected[field.key] as unknown}
                                  />
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {loading && rows.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-slate-400" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Memuat…
        </p>
      )}
    </div>
  );
}
