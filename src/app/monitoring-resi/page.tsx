"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  History,
  Info,
  Loader2,
  PackageSearch,
  PhoneCall,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { ResiRow } from "@/core/services/resiService";
import {
  parseHistoryLog,
  parseResiCopasText,
  RESI_PAGE_SIZE_OPTIONS,
  RESI_STATUS_CHOICES,
  type ResiStatusChoice,
} from "@/core/services/resiService";
import { cn } from "@/lib/utils";

type FilterTab = "semua" | "belum" | "sudah" | "selesai";

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

/** Status follow-up ternormalisasi untuk badge & dropdown. */
function followUpState(row: ResiRow): "BELUM_FOLLOWUP" | "PROSES_FOLLOWUP" | "SUDAH_FOLLOWUP" {
  const s = (row.status_followup ?? "").trim().toUpperCase();
  if (s === "SUDAH_FOLLOWUP") return "SUDAH_FOLLOWUP";
  if (s === "PROSES_FOLLOWUP") return "PROSES_FOLLOWUP";
  return "BELUM_FOLLOWUP";
}

/** Nilai terpilih dropdown status: SELESAI bila flag is_selesai aktif. */
function statusChoice(row: ResiRow): ResiStatusChoice {
  if (isSelesai(row)) return "SELESAI";
  return followUpState(row);
}

