"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Check,
  Copy,
  Loader2,
  Printer,
  RotateCcw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  buildLookupWaText,
  lookupAgenByPpid,
  suggestAgen,
  toAgenProfile,
  type AgenProfile,
  type AgenSuggestItem,
} from "@/core/services/dataUtamaService";
import { cn } from "@/lib/utils";

const SUGGEST_DEBOUNCE_MS = 300;
const SUGGEST_MIN_CHARS = 2;

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; profile: AgenProfile }
  | { kind: "not-found"; keyword: string }
  | { kind: "error"; message: string };

/** Badge logo PosIND (mark CSS, oranye khas Pos Indonesia). */
function PosIndLogo() {
  return (
    <span
      aria-label="Logo PosIND"
      role="img"
      className="flex shrink-0 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-700 px-3 py-2 shadow-sm shadow-orange-600/30"
    >
      <span className="text-xl leading-none font-black tracking-tight text-white italic">
        POS
      </span>
      <span className="mt-0.5 text-[9px] leading-none font-bold tracking-[0.18em] text-orange-100">
        INDONESIA
      </span>
    </span>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[150px_12px_1fr] items-baseline gap-1 py-1 sm:grid-cols-[210px_12px_1fr]">
      <dt className="text-[13px] font-medium text-slate-600">{label}</dt>
      <dd aria-hidden className="text-[13px] text-slate-400">
        :
      </dd>
      <dd className="min-w-0 text-[13px] font-semibold break-words text-slate-900">
        {value === "" ? <span className="font-normal text-slate-300">—</span> : value}
      </dd>
    </div>
  );
}

function fieldEntries(profile: AgenProfile): [string, string][] {
  return [
    ["Nopend/Kode Dirian", profile.nopend],
    ["IdLoc", profile.idLoc],
    ["User", profile.user],
    ["Pass", profile.pass],
    ["Nama Agenpos", profile.namaAgenpos],
    ["Alamat Agenpos", profile.alamatAgenpos],
    ["Kelurahan", profile.kelurahan],
    ["Kecamatan", profile.kecamatan],
    ["Kota/Kab", profile.kotaKab],
    ["Nama Pemilik/Pengelola", profile.namaPemilik],
    ["No Handphone", profile.noHandphone],
    ["Email", profile.email],
    ["NIK", profile.nik],
    ["NPWP", profile.npwp],
  ];
}

export default function LookupAgenPage() {
  return (
    <Suspense
      fallback={
        <div className="cf-card p-10 text-center text-sm text-slate-500">
          Memuat lookup agen…
        </div>
      }
    >
      <LookupAgenView />
    </Suspense>
  );
}

