"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderClosed,
  FolderOpen,
  Package,
  Send,
  Upload,
} from "lucide-react";
import {
  buildBaggingMessage,
  buildBaggingWaUrl,
  normalizeWaNumber,
} from "@/core/parsers/baggingMessage";
import {
  groupBaggingByAgen,
  parseBaggingRowsFromAOA,
  type BaggingRow,
} from "@/core/parsers/baggingParser";
import { lookupAgenByPpid } from "@/core/services/dataUtamaService";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { normalizePeriodeToISO } from "@/core/parsers/bailoutParser";
import {
  MAX_EXCEL_SIZE_BYTES,
  validateExcelMagicBytes,
  validateFileSize,
} from "@/lib/fileValidation";

/** Tampilkan tanggal Excel/ISO sebagai DD/MM/YYYY (port opr-portal). */
function formatDateDDMMYYYY(value: unknown): string {
  if (!value && value !== 0) return "-";
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return String(value);
    const d = String(value.getDate()).padStart(2, "0");
    const m = String(value.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${value.getFullYear()}`;
  }
  if (typeof value === "number") {
    const iso = normalizePeriodeToISO(value);
    if (iso) {
      const [y, m, d] = iso.split("-");
      return `${d}/${m}/${y}`;
    }
    const date = new Date((value - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const d = String(date.getDate()).padStart(2, "0");
      const m = String(date.getMonth() + 1).padStart(2, "0");
      return `${d}/${m}/${date.getFullYear()}`;
    }
    return String(value);
  }
  const str = String(value).trim();
  const iso = normalizePeriodeToISO(str);
  if (iso) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${date.getFullYear()}`;
  }
  return String(value);
}

