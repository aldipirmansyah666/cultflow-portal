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
import {
  buildReconcileBreakdown,
  validateReconcileRows,
  type ReconcileValidationResult,
} from "@/core/parsers/reconcileValidator";
import {
  extractReconcileInputRows,
  findReconcileHeader,
  normalizeReconcileRowsFromObjects,
  type DetectedHeader,
  type ReconcileInputRow,
} from "@/core/parsers/reconcileHeader";
import { cn } from "@/lib/utils";

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

  const breakdown = useMemo(
    () => (result ? buildReconcileBreakdown(result.rows) : null),
    [result]
  );

  async function handleFile(file: File) {
    setParsing(true);
    setParseError(null);
    setResult(null);
    try {
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
        const rows = extractReconcileInputRows(m, h);
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
            matrixToObjects<Record<string, unknown>>(m)
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
        {parseError && (
          <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="flex items-start gap-2 text-sm text-red-700">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="break-words whitespace-pre-wrap">{parseError}</span>
            </p>
            <p className="mt-2 pl-6 text-xs text-red-600">
              Tips: buka file di Excel → periksa sel yang dilaporkan → hapus
              tanda kutip (") liar / teks tempelan panjang → simpan ulang
              sebagai .xlsx lalu unggah kembali. Jika file berekstensi .csv,
              buka dengan Notepad dan pastikan delimiter konsisten (; atau ,).
            </p>
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
                  <dd className="font-mono text-[11px] text-slate-500">
                    P26: {breakdown.pkhValidByPrefix.P26} • TTSPOS:{" "}
                    {breakdown.pkhValidByPrefix.TTSPOS} • 26MNG:{" "}
                    {breakdown.pkhValidByPrefix["26MNG"]} • 26Lainnya:{" "}
                    {breakdown.pkhValidByPrefix["26KOM"] +
                      breakdown.pkhValidByPrefix["26EVP"] +
                      breakdown.pkhValidByPrefix["26ASD"] +
                      breakdown.pkhValidByPrefix["26"]}
                  </dd>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">EC3 Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.ec3Valid} resi
                    </dd>
                  </div>
                  <dd className="font-mono text-[11px] text-slate-500">
                    SHPE: {breakdown.ec3ValidByPrefix.SHPE} • P26:{" "}
                    {breakdown.ec3ValidByPrefix.P26}
                  </dd>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PE Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.peValid} resi
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-semibold text-slate-600">PJB Valid</dt>
                    <dd className="font-extrabold text-emerald-700">
                      {breakdown.pjbValid} resi
                    </dd>
                  </div>
                  {Object.entries(breakdown.byProduct)
                    .filter(
                      ([p, s]) =>
                        !["PKH", "EC3", "PE", "PJB"].includes(p) && s.valid > 0
                    )
                    .map(([p, s]) => (
                      <div key={p} className="flex items-baseline justify-between gap-2">
                        <dt className="font-semibold text-slate-600">{p} Valid</dt>
                        <dd className="font-extrabold text-emerald-700">
                          {s.valid} resi
                        </dd>
                      </div>
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