function LookupAgenView() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("query") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [suggests, setSuggests] = useState<AgenSuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoRan = useRef(false);

  // Auto-suggest real-time (debounce) via PPID / nama loket.
  // Reset sinkron ditangani di handleQueryChange; efek ini hanya
  // menjadwalkan fetch async (setState di dalam callback = aman).
  useEffect(() => {
    if (query.trim().length < SUGGEST_MIN_CHARS) return;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const client = getSupabaseBrowser();
          const items = await suggestAgen(client, query);
          setSuggests(items);
          setSuggestOpen(true);
        } catch {
          setSuggests([]);
          setSuggestOpen(false);
        } finally {
          setSuggestLoading(false);
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    const active = value.trim().length >= SUGGEST_MIN_CHARS;
    setSuggestOpen(false);
    setSuggestLoading(active);
    if (!active) setSuggests([]);
  }

  // Deep-link ?query= dari Dashboard: jalankan sekali saat mount.
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (initialQuery.trim() !== "") {
      void runLookup(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runLookup(keyword: string) {
    const key = keyword.trim();
    if (key === "") return;
    setSuggestOpen(false);
    setStatus({ kind: "loading" });
    setCopied(false);
    try {
      const client = getSupabaseBrowser();
      const row = await lookupAgenByPpid(client, key);
      if (!row) {
        setStatus({ kind: "not-found", keyword: key });
        return;
      }
      setStatus({ kind: "found", profile: toAgenProfile(row) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lookup gagal. Coba lagi.";
      setStatus({ kind: "error", message });
    }
  }

  function reset() {
    setQuery("");
    setSuggests([]);
    setSuggestOpen(false);
    setStatus({ kind: "idle" });
    setCopied(false);
    inputRef.current?.focus();
  }

  async function copyWaText(profile: AgenProfile) {
    const text = buildLookupWaText(profile);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const profile = status.kind === "found" ? status.profile : null;

  return (
    <div className="space-y-5">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8 print:hidden">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Search className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Lookup Profil Agen PosIND
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Cari PPID atau nama loket untuk menampilkan formulir profil
              agenpos siap salin &amp; cetak.
            </p>
          </div>
        </div>
      </section>

      {/* Search */}
      <section className="cf-card relative p-4 sm:p-5 print:hidden">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => {
                if (suggests.length > 0) setSuggestOpen(true);
              }}
              onBlur={() => {
                // Tunda agar klik saran (mousedown) sempat diproses.
                setTimeout(() => setSuggestOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runLookup(query);
                if (e.key === "Escape") setSuggestOpen(false);
              }}
              placeholder="Masukkan PPID Lengkap / Kode PPID..."
              aria-label="Pencarian PPID atau nama loket"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-9 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2">
              {suggestLoading ? (
                <Loader2 className="size-4 animate-spin text-cyan-600" aria-hidden />
              ) : (
                query !== "" && (
                  <button
                    type="button"
                    onClick={() => handleQueryChange("")}
                    aria-label="Bersihkan pencarian"
                    className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )
              )}
            </span>
            {suggestOpen && suggests.length > 0 && (
              <ul
                role="listbox"
                aria-label="Saran agen"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10"
              >
                {suggests.map((item) => (
                  <li key={`${item.ppid}||${item.nama}`} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const key = item.ppid !== "" ? item.ppid : item.nama;
                        handleQueryChange(key);
                        void runLookup(key);
                      }}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-cyan-50"
                    >
                      <span className="shrink-0 font-mono text-xs font-bold text-blue-700">
                        {item.ppid === "" ? "—" : item.ppid}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                        {item.nama}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runLookup(query)}
              disabled={query.trim() === "" || status.kind === "loading"}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-none"
            >
              {status.kind === "loading" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Search className="size-4" aria-hidden />
              )}
              Cari Data
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset
            </button>
          </div>
        </div>
      </section>

      {/* Loading */}
      {status.kind === "loading" && (
        <div className="cf-card flex items-center justify-center gap-2 p-10 text-sm text-slate-500" role="status">
          <Loader2 className="size-5 animate-spin text-cyan-600" aria-hidden />
          Mencari data agen…
        </div>
      )}

      {/* Error */}
      {status.kind === "error" && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
          <p className="text-sm font-bold text-red-700">Lookup gagal</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-red-600">{status.message}</p>
          {status.message.includes("NEXT_PUBLIC_SUPABASE") && (
            <p className="mx-auto mt-2 max-w-md text-xs text-red-500">
              Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di
              .env.local lalu jalankan ulang dev server.
            </p>
          )}
        </div>
      )}

      {/* Empty state */}
      {status.kind === "not-found" && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white py-16 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
            <SearchX className="h-7 w-7 text-slate-400" aria-hidden />
          </span>
          <p className="text-sm font-semibold text-slate-900">
            Data PPID tidak ditemukan
          </p>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
            Tidak ada agen dengan PPID/nama &ldquo;{status.keyword}&rdquo;.
            Periksa kembali kode atau gunakan saran otomatis saat mengetik.
          </p>
        </div>
      )}

      {/* Card hasil format kertas PosIND */}
      {profile && (
        <>
          <section
            aria-label="Formulir profil agenpos"
            className="print-paper overflow-hidden rounded-2xl border-2 border-slate-800 bg-white shadow-lg shadow-slate-900/10"
          >
            {/* Header card */}
            <div className="flex items-center gap-3 border-b-2 border-slate-800 bg-slate-50 px-4 py-3 sm:px-6">
              <PosIndLogo />
              <span aria-hidden className="h-10 w-px bg-slate-300" />
              <p className="min-w-0 text-sm text-slate-700">
                Masukan PPID Lengkap / Kode PPID :{" "}
                <span className="font-mono text-base font-extrabold tracking-wide text-slate-900">
                  {profile.ppid === "" ? "—" : profile.ppid}
                </span>
              </p>
            </div>

            <div aria-hidden className="border-t border-dashed border-slate-400" />

            {/* Isi form */}
            <dl className="px-4 py-3 sm:px-6">
              {fieldEntries(profile).map(([label, value]) => (
                <FieldRow key={label} label={label} value={value} />
              ))}
            </dl>

            <div aria-hidden className="border-t border-dashed border-slate-400" />

            <p className="px-4 py-2.5 font-mono text-[11px] text-slate-400 sm:px-6">
              Sumber: data_lengkap_utama • CultFlow Workspace
            </p>
          </section>

          {/* Aksi */}
          <section className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              onClick={() => void copyWaText(profile)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90",
                copied
                  ? "bg-emerald-600 shadow-emerald-600/30"
                  : "bg-gradient-to-r from-blue-700 to-cyan-600 shadow-blue-600/30"
              )}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? "Tersalin!" : "📋 Salin Teks Format WA"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <Printer className="size-4" aria-hidden />
              🖨️ Cetak / Simpan PDF
            </button>
          </section>
        </>
      )}
    </div>
  );
}