export default function BaggingPage() {
  const [baggingData, setBaggingData] = useState<BaggingRow[]>([]);
  const [isProcessingExcel, setIsProcessingExcel] = useState(false);
  const [collapsedAgens, setCollapsedAgens] = useState<Record<string, boolean>>({});
  const [copiedAgen, setCopiedAgen] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingExcel(true);
    setUploadError(null);
    try {
      const XLSX = await import("xlsx");
      const allParsedRows: BaggingRow[] = [];
      for (const file of Array.from(files)) {
        const sizeErr = validateFileSize(file, MAX_EXCEL_SIZE_BYTES);
        if (sizeErr) {
          setUploadError(sizeErr);
          continue;
        }
        try {
          const buffer = await file.arrayBuffer();
          if (!validateExcelMagicBytes(buffer)) {
            setUploadError(
              `${file.name}: Format file tidak valid. Harap upload file Excel (.xlsx/.xls) yang sah.`
            );
            continue;
          }
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) continue;
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: "",
          }) as unknown[][];
          const parsed = parseBaggingRowsFromAOA(aoa);
          // Fallback ke sheet_to_json bila AOA tak menemukan header dinamis
          if (parsed.length > 0) {
            allParsedRows.push(...parsed);
          } else {
            const jsonData = XLSX.utils.sheet_to_json<BaggingRow>(sheet, {
              defval: "",
            });
            allParsedRows.push(...jsonData);
          }
        } catch (err) {
          console.error(`Error reading ${file.name}:`, err);
          setUploadError(`Gagal membaca ${file.name}`);
        }
      }
      if (allParsedRows.length > 0) {
        setBaggingData(allParsedRows);
        setAgenPhones({});
      } else if (!uploadError) setUploadError("Tidak ada baris bagging yang terdeteksi.");
    } finally {
      setIsProcessingExcel(false);
      e.target.value = "";
    }
  }

  function toggleCollapse(agenName: string) {
    setCollapsedAgens((prev) => ({ ...prev, [agenName]: !prev[agenName] }));
  }

  function collapseAll(keys: string[]) {
    const state: Record<string, boolean> = {};
    keys.forEach((k) => {
      state[k] = true;
    });
    setCollapsedAgens(state);
  }

  function expandAll() {
    setCollapsedAgens({});
  }

  async function handleCopy(text: string, agen: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback untuk insecure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedAgen(agen);
    setTimeout(() => setCopiedAgen(null), 2000);
  }

  const groupedByAgen = useMemo(() => groupBaggingByAgen(baggingData), [baggingData]);
  const agenKeys = useMemo(() => Object.keys(groupedByAgen), [groupedByAgen]);

  // No HP pemilik per agen (untuk wa.me/{noHp}): lookup nama agen ke
  // data_lengkap_utama, dinormalisasi ke format 62xx. "" = tak ditemukan
  // (tombol WA pakai tautan umum https://wa.me/?text=…).
  const [agenPhones, setAgenPhones] = useState<Record<string, string>>({});
  useEffect(() => {
    if (agenKeys.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const client = getSupabaseBrowser();
        const entries = await Promise.all(
          agenKeys.map(async (name) => {
            try {
              const row = await lookupAgenByPpid(client, name);
              return [name, normalizeWaNumber(row?.no_hp_pemilik)] as const;
            } catch {
              return [name, ""] as const;
            }
          })
        );
        if (!cancelled) setAgenPhones(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setAgenPhones({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agenKeys]);

  // Pesan WA per agen (redaksi otentik): daftar resi line-by-line,
  // ref BGG unik + jam WIB per render. "" bila tak ada resi valid.
  function messageForAgen(agenName: string): string {
    const items = groupedByAgen[agenName] ?? [];
    const sampleDate = formatDateDDMMYYYY(items[0]?.["Tanggal"]);
    const resiList = items
      .map((i) => String(i["No Resi"] ?? "").trim())
      .filter((resi) => resi !== "");
    if (resiList.length === 0) return "";
    try {
      return buildBaggingMessage({ agenName, tanggal: sampleDate, resiList });
    } catch {
      return "";
    }
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Package className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Bagging Generator
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Upload Excel KurLog (multi-file) untuk memfilter paket belum
              dibagging dan generate teks WA per agen. Maks{" "}
              {MAX_EXCEL_SIZE_BYTES / 1024 / 1024} MB per file.
            </p>
          </div>
        </div>
      </section>

      <section className="cf-card space-y-4 p-4 sm:p-5">
        <label className="group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center transition-all duration-150 hover:border-cyan-300 hover:bg-white hover:shadow-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-cyan-600 shadow-sm group-hover:border-cyan-200">
            <Upload className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Seret file atau klik untuk upload
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Mendukung .xlsx, .xls — multi-file
            </p>
          </div>
          <input
            type="file"
            accept=".xlsx,.xls"
            multiple
            onChange={(e) => void handleFileUpload(e)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {uploadError && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
          >
            {uploadError}
          </p>
        )}
      </section>

      {baggingData.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="cf-card p-4 text-center">
            <p className="text-2xl font-extrabold text-slate-900">{baggingData.length}</p>
            <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Total Resi
            </p>
          </div>
          <div className="cf-card border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4 text-center">
            <p className="text-2xl font-extrabold text-amber-700">
              {agenKeys.reduce((n, k) => n + (groupedByAgen[k]?.length ?? 0), 0)}
            </p>
            <p className="mt-1 text-[11px] font-semibold tracking-wider text-amber-600 uppercase">
              Belum Dibagging
            </p>
          </div>
          <div className="cf-card border-cyan-200 bg-gradient-to-b from-cyan-50 to-white p-4 text-center">
            <p className="text-2xl font-extrabold text-cyan-700">{agenKeys.length}</p>
            <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Agen Terdampak
            </p>
          </div>
        </section>
      )}

      {isProcessingExcel ? (
        <div className="cf-card p-12 text-center">
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
            Membaca file Excel…
          </span>
        </div>
      ) : agenKeys.length > 0 ? (
        <div className="space-y-4">
          <div className="cf-card flex items-center justify-between p-3">
            <h2 className="text-xs font-bold tracking-widest text-slate-600 uppercase">
              Draft Pesan per Agen
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => collapseAll(agenKeys)}
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

          {agenKeys.map((agenName) => {
            const items = groupedByAgen[agenName] ?? [];
            const msg = messageForAgen(agenName);
            const hasMsg = msg !== "";
            const phone = agenPhones[agenName] ?? "";
            const waUrl = buildBaggingWaUrl(msg, phone);
            const collapsed = !!collapsedAgens[agenName];
            const copied = copiedAgen === agenName;

            return (
              <div
                key={agenName}
                className="cf-card overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-4">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(agenName)}
                    className="group flex cursor-pointer items-center gap-2 text-left"
                  >
                    {collapsed ? (
                      <ChevronRight
                        className="h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-600"
                        aria-hidden
                      />
                    ) : (
                      <ChevronDown
                        className="h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-600"
                        aria-hidden
                      />
                    )}
                    <span className="text-sm font-semibold text-slate-800">
                      {agenName}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                      {items.length} paket
                    </span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCopy(msg, agenName)}
                      disabled={!hasMsg}
                      title="Salin Pesan"
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
                      {copied ? "Tersalin" : "Salin Pesan"}
                    </button>
                    {hasMsg ? (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={
                          phone === ""
                            ? "Nomor HP pemilik tak ditemukan — tautan WA umum"
                            : `Buka chat ${phone}`
                        }
                        className="inline-flex items-center gap-1 rounded-xl bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#20bd5a]"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden /> Buka WA Web/App
                      </a>
                    ) : (
                      <span
                        aria-disabled
                        title="Tidak ada nomor resi valid untuk agen ini"
                        className="inline-flex cursor-not-allowed items-center gap-1 rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden /> Buka WA Web/App
                      </span>
                    )}
                  </div>
                </div>

                {!collapsed && (
                  <div className="space-y-3 p-4">
                    {hasMsg ? (
                      <pre className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs whitespace-pre-wrap text-slate-700 shadow-sm">
                        {msg}
                      </pre>
                    ) : (
                      <p
                        role="note"
                        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700"
                      >
                        Tidak ada nomor resi valid untuk agen ini — pesan WA
                        tidak dibuat. Periksa kolom No Resi pada file Excel.
                      </p>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-[11px] tracking-wider text-slate-500 uppercase">
                          <tr>
                            <th scope="col" className="p-3">Tanggal</th>
                            <th scope="col" className="p-3">No Resi</th>
                            <th scope="col" className="p-3">Kode Layanan</th>
                            <th scope="col" className="p-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {items.map((row, idx) => (
                            <tr
                              key={idx}
                              className="transition-colors hover:bg-slate-50/50"
                            >
                              <td className="p-2.5">
                                {formatDateDDMMYYYY(row["Tanggal"])}
                              </td>
                              <td className="p-2.5 font-mono font-semibold text-blue-600">
                                {String(row["No Resi"] || "-")}
                              </td>
                              <td className="p-2.5">
                                {String(row["Kode Layanan"] || "-")}
                              </td>
                              <td className="p-2.5 font-medium text-amber-600">
                                {String(row["Status Bagging"] || "-")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !isProcessingExcel && (
          <div className="cf-card flex flex-col items-center justify-center border-dashed py-16 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-sm">
              <Upload className="h-7 w-7 text-slate-300" aria-hidden />
            </span>
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              Upload file Excel
            </p>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
              Unggah file Excel KurLog (.xlsx / .xls, multi-file) untuk melihat
              draft pengingat bagging per agen.
            </p>
          </div>
        )
      )}
    </div>
  );
}