function toDateInputValue(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Sel catatan dengan riwayat expandable (entri terbaru + hitungan). */
function HistoryCell({ log }: { log: string | null }) {
  const entries = parseHistoryLog(log);
  if (entries.length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  if (entries.length === 1) {
    return (
      <span className="block max-w-56 truncate" title={entries[0]}>
        {entries[0]}
      </span>
    );
  }
  return (
    <details className="max-w-64">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="block truncate" title={entries[0]}>
          {entries[0]}
        </span>
        <span className="mt-0.5 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-px text-[10px] font-semibold text-cyan-700">
          Riwayat ({entries.length})
        </span>
      </summary>
      <ol className="mt-1.5 space-y-1.5 border-l-2 border-cyan-200 pl-2">
        {entries.map((entry, i) => (
          <li
            key={i}
            className={cn(
              "break-words whitespace-pre-wrap",
              i > 0 && "text-slate-400"
            )}
          >
            {entry}
          </li>
        ))}
      </ol>
    </details>
  );
}

function isSelesai(row: ResiRow): boolean {
  return (
    typeof row.is_selesai === "string" &&
    row.is_selesai.trim().toUpperCase() === "SELESAI"
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
  const [pageSize, setPageSize] = useState<number>(50);
  const [rows, setRows] = useState<ResiRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResiRow | null>(null);
  const [catatan, setCatatan] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "single"; row: ResiRow } | { kind: "bulk"; count: number } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    row: ResiRow;
    choice: ResiStatusChoice;
  } | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
      setSelectedIds(new Set());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(async (pageOverride?: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: tab,
        q: debouncedSearch,
        page: String(pageOverride ?? page),
        pageSize: String(pageSize),
      });
      if (startDate !== "") params.set("startDate", startDate);
      if (endDate !== "") params.set("endDate", endDate);
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
  }, [debouncedSearch, tab, page, pageSize, startDate, endDate]);

  useEffect(() => {
    // Pengambilan data saat query berubah — kasus kanonis efek.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage();
  }, [fetchPage]);

  // Toast sukses impor otomatis hilang 5 detik.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Pratinjau parse sisi-client (validasi cepat sebelum kirim). */
  const pastePreview = useMemo(() => {
    if (pasteText.trim() === "") return { items: [], skipped: 0, error: null as string | null };
    try {
      const { items, skipped } = parseResiCopasText(pasteText);
      return { items, skipped, error: null as string | null };
    } catch (err) {
      return {
        items: [],
        skipped: 0,
        error: err instanceof Error ? err.message : "Teks tidak dapat diproses",
      };
    }
  }, [pasteText]);

  function openImport() {
    setPasteText("");
    setImportError(null);
    setImportOpen(true);
  }

  async function handleImportSave() {
    if (pastePreview.items.length === 0 || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      // Kirim per chunk 200 baris agar payload tetap ringan.
      const CHUNK = 200;
      let inserted = 0;
      let updated = 0;
      for (let i = 0; i < pastePreview.items.length; i += CHUNK) {
        const chunk = pastePreview.items.slice(i, i + CHUNK);
        const res = await fetch("/api/resi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk }),
        });
        const body = (await res.json()) as {
          error?: string;
          inserted?: number;
          updated?: number;
        };
        if (!res.ok) throw new Error(body.error || "Gagal mengimpor resi");
        inserted += body.inserted ?? 0;
        updated += body.updated ?? 0;
      }
      setImportOpen(false);
      setPasteText("");
      setToast(
        updated > 0
          ? `Berhasil menambahkan ${inserted} data resi baru dan memperbarui ${updated} resi!`
          : `Berhasil menambahkan ${inserted} data resi baru!`
      );
      setPage(1);
      await fetchPage(1);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Gagal mengimpor resi");
    } finally {
      setImporting(false);
    }
  }

  const rangeLabel = useMemo(() => {
    if (total === 0) return "0 data";
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return `${from}–${to} dari ${total.toLocaleString("id-ID")} resi`;
  }, [page, pageSize, total]);

  function openFollowUp(row: ResiRow) {
    setSelected(row);
    // Input selalu kosong; riwayat lama tampil read-only di bawahnya.
    setCatatan("");
    setSaveError(null);
  }

  /** Riwayat catatan resi terpilih (read-only, terbaru dulu). */
  const followUpHistory = selected ? parseHistoryLog(selected.catatan_followup) : [];

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

  function clearSelection() {
    setSelectedIds(new Set());
  }

  /** Set tanggal mulai; geser tanggal selesai bila rentang terbalik. */
  function setFrom(value: string) {
    setStartDate(value);
    setPage(1);
    clearSelection();
    if (value !== "" && endDate !== "" && value > endDate) {
      setEndDate(value);
    }
  }

  /** Set tanggal selesai; geser tanggal mulai bila rentang terbalik. */
  function setTo(value: string) {
    setEndDate(value);
    setPage(1);
    clearSelection();
    if (value !== "" && startDate !== "" && value < startDate) {
      setStartDate(value);
    }
  }

  function applyPreset(kind: "today" | "week" | "month" | "reset") {
    if (kind === "reset") {
      setStartDate("");
      setEndDate("");
      setPage(1);
      clearSelection();
      return;
    }
    const today = new Date();
    const end = toDateInputValue(today);
    const start =
      kind === "today"
        ? end
        : kind === "week"
          ? toDateInputValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6))
          : toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
    setStartDate(start);
    setEndDate(end);
    setPage(1);
    clearSelection();
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const pageIds = rows.map((r) => r.id);
      const allSelected = pageIds.length > 0 && pageIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of pageIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const ids =
        deleteTarget.kind === "single"
          ? [deleteTarget.row.id]
          : [...selectedIds];
      const res = await fetch("/api/resi", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = (await res.json()) as { error?: string; deleted?: number };
      if (!res.ok) throw new Error(body.error || "Gagal menghapus resi");
      const count = body.deleted ?? ids.length;
      setDeleteTarget(null);
      clearSelection();
      setToast(
        deleteTarget.kind === "single"
          ? `Resi ${deleteTarget.row.no_resi} berhasil dihapus!`
          : `Berhasil menghapus ${count} resi!`
      );
      setPage(1);
      await fetchPage(1);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus resi");
    } finally {
      setDeleting(false);
    }
  }

  function openStatusChange(row: ResiRow, choice: ResiStatusChoice) {
    setStatusTarget({ row, choice });
    setStatusNote(choice === "SELESAI" ? "" : (row.catatan_followup ?? ""));
    setStatusError(null);
  }

  async function handleStatusSave() {
    if (!statusTarget || statusSaving) return;
    if (statusTarget.choice === "SELESAI" && statusNote.trim() === "") {
      setStatusError("Catatan wajib diisi untuk status SELESAI");
      return;
    }
    setStatusSaving(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/resi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: statusTarget.row.id,
          status: statusTarget.choice,
          catatan: statusNote,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatusError(body.error || "Gagal memperbarui status");
        return;
      }
      const noResi = statusTarget.row.no_resi;
      setStatusTarget(null);
      setToast(`Status resi ${noResi} berhasil diperbarui!`);
      await fetchPage();
    } catch {
      setStatusError("Kesalahan jaringan. Coba lagi.");
    } finally {
      setStatusSaving(false);
    }
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "semua", label: "Semua" },
    { key: "belum", label: "Belum Follow Up" },
    { key: "sudah", label: "Sudah Follow Up" },
    { key: "selesai", label: "Selesai" },
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
                setSelectedIds(new Set());
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
          onClick={openImport}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <ClipboardPaste className="size-4" aria-hidden />
          Import / Copas Text
        </button>
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

      {/* Filter tanggal + aksi bulk */}
      <section className="cf-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            Dari
            <input
              type="date"
              value={startDate}
              max={endDate !== "" ? endDate : undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Tanggal mulai"
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            Sampai
            <input
              type="date"
              value={endDate}
              min={startDate !== "" ? startDate : undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Tanggal selesai"
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "today", label: "Hari Ini" },
              { key: "week", label: "7 Hari Terakhir" },
              { key: "month", label: "Bulan Ini" },
              { key: "reset", label: "Reset Filter" },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
          <p
            className="inline-flex items-center gap-1.5 text-xs text-slate-500"
            title="Resi berstatus SELESAI/Delivered/Retur otomatis terhapus 2 hari setelah ditutup"
          >
            <Info className="size-3.5 shrink-0 text-slate-400" aria-hidden />
            Resi SELESAI/Delivered/Retur terhapus otomatis 2 hari setelah ditutup.
          </p>
          {(startDate !== "" || endDate !== "") && (
            <p className="text-xs font-medium text-slate-500" aria-live="polite">
              {startDate !== "" && endDate !== ""
                ? `Periode ${startDate} – ${endDate}`
                : startDate !== ""
                  ? `Sejak ${startDate}`
                  : `Sampai ${endDate}`}
            </p>
          )}
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setDeleteTarget({ kind: "bulk", count: selectedIds.size });
                setDeleteError(null);
              }}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:bg-red-500"
            >
              <Trash2 className="size-4" aria-hidden />
              Hapus Terpilih ({selectedIds.size})
            </button>
          )}
        </div>
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
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                      onChange={toggleSelectAll}
                      aria-label="Pilih semua resi di halaman ini"
                      className="size-4 cursor-pointer rounded border-slate-300 accent-cyan-600"
                    />
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">No Resi</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Agen / Loket</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Kurir</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status Pengiriman</th>
                  <th
                    scope="col"
                    className="px-4 py-3 font-semibold"
                    title="Catatan berisi deliv/delivered/retur otomatis menutup resi (SELESAI). Resi tertutup terhapus otomatis setelah 2 hari."
                  >
                    Status Follow Up
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">Catatan / Pelaksana</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-slate-100" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
                      {tab === "semua" && debouncedSearch === ""
                        ? "Belum ada data resi."
                        : "Tidak ada resi yang cocok dengan filter."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const fuState = followUpState(row);
                    const selesai = isSelesai(row);
                    const checked = selectedIds.has(row.id);
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-slate-100 transition-colors last:border-0 hover:bg-cyan-50/60"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(row.id)}
                            aria-label={`Pilih resi ${row.no_resi}`}
                            className="size-4 cursor-pointer rounded border-slate-300 accent-cyan-600"
                          />
                        </td>
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
                          <div className="flex flex-wrap items-center gap-1.5">
                            {fuState === "SUDAH_FOLLOWUP" ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 className="size-3" aria-hidden />
                                SUDAH FOLLOW UP
                              </span>
                            ) : fuState === "PROSES_FOLLOWUP" ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                <Loader2 className="size-3" aria-hidden />
                                PROSES FOLLOW UP
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                BELUM FOLLOW UP
                              </span>
                            )}
                            {selesai && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                                <CheckCircle2 className="size-3" aria-hidden />
                                SELESAI
                              </span>
                            )}
                          </div>
                          <select
                            value={statusChoice(row)}
                            onChange={(e) =>
                              openStatusChange(row, e.target.value as ResiStatusChoice)
                            }
                            aria-label={`Ubah status resi ${row.no_resi}`}
                            className="mt-1.5 w-full max-w-44 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                          >
                            {RESI_STATUS_CHOICES.map((c) => (
                              <option key={c} value={c}>
                                {c === "BELUM_FOLLOWUP"
                                  ? "Belum Follow Up"
                                  : c === "PROSES_FOLLOWUP"
                                    ? "Proses Follow Up"
                                    : c === "SUDAH_FOLLOWUP"
                                      ? "Sudah Follow Up"
                                      : "Selesai"}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <HistoryCell log={row.catatan_followup} />
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {row.followed_up_by?.trim()
                              ? `${row.followed_up_by} • ${formatDateTime(row.followed_up_at)}`
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openFollowUp(row)}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition-opacity hover:opacity-90"
                            >
                              <PhoneCall className="size-3.5" aria-hidden />
                              Tandai Follow Up
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTarget({ kind: "single", row });
                                setDeleteError(null);
                              }}
                              aria-label={`Hapus resi ${row.no_resi}`}
                              title="Hapus resi"
                              className="cursor-pointer rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </div>
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium text-slate-500">{rangeLabel}</p>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              Tampilkan
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Jumlah data per halaman"
                className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 focus:outline-none"
              >
                {RESI_PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
                    Catatan Follow Up Baru
                  </span>
                  <textarea
                    value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Ketik catatan baru di sini… (cth: Sudah dihubungi, janji kirim besok pagi)"
                    className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                  />
                </label>
                <p className="mt-2 text-[11px] text-slate-400">
                  Menyimpan mengubah status menjadi SUDAH_FOLLOWUP beserta nama
                  dan waktu eksekusi Anda. Catatan berisi deliv/delivered/retur
                  otomatis menutup resi (SELESAI).
                </p>
                {followUpHistory.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <History className="size-3.5" aria-hidden />
                      Riwayat Catatan Sebelumnya ({followUpHistory.length})
                    </p>
                    <div
                      aria-readonly="true"
                      className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-100 p-3"
                    >
                      {followUpHistory.map((entry, i) => (
                        <div key={i}>
                          {i > 0 && <hr className="mb-2 border-slate-300" />}
                          <p className="font-mono text-xs break-words whitespace-pre-wrap text-slate-700">
                            {entry}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

      {/* Modal import copas data resi baru */}
      <Dialog.Root
        open={importOpen}
        onOpenChange={(open) => {
          if (!open && !importing) setImportOpen(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                Import Copas Data Resi Baru
              </Dialog.Title>
              <Dialog.Close
                aria-label="Tutup"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
            <p className="mb-4 text-sm text-slate-500">
              Tempel hasil copy dari Excel/Spreadsheet (TAB atau koma). Baris
              header terdeteksi otomatis. Format:{" "}
              <span className="font-mono text-xs font-semibold text-blue-700">
                Tgl Tiket | No. Resi | Agen | Kode Layanan | Petugas | Status | Selesai
              </span>
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Data copas
              </span>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={9}
                placeholder={"22/09/2026 20:24:04\tP2609140044492\tMUC SWEET\tPKH\tCS1 MUCSWEET\tPERJALANAN\tBELUM"}
                className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
              />
            </label>
            <p className="mt-2 text-xs font-medium text-slate-500" aria-live="polite">
              {pastePreview.error
                ? pastePreview.error
                : `${pastePreview.items.length} baris valid${pastePreview.skipped > 0 ? ` • ${pastePreview.skipped} dilewati (header/kosong/duplikat)` : ""}`}
            </p>
            {importError && (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {importError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close
                disabled={importing}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void handleImportSave()}
                disabled={importing || pastePreview.items.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {importing && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {importing ? "Memproses…" : "Proses & Simpan"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal konfirmasi hapus (satuan & bulk) */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            {deleteTarget && (
              <>
                <div className="mb-1 flex items-start justify-between gap-3">
                  <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                    Hapus Resi
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Tutup"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <p className="mb-4 text-sm text-slate-500">
                  {deleteTarget.kind === "single" ? (
                    <>
                      Apakah Anda yakin ingin menghapus resi{" "}
                      <span className="font-mono font-bold text-blue-700">
                        {deleteTarget.row.no_resi}
                      </span>
                      ? Tindakan ini tidak dapat dibatalkan.
                    </>
                  ) : (
                    <>
                      Apakah Anda yakin ingin menghapus{" "}
                      <span className="font-bold text-slate-900">
                        {deleteTarget.count} resi terpilih
                      </span>
                      ? Tindakan ini tidak dapat dibatalkan.
                    </>
                  )}
                </p>
                {deleteError && (
                  <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {deleteError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Dialog.Close
                    disabled={deleting}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Batal
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={() => void handleDeleteConfirm()}
                    disabled={deleting}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:bg-red-500 disabled:opacity-60"
                  >
                    {deleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {deleting ? "Menghapus…" : "Ya, Hapus"}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal cepat ubah status + catatan */}
      <Dialog.Root
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open && !statusSaving) setStatusTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            {statusTarget && (
              <>
                <div className="mb-1 flex items-start justify-between gap-3">
                  <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                    Ubah Status Resi
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Tutup"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <p className="mb-4 text-sm text-slate-500">
                  <span className="font-mono font-bold text-blue-700">
                    {statusTarget.row.no_resi}
                  </span>
                  {" • "}
                  {text(statusTarget.row.agen)}
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    Status baru
                  </span>
                  <select
                    value={statusTarget.choice}
                    onChange={(e) => {
                      const choice = e.target.value as ResiStatusChoice;
                      setStatusTarget({ row: statusTarget.row, choice });
                      setStatusError(null);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                  >
                    {RESI_STATUS_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {c === "BELUM_FOLLOWUP"
                          ? "Belum Follow Up"
                          : c === "PROSES_FOLLOWUP"
                            ? "Proses Follow Up"
                            : c === "SUDAH_FOLLOWUP"
                              ? "Sudah Follow Up"
                              : "Selesai"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    Catatan follow up
                    {statusTarget.choice === "SELESAI" && (
                      <span className="text-red-600"> (wajib)</span>
                    )}
                  </span>
                  <textarea
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder={
                      statusTarget.choice === "SELESAI"
                        ? "cth: Paket diterima pembeli, resi selesai…"
                        : "cth: Sedang dihubungi via WA… (opsional)"
                    }
                    className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                  />
                </label>
                <p className="mt-2 text-[11px] text-slate-400">
                  Menyimpan mencatat nama dan waktu eksekusi Anda pada resi
                  ini. Catatan berisi deliv/delivered/retur otomatis menutup
                  resi (SELESAI).
                </p>
                {statusError && (
                  <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {statusError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleStatusSave()}
                  disabled={statusSaving}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {statusSaving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {statusSaving ? "Menyimpan…" : "Simpan Status"}
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Toast sukses impor */}
      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-200 bg-white p-4 shadow-2xl shadow-emerald-900/10"
        >
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{toast}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Tabel dimuat ulang otomatis.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Tutup notifikasi"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
