"use client";

import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  RotateCcw,
  Scale,
  XCircle,
} from "lucide-react";
import {
  buildReconcileBreakdown,
  EC3_PREFIXES,
  paginateReconcileRows,
  PKH_ACCEPTED_PREFIXES,
  SHARED_PREFIXES_PKH_PJB_PE,
  validateReconcileRows,
  type ReconcileValidationResult,
} from "@/core/parsers/reconcileValidator";
import {
  columnLetter,
  extractReconcileInputRows,
  findReconcileHeader,
  normalizeReconcileRowsFromObjects,
  type DetectedHeader,
  type ReconcileInputRow,
} from "@/core/parsers/reconcileHeader";
import {
  getReconcileFileSizeWarning,
  MAX_RECONCILE_FILE_SIZE_BYTES,
  validateFileSize,
} from "@/lib/fileValidation";
import type { StoredPrefixSuggestion } from "@/core/services/prefixSuggestionService";
import type { ProductPrefixMap } from "@/core/services/productPrefixService";
import { cn } from "@/lib/utils";

/**
 * [H2] Baris hasil validasi per halaman. Hanya baris di halaman ini yang
 * dirender ke DOM — 100 baris ≈ 500 node (aman), sedangkan 20.000 baris
 * ≈ 100.000 node (browser freeze).
 */
const RESULT_PAGE_SIZE = 100;

type SaveState = "idle" | "saving" | "saved" | "failed";

function prefixSuggestionKey(
  productName: string,
  suggestedPrefix: string
): string {
  return `${productName}::${suggestedPrefix}`;
}

function orderedPrefixEntries(
  counts: Record<string, number> | undefined,
  order: readonly string[]
): [string, number][] {
  if (!counts) return [];
  const known = order.filter((prefix) => (counts[prefix] ?? 0) > 0);
  const dynamic = Object.keys(counts)
    .filter((prefix) => !order.includes(prefix) && (counts[prefix] ?? 0) > 0)
    .sort(
      (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b)
    );
  return [...known, ...dynamic].map((prefix) => [prefix, counts[prefix] ?? 0]);
}

function PrefixDetail({
  counts,
  order,
  approvedPrefixes,
}: {
  counts: Record<string, number> | undefined;
  order: readonly string[];
  approvedPrefixes: readonly string[];
}) {
  const entries = orderedPrefixEntries(counts, order);
  if (entries.length === 0) return null;

  const approved = new Set(
    approvedPrefixes.map((prefix) => prefix.trim().toUpperCase())
  );
  return (
    <dd className="flex flex-wrap gap-1.5 font-mono text-[11px]">
      {entries.map(([prefix, count]) => {
        const isApproved = approved.has(prefix);
        return (
          <span
            key={prefix}
            title={
              isApproved
                ? "Prefix tambahan yang disetujui admin"
                : "Prefix bawaan validator"
            }
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1",
              isApproved
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-slate-50 text-slate-500 ring-slate-200"
            )}
          >
            <span className="font-semibold">{prefix}</span>
            <span className="text-slate-400">:</span>
            <span>{count}</span>
            {isApproved && (
              <span className="rounded bg-emerald-600 px-1 py-px text-[9px] font-bold tracking-wide text-white uppercase">
                disetujui
              </span>
            )}
          </span>
        );
      })}
    </dd>
  );
}

