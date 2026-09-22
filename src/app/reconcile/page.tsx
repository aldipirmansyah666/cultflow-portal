"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  RotateCcw,
  Scale,
  XCircle,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  validateReconcileRows,
  type ReconcileValidationResult,
} from "@/core/parsers/reconcileValidator";
import { cn } from "@/lib/utils";

interface DetectedHeader {
  row: number;
  produkCol: number;
  resiCol: number;
}

/** Cari baris header: memuat kolom produk DAN kolom resi (maks 20 baris awal). */
function findReconcileHeader(matrix: unknown[][]): DetectedHeader | null {
  const limit = Math.min(matrix.length, 20);
  for (let r = 0; r < limit; r += 1) {
    const cells = (matrix[r] ?? []).map((c) =>
      String(c ?? "")
        .toLowerCase()
        .replace(/[^a-z]/g, "")
    );
    const produkCol = cells.findIndex((c) => c.includes("produk"));
    const resiCol = cells.findIndex((c) => c.includes("resi"));
    if (produkCol !== -1 && resiCol !== -1) {
      return { row: r, produkCol, resiCol };
    }
  }
  return null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export default function ReconcilePage() {
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<ReconcileValidationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [invalidOnly, setInvalidOnly] = useState(false);

  const visibleRows = useMemo(() => {
    if (!result) return [];
    return invalidOnly
      ? result.rows.filter((r) => !r.isValid)
      : result.rows;
  }, [result, invalidOnly]);

  async function handleFile(file: File) {
    setParsing(true);
    setParseError(null);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!firstSheet) throw new Error("Berkas tidak berisi sheet.");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        defval: null,
        raw: true,
      });
      const header = findReconcileHeader(matrix);
      if (!header) {
        throw new Error(
          "Kolom Produk dan Nomor Resi tidak ditemukan (dipindai 20 baris pertama)."
        );
      }
      const inputRows = matrix
        .slice(header.row + 1)
        .map((cells) => ({
          produk: cellText(cells[header.produkCol]),
          nomor_resi: cellText(cells[header.resiCol]),
        }))
        .filter((r) => r.produk !== "" || r.nomor_resi !== "");
      if (inputRows.length === 0) {
        throw new Error("Tidak ada baris data di bawah header.");
      }
      setFileName(file.name);
      setResult(validateReconcileRows(inputRows));
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Gagal membaca berkas."
      );
    } finally {
      setParsing(false);
    }
  }

  function reset() {
    setFileName("");
    setResult(null);
    setParseError(null);
    setInvalidOnly(false);
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
              untuk validasi prefix EC3/PKH.
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
        {parseError && (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <XCircle className="size-4 shrink-0" aria-hidden />
            {parseError}
          </p>
        )}
      </section>

      {result && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Total Baris", value: result.summary.total, tone: "text-slate-900" },
              { label: "Valid", value: result.summary.valid, tone: "text-emerald-600" },
              { label: "Invalid", value: result.summary.invalid, tone: "text-red-600" },
              {
                label: "Status Berkas",
                value: result.isValid ? "VALID" : "BERMASALAH",
                tone: result.isValid ? "text-emerald-600" : "text-amber-600",
              },
            ].map((stat) => (
              <div key={stat.label} className="cf-card p-4 text-center">
                <p className={cn("text-2xl font-extrabold", stat.tone)}>
                  {stat.value}
                </p>
                <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  {stat.label}
                </p>
              </div>
            ))}
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

          <section className="cf-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900">
                Hasil Validasi Baris
              </h2>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={invalidOnly}
                  onChange={(e) => setInvalidOnly(e.target.checked)}
                  className="size-4 accent-cyan-600"
                />
                Hanya tampilkan invalid
              </label>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">#</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Produk</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Nomor Resi</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                        {invalidOnly
                          ? "Tidak ada baris invalid. Semua valid."
                          : "Tidak ada baris."}
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <tr
                        key={row.index}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-4 py-2 text-slate-400">{row.index + 1}</td>
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
          </section>
        </>
      )}
    </div>
  );
}
