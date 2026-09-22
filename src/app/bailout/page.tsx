"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  FolderClosed,
  FolderOpen,
  Send,
  Upload,
} from "lucide-react";
import {
  parseBailoutFromPaste,
  parseBailoutRowsFromAOA,
  type BailoutRow,
} from "@/core/parsers/bailoutParser";
import {
  buildBailoutMessage,
  defaultRedaksiDateISO,
  formatIDCurrency,
} from "@/core/parsers/bailoutMessage";
import {
  MAX_EXCEL_SIZE_BYTES,
  validateExcelMagicBytes,
  validateFileSize,
} from "@/lib/fileValidation";

const idr = new Intl.NumberFormat("id-ID");

function toCsv(rows: BailoutRow[]): string {
  const header = "kode_loket;nama_loket;nominal";
  const lines = rows.map((r) =>
    [r.kodeLoket, `"${r.namaLoket.replace(/"/g, '""')}"`, r.nominal].join(";")
  );
  return [header, ...lines].join("\n");
}

export default function BailoutPage() {
  const [data, setData] = useState<BailoutRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [bailoutDate, setBailoutDate] = useState(defaultRedaksiDateISO);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [collapsedItems, setCollapsedItems] = useState<Record<number, boolean>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);

  function toggleCollapse(idx: number) {
    setCollapsedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  function collapseAll() {
    const state: Record<number, boolean> = {};
    data.forEach((_, i) => {
      state[i] = true;
    });
    setCollapsedItems(state);
  }

  function expandAll() {
    setCollapsedItems({});
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeErr = validateFileSize(file, MAX_EXCEL_SIZE_BYTES);
    if (sizeErr) {
      setUploadError(sizeErr);
      e.target.value = "";
      return;
    }

    setIsProcessing(true);
    setUploadError(null);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      if (!validateExcelMagicBytes(buffer)) {
        setUploadError(
          "Format file tidak valid. Harap upload file Excel (.xlsx/.xls) yang sah."
        );
        return;
      }
      const workbook = XLSX.read(buffer, { type: "array" });
      if (workbook.SheetNames.length === 0) throw new Error("No sheet found");
      // Hanya baca sheet "CA" (case-insensitive); fallback ke sheet pertama
      const targetSheetName =
        workbook.SheetNames.find((name) => name.trim().toLowerCase() === "ca") ??
        workbook.SheetNames[0];
      const sheet = targetSheetName ? workbook.Sheets[targetSheetName] : undefined;
      if (!sheet) throw new Error("No sheet found");
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
      }) as unknown[][];
      const parsed = parseBailoutRowsFromAOA(aoa);
      setData(parsed);
      if (parsed.length === 0) {
        setUploadError(
          "Tidak ada data bailout yang terdeteksi. Periksa format header (KODE/MITRA ID/PAYMENT POINT)."
        );
      }
    } catch (err) {
      console.error("Error reading Excel:", err);
      setUploadError("Gagal membaca file Excel");
    } finally {
      setIsProcessing(false);
      e.target.value = "";
    }
  }

  function handlePasteSubmit() {
    const parsed = parseBailoutFromPaste(pasteText);
    setData(parsed);
    setUploadError(
      parsed.length === 0
        ? "Tidak ada data bailout yang terdeteksi. Periksa format header (KODE/NAMA/BAILOUT)."
        : null
    );
  }

  async function handleCopy(text: string, idx: number) {
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
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bailout-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalMinus = useMemo(
    () => data.reduce((sum, row) => sum + row.nominal, 0),
    [data]
  );

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <AlertTriangle className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Bailout Generator
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Upload Excel (sheet CA) atau paste data untuk template pesan
              pengingat bailout per agen. Maks {MAX_EXCEL_SIZE_BYTES / 1024 / 1024} MB.
            </p>
          </div>
        </div>
      </section>

      <section className="cf-card space-y-4 p-4 sm:p-5">
        {/* Tab Mode Input */}
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setInputMode("file")}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              inputMode === "file"
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden /> Upload Excel
          </button>
          <button
            type="button"
            onClick={() => setInputMode("paste")}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              inputMode === "paste"
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> Paste Data
          </button>
        </div>

        {inputMode === "file" ? (
          <div className="space-y-3">
            <label className="group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center transition-all duration-150 hover:border-cyan-300 hover:bg-white hover:shadow-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-cyan-600 shadow-sm group-hover:border-cyan-200">
                <Upload className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold tracking-tight text-slate-900">
                  Seret file atau klik untuk upload
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Mendukung .xlsx, .xls — dibaca sheet CA
                </p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => void handleFileUpload(e)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder={"Paste data tab-separated di sini...\n\nContoh:\nKODE\tNAMA\tBAILOUT\nSBPAYS-CV-MPI-00\tCV. MITRA PERDANA INDONESIA (MPI)\t-1.507.495"}
              className="w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 focus:outline-none"
            />
            <button
              type="button"
              onClick={handlePasteSubmit}
              disabled={!pasteText.trim()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> Proses Data
            </button>
          </div>
        )}

        <div className="flex w-fit items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
          <label
            htmlFor="bailout-date"
            className="text-[11px] font-bold tracking-widest whitespace-nowrap text-slate-500 uppercase"
          >
            Tanggal Redaksi:
          </label>
          <input
            id="bailout-date"
            type="date"
            value={bailoutDate}
            onChange={(e) => setBailoutDate(e.target.value)}
            className="cursor-pointer bg-transparent text-xs font-medium tracking-tight text-slate-900 focus:outline-none"
          />
        </div>

        {uploadError && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
          >
            {uploadError}
          </p>
        )}
      </section>

      {data.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="cf-card p-4 text-center sm:p-5">
            <p className="text-2xl font-extrabold tracking-tight text-slate-900">
              {data.length}
            </p>
            <p className="mt-1 text-[11px] font-bold tracking-widest text-slate-500 uppercase">
              Total Agen
            </p>
          </div>
          <div className="cf-card border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 text-center sm:p-5">
            <p className="text-2xl font-extrabold tracking-tight text-amber-700">
              {formatIDCurrency(totalMinus)}
            </p>
            <p className="mt-1 text-[11px] font-bold tracking-widest text-amber-600 uppercase">
              Total Minus
            </p>
          </div>
        </section>
      )}

      {isProcessing ? (
        <div className="cf-card p-12 text-center">
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
            Membaca file Excel…
          </span>
        </div>
      ) : data.length > 0 ? (
        <div className="space-y-4">
          <div className="cf-card flex items-center justify-between p-3">
            <h2 className="text-xs font-bold tracking-widest text-slate-600 uppercase">
              Draft Pesan per Agen
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={downloadCsv}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden /> CSV
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <FolderClosed className="h-3.5 w-3.5" aria-hidden /> Sembunyikan
              </button>
              <button
                type="button"
                onClick={expandAll}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Tampilkan
              </button>
            </div>
          </div>

          {data.map((row, idx) => {
            const nama = row.namaLoket.trim() === "" ? "-" : row.namaLoket.trim();
            const msg = buildBailoutMessage(nama, row.nominal, bailoutDate);
            const waUrl = `https://web.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
            const copied = copiedIdx === idx;
            const collapsed = !!collapsedItems[idx];

            return (
              <div key={`${row.kodeLoket}-${idx}`} className="cf-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-4">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(idx)}
                    className="group flex min-w-0 cursor-pointer items-center gap-2 text-left"
                  >
                    {collapsed ? (
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-600"
                        aria-hidden
                      />
                    ) : (
                      <ChevronDown
                        className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-600"
                        aria-hidden
                      />
                    )}
                    <span className="truncate text-sm font-semibold text-slate-800">
                      {nama}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400">
                      {row.kodeLoket || "-"}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-bold ${row.nominal < 0 ? "text-amber-600" : "text-emerald-600"}`}
                    >
                      {formatIDCurrency(row.nominal)}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCopy(msg, idx)}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        copied
                          ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {copied ? "Tersalin" : "Copy Message"}
                    </button>
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-xl bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#20bd5a]"
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden /> Kirim WA
                    </a>
                  </div>
                </div>

                {!collapsed && (
                  <div className="p-4">
                    <pre className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs whitespace-pre-wrap text-slate-700 shadow-sm">
                      {msg}
                    </pre>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Tabel tagihan: {row.kodeLoket || "-"} · Rp{" "}
                      {idr.format(row.nominal)}
                      {row.periode.trim() !== "" && ` · Periode ${row.periode}`}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !isProcessing && (
          <div className="cf-card flex flex-col items-center justify-center border-dashed py-16 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-sm">
              <Upload className="h-7 w-7 text-slate-300" aria-hidden />
            </span>
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              Upload atau paste data
            </p>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
              Unggah file Excel (.xlsx, sheet CA) atau paste data tab-separated
              dengan kolom KODE, NAMA, dan BAILOUT.
            </p>
          </div>
        )
      )}
    </div>
  );
}