/** SHA-256 hex dari isi berkas (Web Crypto; butuh HTTPS atau localhost). */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Browser tidak menyediakan SHA-256. Audit memerlukan HTTPS atau localhost."
    );
  }
  const digest = await subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export default function ReconcilePage() {
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<ReconcileValidationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileSizeWarning, setFileSizeWarning] = useState<string>("");
  const [prefixSyncError, setPrefixSyncError] = useState<string>("");
  const [extraPrefixes, setExtraPrefixes] = useState<ProductPrefixMap>({});
  const [parsing, setParsing] = useState(false);
  const [invalidOnly, setInvalidOnly] = useState(false);
  /**
   * Kolom resi yang terdeteksi (0-based) → dipakai untuk menampilkan
   * alamat sel (mis. "D412") supaya user bisa langsung menuju sel
   * bermasalah di Excel. "" bila header tak terdeteksi (jalur fallback).
   */
  const [resiCol, setResiCol] = useState<number>(-1);
  // [H2] Paginasi hasil validasi: hanya 100 baris per halaman yang dirender.
  const [page, setPage] = useState(1);
  // Filter produk (opsional) untuk mempersempit tabel.
  const [produkFilter, setProdukFilter] = useState<string>("ALL");
  const [auditState, setAuditState] = useState<SaveState>("idle");
  const [auditError, setAuditError] = useState<string>("");
  const [suggestionState, setSuggestionState] = useState<SaveState>("idle");
  const [suggestionError, setSuggestionError] = useState<string>("");
  const [storedSuggestions, setStoredSuggestions] = useState<
    Record<string, StoredPrefixSuggestion>
  >({});
  const [decisionState, setDecisionState] = useState<
    Record<string, SaveState>
  >({});
  const [decisionError, setDecisionError] = useState<string>("");

  /**
   * Baris hasil validasi yang cocok filter (status + produk).
   *
   * [H2] Baris ini TIDAK dirender seluruhnya — hanya satu halaman
   * (`RESULT_PAGE_SIZE` baris) yang masuk DOM. Untuk berkas 20.000+ baris,
   * render utuh menghasilkan ±100.000 node DOM → browser freeze.
   *
   * Catatan: filter di atas BUKAN sumber angka ringkasan — kartu
   * ringkasan tetap memakai `result.summary` (seluruh data hasil
   * validasi), sehingga total valid/error tak pernah terpengaruh filter
   * atau paginasi.
   */
  const filteredRows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter(
      (r) =>
        (!invalidOnly || !r.isValid) &&
        (produkFilter === "ALL" || r.produk === produkFilter)
    );
  }, [result, invalidOnly, produkFilter]);

  // [H2] Paginasi murni: hanya baris satu halaman yang dirender; `total`
  // tetap jumlah seluruh baris yang cocok filter (bukan jumlah di halaman).
  const pageData = useMemo(
    () => paginateReconcileRows(filteredRows, page, RESULT_PAGE_SIZE),
    [filteredRows, page]
  );
  const pageRows = pageData.rows;
  const totalPages = pageData.totalPages;
  const safePage = pageData.page;
  const rangeStart = pageData.rangeStart;
  const rangeEnd = pageData.rangeEnd;

  /** Daftar produk yang muncul di berkas (untuk dropdown filter). */
  const productOptions = useMemo(() => {
    if (!result) return [];
    const set = new Set<string>();
    for (const row of result.rows) {
      if (row.produk !== "") set.add(row.produk);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "id"));
  }, [result]);

  const breakdown = useMemo(
    () =>
      result
        ? buildReconcileBreakdown(result.rows, {
            extraProductPrefixes: extraPrefixes,
          })
        : null,
    [result, extraPrefixes]
  );

  /** Nomor halaman yang ditampilkan (jendela 5 tombol di tengah). */
  function pageNumbers(): number[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const window: number[] = [1, safePage - 1, safePage, safePage + 1, totalPages];
    return [...new Set(window.filter((n) => n >= 1 && n <= totalPages))].sort(
      (a, b) => a - b
    );
  }

  async function loadActivePrefixes(): Promise<ProductPrefixMap> {
    try {
      const res = await fetch("/api/reconcile/prefixes", {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        prefixes?: ProductPrefixMap;
      } | null;
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Gagal memuat prefix aktif (HTTP ${res.status}).`
        );
      }
      if (
        !body?.prefixes ||
        typeof body.prefixes !== "object" ||
        Array.isArray(body.prefixes)
      ) {
        throw new Error("Respons prefix aktif tidak valid.");
      }
      const prefixes = body.prefixes;
      setExtraPrefixes(prefixes);
      setPrefixSyncError("");
      return prefixes;
    } catch (e) {
      setPrefixSyncError(
        e instanceof Error
          ? e.message
          : "Gagal memuat prefix aktif; validasi memakai cache."
      );
      return extraPrefixes;
    }
  }

  async function handleFile(file: File) {
    setParsing(true);
    setParseError(null);
    setFileSizeWarning("");
    setPrefixSyncError("");
    setResult(null);
    setAuditState("idle");
    setAuditError("");
    setSuggestionState("idle");
    setSuggestionError("");
    setStoredSuggestions({});
    setDecisionState({});
    setDecisionError("");
    // Paginasi & filter direset bersama berkas baru.
    setPage(1);
    setProdukFilter("ALL");
    try {
      // [H3] Validasi ukuran SEBELUM berkas dibaca ke memori. Tanpa ini,
      // `file.arrayBuffer()` pada file ratusan MB menghabiskan heap browser
      // (exceljs membuat matriks kedua) → tab crash tanpa pesan.
      const sizeErr = validateFileSize(file, MAX_RECONCILE_FILE_SIZE_BYTES);
      if (sizeErr) {
        setParseError(sizeErr);
        return;
      }
      // Peringatan dini non-blocking: file < 1.000 KB sering berarti ekspor
      // belum lengkap. Validasi tetap dilanjutkan bila admin yakin.
      setFileSizeWarning(getReconcileFileSizeWarning(file) ?? "");
      // Ambil prefix approved paralel dengan pembacaan workbook; validator
      // baru memakainya setelah baris selesai diekstrak.
      const approvedPrefixesPromise = loadActivePrefixes();
      // exceljs dimuat on-demand agar tidak membebani initial load.
      const {
        loadWorkbookFromBuffer,
        matrixToObjects,
        validateMatrixLimits,
        MatrixLimitError,
      } = await import("@/lib/excel");
      const buffer = await file.arrayBuffer();
      const workbook = await loadWorkbookFromBuffer(buffer, {
        defval: null,
        fileName: file.name,
      });
      if (workbook.sheetNames.length === 0)
        throw new Error(`Berkas "${file.name}" tidak berisi sheet.`);
      // Pindai SEMUA sheet (ekspor sistem sering menaruh cover/rekap di
      // sheet pertama): pilih sheet yang menghasilkan baris data terbanyak.
      // Seri -> sheet paling awal.
      let sheetName = "";
      let header: DetectedHeader | null = null;
      let inputRows: ReconcileInputRow[] = [];
      for (const name of workbook.sheetNames) {
        const m = workbook.matrices.get(name) ?? [];
        if (m.length === 0) continue;
        try {
          validateMatrixLimits(m, {
            maxRows: 20030,
            maxCols: 200,
            fileName: file.name,
            sheetName: name,
          });
        } catch (e) {
          // Pesan sudah spesifik (alamat sel + preview + hint) dari excel.ts.
          if (e instanceof MatrixLimitError) throw e;
          throw e;
        }
        const h = findReconcileHeader(m);
        if (!h) continue;
        const rows = extractReconcileInputRows(
          m,
          h,
          workbook.sourceRows.get(name)
        );
        if (rows.length > inputRows.length) {
          sheetName = name;
          header = h;
          inputRows = rows;
        }
      }
      if (!header || inputRows.length === 0) {
        // Fallback porting proyek lama (`normalizeReconcileRows`): baris
        // pertama sebagai kunci objek, cocokkan kunci dengan alias.
        for (const name of workbook.sheetNames) {
          const m = workbook.matrices.get(name) ?? [];
          if (m.length < 2) continue;
          const rows = normalizeReconcileRowsFromObjects(
            matrixToObjects<Record<string, unknown>>(m),
            workbook.sourceRows.get(name)
          );
          if (rows.length > inputRows.length) {
            sheetName = name;
            header = null;
            inputRows = rows;
          }
        }
      }
      if (inputRows.length === 0) {
        const scanned = workbook.sheetNames
          .map((n) => `"${n}" (${(workbook.matrices.get(n) ?? []).length} baris)`)
          .join(", ");
        throw new Error(
          `Kolom Produk dan Nomor Resi ber-data tidak ditemukan di "${file.name}". ` +
            `Sheet dipindai: ${scanned}. ` +
            `Dikenali sebagai produk: produk/product/jenis/layanan/service/tipe; sebagai resi: nomor_resi/no_resi/resi/nomor/AWB/connote/tracking/airwaybill (tak peka huruf besar-kecil). ` +
            `Pastikan salah satu sheet memuat kedua kolom tersebut dengan minimal 1 baris data di bawahnya.`
        );
      }
      setFileName(
        workbook.sheetNames.length > 1
          ? `${file.name} — sheet "${sheetName}"`
          : file.name
      );
      // Kolom resi untuk alamat sel (mis. "D412") di laporan.
      setResiCol(header ? header.resiCol : -1);
      const approvedPrefixes = await approvedPrefixesPromise;
      const validated = validateReconcileRows(inputRows, {
        extraProductPrefixes: approvedPrefixes,
      });
      setResult(validated);
      void saveAudit(file, buffer, validated.summary);
      void savePrefixSuggestions(validated.prefixSuggestions);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Gagal membaca berkas."
      );
    } finally {
      setParsing(false);
    }
  }

  async function saveAudit(
    file: File,
    buffer: ArrayBuffer,
    summary: { total: number; valid: number; invalid: number }
  ) {
    setAuditState("saving");
    setAuditError("");
    try {
      const fileSha256 = await sha256Hex(buffer);
      const res = await fetch("/api/reconcile/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSha256,
          totalRows: summary.total,
          validRows: summary.valid,
          invalidRows: summary.invalid,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Server menolak audit (HTTP ${res.status}).`
        );
      }
      setAuditState("saved");
    } catch (e) {
      setAuditState("failed");
      setAuditError(
        e instanceof Error ? e.message : "Gagal menyimpan audit Reconcile."
      );
    }
  }

  async function savePrefixSuggestions(
    suggestions: ReconcileValidationResult["prefixSuggestions"]
  ) {
    setStoredSuggestions({});
    setDecisionState({});
    setDecisionError("");
    if (suggestions.length === 0) {
      setSuggestionState("idle");
      setSuggestionError("");
      return;
    }

    setSuggestionState("saving");
    setSuggestionError("");
    try {
      const res = await fetch("/api/reconcile/prefix-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        suggestions?: StoredPrefixSuggestion[];
      } | null;
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Server menolak usulan prefix (HTTP ${res.status}).`
        );
      }

      const stored: Record<string, StoredPrefixSuggestion> = {};
      const items = Array.isArray(body?.suggestions)
        ? body.suggestions
        : [];
      for (const item of items) {
        stored[prefixSuggestionKey(item.productName, item.suggestedPrefix)] =
          item;
      }
      setStoredSuggestions(stored);
      setSuggestionState("saved");
    } catch (e) {
      setSuggestionState("failed");
      setSuggestionError(
        e instanceof Error ? e.message : "Gagal menyimpan usulan prefix."
      );
    }
  }

  async function decideSuggestion(
    suggestion: ReconcileValidationResult["prefixSuggestions"][number],
    status: "approved" | "rejected"
  ) {
    const key = prefixSuggestionKey(
      suggestion.productName,
      suggestion.suggestedPrefix
    );
    if (decisionState[key] === "saving") return;

    setDecisionState((prev) => ({ ...prev, [key]: "saving" }));
    setDecisionError("");
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
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        suggestion?: StoredPrefixSuggestion;
      } | null;
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Server menolak keputusan (HTTP ${res.status}).`
        );
      }
      const updated = body?.suggestion;
      if (!updated) {
        throw new Error("Respons keputusan usulan tidak valid.");
      }
      setStoredSuggestions((prev) => ({ ...prev, [key]: updated }));
      setExtraPrefixes((prev) => {
        const productName = updated.productName.trim().toUpperCase();
        const prefix = updated.suggestedPrefix.trim().toUpperCase();
        const current = prev[productName] ?? [];
        if (updated.status === "approved") {
          if (current.includes(prefix)) return prev;
          return { ...prev, [productName]: [...current, prefix] };
        }
        if (!current.includes(prefix)) return prev;
        const next = current.filter((item) => item !== prefix);
        const copy = { ...prev };
        if (next.length === 0) delete copy[productName];
        else copy[productName] = next;
        return copy;
      });
      setDecisionState((prev) => ({ ...prev, [key]: "saved" }));
    } catch (e) {
      setDecisionState((prev) => ({ ...prev, [key]: "failed" }));
      setDecisionError(
        e instanceof Error ? e.message : "Gagal memperbarui usulan prefix."
      );
    }
  }

  function reset() {
    setFileName("");
    setResult(null);
    setParseError(null);
    setFileSizeWarning("");
    setPrefixSyncError("");
    setAuditState("idle");
    setAuditError("");
    setSuggestionState("idle");
    setSuggestionError("");
    setStoredSuggestions({});
    setDecisionState({});
    setDecisionError("");
    setInvalidOnly(false);
    setResiCol(-1);
    setPage(1);
    setProdukFilter("ALL");
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Scale className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Reconcile Validator
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Unggah berkas Excel/CSV berisi kolom Produk &amp; Nomor Resi
              untuk validasi prefix produk EC3 (SHPE/P26), PKH, PE, &amp;
              PJB (ketiganya berbagi daftar awalan yang sama: P26, TTSPOS,
              26MNG, 26KOM, 26EVP, 26ASD, 26), serta P260 (P26) &amp;
              TTSPOS (TTSPOS).
            </p>
          </div>
        </div>
      </section>

      <section className="cf-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 hover:opacity-90",
              parsing && "pointer-events-none opacity-60"
            )}
          >
            <FileUp className="size-4" aria-hidden />
            {parsing ? "Membaca…" : "Pilih Berkas (.xlsx, .xls, .csv)"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              disabled={parsing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </label>
          {result && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="size-4" aria-hidden />
              Atur Ulang
            </button>
          )}
          {fileName && (
            <p className="truncate text-sm text-slate-500">
              Berkas: <span className="font-semibold text-slate-800">{fileName}</span>
            </p>
          )}
        </div>
        {fileSizeWarning && (
          <div
            role="status"
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-words whitespace-pre-wrap">
              {fileSizeWarning} Validasi tetap dapat dilanjutkan.
            </span>
          </div>
        )}
        {prefixSyncError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-words whitespace-pre-wrap">
              {prefixSyncError} Prefix yang disetujui tetap dicoba dari cache;
              unggah ulang setelah koneksi pulih.
            </span>
          </div>
        )}
        {parseError && (
          <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="flex items-start gap-2 text-sm text-red-700">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="break-words whitespace-pre-wrap">{parseError}</span>
            </p>
            <p className="mt-2 pl-6 text-xs text-red-600">
              Tips: buka file di Excel → periksa sel yang dilaporkan → hapus
              tanda kutip (&quot;) liar / teks tempelan panjang → simpan ulang
              sebagai .xlsx lalu unggah kembali. Jika file berekstensi .csv,
              buka dengan Notepad dan pastikan delimiter konsisten (; atau ,).
            </p>
          </div>
        )}
        {result && auditState !== "idle" && (
          <div
            role={auditState === "failed" ? "alert" : "status"}
            className={cn(
              "mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm",
              auditState === "failed"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
          >
            {auditState === "saved" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : auditState === "failed" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <Scale className="mt-0.5 size-4 shrink-0 animate-pulse" aria-hidden />
            )}
            <span className="break-words">
              {auditState === "saving" && "Menyimpan audit validasi…"}
              {auditState === "saved" && "Audit validasi tersimpan."}
              {auditState === "failed" &&
                `Validasi selesai, tetapi audit gagal disimpan: ${auditError}`}
            </span>
          </div>
        )}
      </section>

      {result && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="cf-card p-4 text-center">
              <p className="text-2xl font-extrabold text-slate-900">
                {result.summary.total}
              </p>
              <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                Total Baris
              </p>
            </div>
            <div className="cf-card p-4 text-center">
              <p className="text-2xl font-extrabold text-emerald-600">
                {result.summary.valid}
              </p>
              <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                Resi Valid
              </p>
              {breakdown && (
                <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-left text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PKH Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.pkhValid} resi
                    </dd>
                  </div>
                  <PrefixDetail
                    counts={breakdown.validByPrefix.PKH}
                    order={PKH_ACCEPTED_PREFIXES}
                    approvedPrefixes={extraPrefixes.PKH ?? []}
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">EC3 Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.ec3Valid} resi
                    </dd>
                  </div>
                  <PrefixDetail
                    counts={breakdown.validByPrefix.EC3}
                    order={EC3_PREFIXES}
                    approvedPrefixes={extraPrefixes.EC3 ?? []}
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PE Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.peValid} resi
                    </dd>
                  </div>
                  <PrefixDetail
                    counts={breakdown.validByPrefix.PE}
                    order={SHARED_PREFIXES_PKH_PJB_PE}
                    approvedPrefixes={extraPrefixes.PE ?? []}
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PJB Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.pjbValid} resi
                    </dd>
                  </div>
                  <PrefixDetail
                    counts={breakdown.validByPrefix.PJB}
                    order={SHARED_PREFIXES_PKH_PJB_PE}
                    approvedPrefixes={extraPrefixes.PJB ?? []}
                  />
                  {Object.entries(breakdown.byProduct)
                    .filter(
                      ([p, s]) =>
                        !["PKH", "EC3", "PE", "PJB"].includes(p) && s.valid > 0
                    )
                    .map(([p, s]) => (
                      <Fragment key={p}>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="font-semibold text-slate-600">
                            {p} Valid
                          </dt>
                          <dd className="font-extrabold text-emerald-700">
                            {s.valid} resi
                          </dd>
                        </div>
                        <PrefixDetail
                          counts={breakdown.validByPrefix[p]}
                          order={[]}
                          approvedPrefixes={extraPrefixes[p] ?? []}
                        />
                      </Fragment>
                    ))}
                </dl>
              )}
            </div>
            <div className="cf-card p-4 text-center">
              <p className="text-2xl font-extrabold text-red-600">
                {result.summary.invalid}
              </p>
              <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                Resi Invalid
              </p>
              {breakdown && (
                <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-left text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PKH Invalid</dt>
                    <dd className="font-extrabold text-red-700">
                      {breakdown.pkhInvalid} resi
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">EC3 Invalid</dt>
                    <dd className="font-extrabold text-red-700">
                      {breakdown.ec3Invalid} resi
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PE Invalid</dt>
                    <dd className="font-extrabold text-red-700">
                      {breakdown.peInvalid} resi
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PJB Invalid</dt>
                    <dd className="font-extrabold text-red-700">
                      {breakdown.pjbInvalid} resi
                    </dd>
                  </div>
                  {Object.entries(breakdown.byProduct)
                    .filter(
                      ([p, s]) =>
                        !["PKH", "EC3", "PE", "PJB"].includes(p) && s.invalid > 0
                    )
                    .map(([p, s]) => (
                      <div key={p} className="flex items-baseline justify-between gap-2">
                        <dt className="font-semibold text-slate-600">{p} Invalid</dt>
                        <dd className="font-extrabold text-red-700">
                          {s.invalid} resi
                        </dd>
                      </div>
                    ))}
                </dl>
              )}
            </div>
            <div className="cf-card p-4 text-center">
              <p
                className={cn(
                  "text-2xl font-extrabold",
                  result.isValid ? "text-emerald-600" : "text-amber-600"
                )}
              >
                {result.isValid ? "VALID" : "BERMASALAH"}
              </p>
              <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                Status Berkas
              </p>
            </div>
          </section>

          {result.fileIssues.length > 0 && (
            <section
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 p-4"
            >
              <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
                <AlertTriangle className="size-4" aria-hidden />
                Masalah level berkas ({result.fileIssues.length})
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
                {result.fileIssues.map((issue, i) => (
                  <li key={`${issue.rule}-${i}`}>
                    <span className="font-mono text-xs font-semibold">
                      [{issue.rule}]
                    </span>{" "}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.prefixSuggestions.length > 0 && (
            <section className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-bold text-sky-900">
                  <AlertTriangle className="size-4" aria-hidden />
                  Usulan Prefix Baru ({result.prefixSuggestions.length})
                </p>
                {suggestionState === "saving" && (
                  <span className="text-xs font-semibold text-sky-700">
                    Menyimpan usulan…
                  </span>
                )}
                {suggestionState === "saved" && (
                  <span className="text-xs font-semibold text-emerald-700">
                    Usulan tersimpan
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-sky-800">
                Resi yang tidak cocok dikelompokkan berdasarkan 3 karakter
                pertama. Usulan disimpan otomatis untuk ditinjau admin, tanpa
                mengubah hasil validasi. Setelah disetujui, prefix langsung
                dipakai pada unggahan berikutnya.
              </p>
              <ul className="mt-3 divide-y divide-sky-200/70 rounded-lg bg-white/60 px-3">
                {result.prefixSuggestions.slice(0, 20).map((suggestion) => {
                  const key = prefixSuggestionKey(
                    suggestion.productName,
                    suggestion.suggestedPrefix
                  );
                  const stored = storedSuggestions[key];
                  const status = stored?.status;
                  const deciding = decisionState[key] === "saving";

                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-xs"
                    >
                      <span className="font-semibold text-slate-800">
                        {suggestion.productName}
                      </span>
                      <code className="rounded bg-sky-100 px-1.5 py-0.5 font-mono font-bold text-sky-900 ring-1 ring-sky-200">
                        {suggestion.suggestedPrefix}
                      </code>
                      <span className="font-semibold text-sky-800">
                        {suggestion.occurrenceCount} di file ini
                      </span>
                      {stored &&
                        stored.occurrenceCount >
                          suggestion.occurrenceCount && (
                          <span className="text-slate-500">
                            total {stored.occurrenceCount}
                          </span>
                        )}
                      <span className="min-w-0 break-all font-mono text-[11px] text-slate-500">
                        contoh: {stored?.sampleResi ?? suggestion.sampleResi}
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {deciding && (
                          <span className="text-[11px] font-semibold text-sky-700">
                            Menyimpan…
                          </span>
                        )}
                        {status === "approved" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                            <CheckCircle2 className="size-3" aria-hidden />
                            Disetujui
                          </span>
                        )}
                        {status === "rejected" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600">
                            <XCircle className="size-3" aria-hidden />
                            Diabaikan
                          </span>
                        )}
                        {status === "pending" && (
                          <>
                            <button
                              type="button"
                              disabled={deciding}
                              onClick={() =>
                                void decideSuggestion(suggestion, "approved")
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50"
                            >
                              <CheckCircle2 className="size-3" aria-hidden />
                              Setujui
                            </button>
                            <button
                              type="button"
                              disabled={deciding}
                              onClick={() =>
                                void decideSuggestion(suggestion, "rejected")
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
                            >
                              <XCircle className="size-3" aria-hidden />
                              Abaikan
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {result.prefixSuggestions.length > 20 && (
                <p className="mt-2 text-xs text-sky-700">
                  Menampilkan 20 usulan teratas dari{" "}
                  {result.prefixSuggestions.length}.
                </p>
              )}
              {suggestionState === "failed" && (
                <p role="alert" className="mt-2 text-xs text-amber-800">
                  Validasi tetap selesai, tetapi usulan gagal disimpan:{" "}
                  {suggestionError}
                </p>
              )}
              {decisionError && (
                <p role="alert" className="mt-2 text-xs text-amber-800">
                  Keputusan gagal disimpan: {decisionError}
                </p>
              )}
            </section>
          )}

          <section className="cf-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Hasil Validasi Baris
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Nomor baris = baris asli di berkas Excel (alamat sel kolom
                  resi) — bukan nomor urut hasil ekstraksi.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {productOptions.length > 1 && (
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    Produk
                    <select
                      value={produkFilter}
                      onChange={(e) => {
                        setProdukFilter(e.target.value);
                        setPage(1);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                    >
                      <option value="ALL">Semua produk</option>
                      {productOptions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={invalidOnly}
                    onChange={(e) => {
                      setInvalidOnly(e.target.checked);
                      setPage(1);
                    }}
                    className="size-4 accent-cyan-600"
                  />
                  Hanya tampilkan invalid
                </label>
              </div>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Baris Excel</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Produk</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Nomor Resi</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                        {invalidOnly
                          ? "Tidak ada baris invalid. Semua valid."
                          : produkFilter !== "ALL"
                            ? `Tidak ada baris untuk produk ${produkFilter}.`
                            : "Tidak ada baris."}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row) => (
                      <tr
                        key={row.index}
                        className="border-b border-slate-100 last:border-0"
                      >
                        {/* Nomor baris ASLI di berkas Excel (tidak bergeser
                            dengan header awal / baris kosong yang dibuang). */}
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">
                          {resiCol >= 0
                            ? `${columnLetter(resiCol)}${row.sourceRow}`
                            : row.sourceRow}
                        </td>
                        <td className="px-4 py-2 font-semibold text-slate-800">
                          {row.produk || "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {row.nomorResi || "—"}
                        </td>
                        <td className="px-4 py-2">
                          {row.isValid ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="size-3" aria-hidden />
                              Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                              <XCircle className="size-3" aria-hidden />
                              Invalid
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {row.reason ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {/* [H2] Navigasi halaman: hanya satu halaman (100 baris) yang
                dirender; ringkasan total tetap dari SELURUH data. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3">
              <p className="text-xs font-medium text-slate-500">
                {filteredRows.length === 0
                  ? "Tidak ada baris untuk ditampilkan"
                  : `Menampilkan ${rangeStart}–${rangeEnd} dari ${filteredRows.length.toLocaleString("id-ID")} baris`}
                {result && filteredRows.length !== result.rows.length && (
                  <span className="ml-1 text-slate-400">
                    (dari total {result.rows.length.toLocaleString("id-ID")} baris
                    hasil validasi)
                  </span>
                )}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, safePage - 1))}
                    disabled={safePage <= 1}
                    aria-label="Halaman sebelumnya"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ‹
                  </button>
                  {pageNumbers().map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      aria-current={n === safePage ? "page" : undefined}
                      className={cn(
                        "min-w-8 rounded-lg px-2 py-1.5 text-xs font-semibold",
                        n === safePage
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                    disabled={safePage >= totalPages}
                    aria-label="Halaman berikutnya"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
