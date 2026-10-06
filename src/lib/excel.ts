/**
 * Wrapper parsing Excel berbasis `exceljs` (pengganti SheetJS `xlsx` yang
 * memiliki CVE tanpa fix: GHSA-4r6h-8v6p-xvw6 + GHSA-5pgg-2g8v-p4x9).
 *
 * API disengaja mirip pola lama (buffer -> matriks AOA `unknown[][]`) agar
 * caller (pages + services + script CLI) tidak berubah signature.
 *
 * Batasan yang ditegakkan di sini (defense-in-depth, melengkapi
 * `validateFileSize`/`validateExcelMagicBytes` + cek di API route):
 * - max rows  (default IMPORT_MAX_ROWS data-utama = 20000)
 * - max cols  (default IMPORT_MAX_COLS data-utama = 200)
 * - max chars per sel string (batas sel Excel 32767)
 * Melebihi -> throw Error berbahasa Indonesia yang jelas.
 *
 * CATATAN format: `exceljs` hanya membaca `.xlsx`/`.xlsm` (OOXML ZIP).
 * Berkas legacy `.xls` (OLE2) / `.xlsb` (BIFF12) DITOLAK dengan pesan yang
 * meminta pengguna menyimpan ulang sebagai `.xlsx`. `.csv` didukung via
 * parser CSV ringan bawaan (deteksi delimiter tab/`;`/`,`) karena exceljs
 * `csv.load` tidak cocok untuk matriks generik di browser.
 */

import ExcelJS from "exceljs";
import { downloadBlob } from "@/lib/utils";

export const EXCEL_MAX_CELL_CHARS = 32767;
/** Batas total karakter seluruh matriks agar file korup tidak menghabiskan memori. */
export const EXCEL_MAX_TOTAL_CHARS = 20_000_000;

export interface MatrixLimits {
  maxRows: number;
  maxCols: number;
  maxCellChars?: number;
  /** Batas total karakter (default 20 juta). */
  maxTotalChars?: number;
  /**
   * 'throw' (default): lempar error informatif.
   * 'truncate': potong sel berlebih + kembalikan peringatan (untuk alur audit).
   */
  onOversizeCell?: "throw" | "truncate";
  /** Konteks untuk pesan error agar mudah diaudit. */
  fileName?: string;
  sheetName?: string;
}

export interface CellViolation {
  row: number; // 1-based
  col: number; // 1-based
  address: string; // "A4"
  length: number;
  preview: string;
}

export interface MatrixLimitReport {
  truncatedCells: CellViolation[];
  warnings: string[];
}

/** Error terstruktur agar UI bisa menampilkan lokasi persis + saran perbaikan. */
export class MatrixLimitError extends Error {
  code: "CELL_TOO_LONG" | "TOO_MANY_ROWS" | "TOO_MANY_COLS" | "TOTAL_TOO_LARGE";
  fileName?: string;
  sheetName?: string;
  violations: CellViolation[];
  hint: string;
  constructor(
    code: MatrixLimitError["code"],
    message: string,
    opts: {
      fileName?: string;
      sheetName?: string;
      violations?: CellViolation[];
      hint?: string;
    } = {}
  ) {
    super(message);
    this.name = "MatrixLimitError";
    this.code = code;
    this.fileName = opts.fileName;
    this.sheetName = opts.sheetName;
    this.violations = opts.violations ?? [];
    this.hint = opts.hint ?? "";
  }
}

/** "A1:B2" -> { s:{r,c}, e:{r,c} } 0-based (format kompatibel fillMergedCells). */

export interface MergeLike {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** Normalisasi nilai sel exceljs menjadi primitif JSON-able(ray). */
export function normalizeCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    // Sel formula: { formula, result } -> pakai hasil cache ("" bila kosong).
    if ("formula" in v) {
      const result = (v as { result?: unknown }).result;
      if (result === null || result === undefined) return "";
      if (result instanceof Date) return result;
      if (
        typeof result === "string" ||
        typeof result === "number" ||
        typeof result === "boolean"
      ) {
        return result;
      }
      // Guard: String(result) objek aneh bisa meledak — batasi.
      const s = String(result);
      return s.length > EXCEL_MAX_CELL_CHARS + 1024
        ? s.slice(0, EXCEL_MAX_CELL_CHARS + 1024)
        : s;
    }
    // Rich text: { richText: [{text}] } -> gabungkan (dengan batas progresif
    // agar file korup dengan ribuan fragmen tidak merangkai string raksasa).
    if (Array.isArray(v.richText)) {
      const parts = v.richText as { text?: unknown }[];
      let out = "";
      for (const part of parts) {
        if (typeof part.text !== "string") continue;
        out += part.text;
        if (out.length > EXCEL_MAX_CELL_CHARS + 1024) {
          out = out.slice(0, EXCEL_MAX_CELL_CHARS + 1024);
          break;
        }
      }
      return out;
    }
    // Hyperlink: { text, hyperlink } -> teks tampilan.
    if (typeof v.text === "string") return v.text;
    // Error: { error: "#DIV/0!" } -> string error agar terlihat di audit.
    if (typeof v.error === "string") return v.error;
  }
  return String(value);
}

/**
 * Worksheet -> matriks AOA (baris 1 = indeks 0), sel kosong diisi `defval`.
 * Kolom dipadatkan ke lebar maksimum lembar (tanpa ekor kosong raksasa
 * khas `.xlsb` yang punya `!ref` seluas ribuan baris — exceljs hanya
 * mengiterasi baris yang benar-benar ada sehingga masalah itu hilang).
 */
export function worksheetToMatrix(
  ws: ExcelJS.Worksheet,
  defval: unknown = null
): unknown[][] {
  const colCount = ws.columnCount;
  const matrix: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    // Lewati baris hantu di luar dimensi (pengaman file aneh).
    if (rowNumber < 1) return;
    const out: unknown[] = [];
    for (let c = 1; c <= colCount; c += 1) {
      const raw = normalizeCellValue(row.getCell(c).value);
      out.push(raw === null || raw === undefined ? defval : raw);
    }
    matrix.push(out);
  });
  return matrix;
}

/** Potong preview agar pesan error tidak ikut membesar. */
function cellPreview(cell: string, len = 120): string {
  const oneLine = cell.replace(/\s+/g, " ").trim();
  return oneLine.length > len ? `${oneLine.slice(0, len)}…` : oneLine;
}

function wherePrefix(limits: MatrixLimits): string {
  const parts: string[] = [];
  if (limits.fileName) parts.push(`Berkas "${limits.fileName}"`);
  if (limits.sheetName) parts.push(`sheet "${limits.sheetName}"`);
  return parts.length > 0 ? `${parts.join(" · ")} · ` : "";
}

/**
 * Validasi batas matriks; resilient terhadap sel korup raksasa.
 * - Mode 'throw' (default): lempar MatrixLimitError dengan alamat sel (A4),
 *   panjang aktual, preview isi, dan hint perbaikan.
 * - Mode 'truncate': potong sel berlebih ke maxCellChars, kembalikan laporan
 *   via `report` (tidak throw untuk CELL_TOO_LONG).
 */
export function validateMatrixLimits(
  matrix: unknown[][],
  limits: MatrixLimits,
  report?: MatrixLimitReport
): void {
  const maxCell = limits.maxCellChars ?? EXCEL_MAX_CELL_CHARS;
  const maxTotal = limits.maxTotalChars ?? EXCEL_MAX_TOTAL_CHARS;
  const mode = limits.onOversizeCell ?? "throw";
  const prefix = wherePrefix(limits);
  if (matrix.length > limits.maxRows) {
    throw new MatrixLimitError("TOO_MANY_ROWS", `${prefix}Terlalu banyak baris (${matrix.length}). Maksimal ${limits.maxRows}. Pecah file menjadi beberapa bagian.`, {
      fileName: limits.fileName,
      sheetName: limits.sheetName,
      hint: "Pecah file menjadi beberapa bagian < 20.000 baris data.",
    });
  }
  let width = 0;
  for (const row of matrix.slice(0, Math.min(matrix.length, 10))) {
    if (Array.isArray(row) && row.length > width) width = row.length;
  }
  if (width > limits.maxCols) {
    throw new MatrixLimitError("TOO_MANY_COLS", `${prefix}Terlalu banyak kolom (${width}). Maksimal ${limits.maxCols}.`, {
      fileName: limits.fileName,
      sheetName: limits.sheetName,
      hint: "Hapus kolom jauh di kanan (mis. XFD) lalu simpan ulang sebagai .xlsx.",
    });
  }
  const violations: CellViolation[] = [];
  let total = 0;
  for (let r = 0; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (typeof cell !== "string") continue;
      total += cell.length;
      if (cell.length > maxCell) {
        const v: CellViolation = {
          row: r + 1,
          col: c + 1,
          address: encodeCellAddress(r, c),
          length: cell.length,
          preview: cellPreview(cell),
        };
        if (mode === "truncate") {
          row[c] = cell.slice(0, maxCell);
          violations.push(v);
          if (report) report.truncatedCells.push(v);
        } else {
          violations.push(v);
        }
      }
    }
    // Cek total bertahap agar tidak menunggu seluruh matriks saat file korup.
    if (total > maxTotal && mode === "throw") {
      throw new MatrixLimitError(
        "TOTAL_TOO_LARGE",
        `${prefix}Total isi file terlalu besar (~${total.toLocaleString("id-ID")} karakter). Kemungkinan ada sel korup yang menelan sebagian besar file.`,
        {
          fileName: limits.fileName,
          sheetName: limits.sheetName,
          violations,
          hint: 'Buka file di Excel/Notepad, periksa tanda kutip (") tak berpasangan di sekitar baris yang dilaporkan, lalu simpan ulang sebagai .xlsx.',
        }
      );
    }
  }
  if (violations.length > 0 && mode === "truncate") {
    if (report) {
      report.warnings.push(
        `${violations.length} sel dipotong ke ${maxCell} karakter: ${violations.slice(0, 5).map((v) => `${v.address} (${v.length}→${maxCell})`).join(", ")}${violations.length > 5 ? ` +${violations.length - 5} lainnya` : ""}.`
      );
    }
    return;
  }
  if (violations.length > 0) {
    const first = violations.slice(0, 3)
      .map((v) => `Sel ${v.address} (baris ${v.row} kolom ${v.col}): ${v.length.toLocaleString("id-ID")} karakter > maksimal ${maxCell.toLocaleString("id-ID")}. Isi awal: "${v.preview}"`)
      .join(" ");
    const hint =
      'Kemungkinan penyebab: (1) tanda kutip (") tak berpasangan di CSV sehingga satu sel menelan ribuan baris; (2) delimiter salah terdeteksi (; vs , vs tab); (3) copy-paste teks panjang ke satu sel; (4) file .csv dibuka/disimpan dengan encoding/line-ending berbeda. Periksa baris tersebut di Notepad/Excel, hapus/rapikan kutipnya, lalu simpan ulang sebagai .xlsx dan unggah kembali.';
    throw new MatrixLimitError(
      "CELL_TOO_LONG",
      `${prefix}${first}${violations.length > 3 ? ` (+${violations.length - 3} sel bermasalah lainnya).` : ""} ${hint}`,
      { fileName: limits.fileName, sheetName: limits.sheetName, violations, hint }
    );
  }
}

/** "A1:B2" -> { s:{r,c}, e:{r,c} } 0-based (format kompatibel fillMergedCells). */
function parseMergeRange(range: string): MergeLike | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range.trim().toUpperCase());
  if (!m) return null;
  const colLetters = (s: string): number => {
    let n = 0;
    for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  return {
    s: { r: Number(m[2]) - 1, c: colLetters(m[1] ?? "") },
    e: { r: Number(m[4]) - 1, c: colLetters(m[3] ?? "") },
  };
}

/** Daftar merge worksheet dalam format lama `{s:{r,c},e:{r,c}}` 0-based. */
export function getMergeRanges(ws: ExcelJS.Worksheet): MergeLike[] {
  const raw = (ws.model.merges ?? []) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: MergeLike[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const parsed = parseMergeRange(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** True bila sel (0-based) memiliki formula (untuk audit formula ala .xlsb). */
export function hasFormulaAt(ws: ExcelJS.Worksheet, r: number, c: number): boolean {
  try {
    const cell = ws.getRow(r + 1).getCell(c + 1);
    return typeof cell.formula === "string" && cell.formula !== "";
  } catch {
    return false;
  }
}

/** Pengganti `XLSX.utils.encode_cell({r, c})` (0-based -> "A1"). */
export function encodeCellAddress(r: number, c: number): string {
  let col = "";
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${r + 1}`;
}

/** Heuristik: buffer adalah teks CSV, bukan ZIP/OLE2 biner. */
function looksLikeCsv(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 2) return false;
  const bytes = new Uint8Array(buffer.slice(0, 2));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  return !isZip && !isOle;
}

export interface CsvParseResult {
  matrix: unknown[][];
  /** Delimiter yang terdeteksi. */
  delimiter: string;
  /** Peringatan non-fatal: kutip tak berpasangan, baris tanpa newline, dll. */
  warnings: string[];
  /** Jumlah sel yang dipotong karena melebihi maxCellChars. */
  truncatedCells: number;
}

/** Deteksi delimiter dari 5 baris pertama dengan skor (abaikan konten dalam kutip). */
function detectCsvDelimiter(sample: string): string {
  // Hapus segmen dalam kutip agar koma di dalam "a,b" tidak mengecoh hitungan.
  const stripped = sample.replace(/"([^"]|"")*"?/g, "");
  const lines = stripped.split(/\r\n|\n|\r/).slice(0, 5).filter((l) => l.trim() !== "");
  if (lines.length === 0) return ";";
  const count = (ch: string) =>
    lines.reduce((n, l) => n + l.split(ch).length - 1, 0) / lines.length;
  const tabs = count("\t");
  if (tabs > 0) return "\t";
  const semis = count(";");
  const commas = count(",");
  // Butuh konsistensi antar baris: pilih yang muncul di >50% baris.
  const consistency = (ch: string) =>
    lines.filter((l) => l.includes(ch)).length / lines.length;
  if (semis > 0 && consistency(";") >= 0.5 && semis >= commas) return ";";
  if (commas > 0 && consistency(",") >= 0.5) return ",";
  return semis >= commas ? ";" : ",";
}

/**
 * Parser CSV RFC-4180 yang resilient:
 * - Mendukung field multi-baris dalam kutip ("a\nb"), CRLF/LF/CR tunggal.
 * - `""` di dalam kutip = kutip literal.
 * - Kutip tak berpasangan: baris dipulihkan (kutip dianggap literal) +
 *   dicatat di warnings — inilah penyebab klasik "1 sel 2,8 juta karakter".
 * - Guard maxCellChars saat merangkai (gagal cepat, tidak menunggu string
 *   raksasa terbentuk) + guard total agar tidak OOM.
 */
export function parseCsvMatrix(
  text: string,
  defval: unknown,
  opts: { maxCellChars?: number; maxTotalChars?: number } = {}
): CsvParseResult {
  const maxCell = opts.maxCellChars ?? EXCEL_MAX_CELL_CHARS;
  const maxTotal = opts.maxTotalChars ?? EXCEL_MAX_TOTAL_CHARS;
  const delim = detectCsvDelimiter(text.slice(0, 64_000));
  const matrix: unknown[][] = [];
  const warnings: string[] = [];
  let truncatedCells = 0;
  let row: unknown[] = [];
  let cur = "";
  let inQuotes = false;
  let quoteStartLine = 0;
  let lineNo = 1;
  let total = 0;
  let truncatedCur = false;

  const pushCell = () => {
    const v = cur.trim();
    total += cur.length;
    row.push(v === "" ? defval : v);
    cur = "";
    truncatedCur = false;
  };
  const pushRow = () => {
    // Abaikan baris yang seluruhnya kosong (defval semua).
    const isEmpty = row.every((c) => c === defval);
    if (!isEmpty) matrix.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          if (!truncatedCur && cur.length < maxCell) cur += '"';
          i += 1; // konsumsi pasangan ""
        } else {
          // Lihat ke depan: kutip penutup valid hanya jika diikuti
          // delimiter / newline / akhir teks. Jika tidak, anggap kutip
          // liar (mis. 8" atau 26"ASD) -> perlakukan sebagai literal.
          if (next === delim || next === "\n" || next === "\r" || next === "") {
            inQuotes = false;
          } else {
            if (!truncatedCur && cur.length < maxCell) cur += '"';
            if (!truncatedCur && cur.length >= maxCell) {
              truncatedCur = true;
              truncatedCells += 1;
            }
          }
        }
      } else {
        if (ch === "\n") lineNo += 1;
        if (!truncatedCur) {
          if (cur.length < maxCell) cur += ch;
          else {
            truncatedCur = true;
            truncatedCells += 1;
          }
        }
        if (total + cur.length > maxTotal) {
          warnings.push(
            `Isi CSV melebihi batas total (~${maxTotal.toLocaleString("id-ID")} karakter) di sekitar baris ${lineNo}; parsing dihentikan dini agar aplikasi tidak kehabisan memori. Periksa tanda kutip tak berpasangan.`
          );
          pushCell();
          pushRow();
          return { matrix, delimiter: delim, warnings, truncatedCells };
        }
      }
      continue;
    }

    // --- di luar kutip ---
    if (ch === '"') {
      // Kutip pembuka hanya valid di awal field (setelah delimiter/baris baru).
      // Di tengah kata (mis. 8" ) -> literal, jangan masuk mode kutip.
      if (cur === "") {
        inQuotes = true;
        quoteStartLine = lineNo;
      } else {
        if (cur.length < maxCell) cur += '"';
      }
    } else if (ch === delim) {
      pushCell();
    } else if (ch === "\r" && next === "\n") {
      // CRLF -> akhir baris. Jika sebelumnya ada kutip tak berpasangan yang
      // dibuka di baris ini dan tak pernah ditutup, pulihkan sebagai literal.
      pushCell();
      pushRow();
      lineNo += 1;
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      pushCell();
      pushRow();
      lineNo += 1;
    } else {
      if (cur.length < maxCell) cur += ch;
      else if (!truncatedCur) {
        truncatedCur = true;
        truncatedCells += 1;
      }
    }
  }

  // Akhir teks saat masih dalam kutip = kutip tak berpasangan klasik.
  if (inQuotes) {
    warnings.push(
      `Tanda kutip (") tak berpasangan mulai baris ${quoteStartLine}; diperlakukan sebagai teks biasa agar satu sel tidak menelan seluruh file.`
    );
  }
  pushCell();
  pushRow();
  if (truncatedCells > 0) {
    warnings.push(
      `${truncatedCells} sel melebihi ${maxCell.toLocaleString("id-ID")} karakter dan dipotong. Jika ini terjadi di kolom resi, periksa kutip/delimiter file.`
    );
  }
  return { matrix, delimiter: delim, warnings, truncatedCells };
}

export interface LoadedWorkbook {
  sheetNames: string[];
  /** Matriks per sheet (sesuai urutan workbook). */
  matrices: Map<string, unknown[][]>;
  /** Worksheet mentah per nama (untuk merges + inspeksi formula). */
  worksheets: Map<string, ExcelJS.Worksheet>;
}

/**
 * Buffer file (browser ArrayBuffer / Node Buffer) -> workbook exceljs.
 * Signature stabil: input Buffer-ish, output daftar sheet + matriks.
 * Menolak `.xls` (OLE2) / `.xlsb` (BIFF12) dengan pesan migrasi yang jelas;
 * `.csv` diparse lewat parser bawaan.
 */
export async function loadWorkbookFromBuffer(
  input: ArrayBuffer | Uint8Array | Buffer,
  opts: { defval?: unknown; fileName?: string } & Partial<MatrixLimits> = {}
): Promise<LoadedWorkbook> {
  const defval = opts.defval ?? null;
  const fileName = opts.fileName;
  const buf =
    input instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(input))
      : Buffer.isBuffer(input)
        ? input
        : Buffer.from(input);

  // Tolak eksplisit format legacy yang tidak bisa dibaca exceljs.
  if (buf.length >= 2 && buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new Error(
      "Format .xls lama tidak didukung parser baru (exceljs). Simpan ulang berkas sebagai .xlsx lalu unggah kembali."
    );
  }

  // Jalur CSV: teks biasa (bukan ZIP) -> parser ringan.
  if (looksLikeCsv(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)) {
    const text = buf.toString("utf8");
    // Jika bukan teks yang masuk akal (biner tak dikenal), biarkan exceljs
    // yang menolak dengan pesan di bawah.
    if (text.includes("\n") || text.includes(",") || text.includes(";") || text.includes("\t") || text.includes("\r")) {
      // Guard dini: file teks > 25MB hampir pasti salah format/korup.
      if (buf.byteLength > 25 * 1024 * 1024) {
        throw new MatrixLimitError(
          "TOTAL_TOO_LARGE",
          `${fileName ? `Berkas "${fileName}" · ` : ""}Ukuran teks ${(buf.byteLength / 1048576).toFixed(1)}MB melebihi 25MB. Jika ini file .xlsx yang ter-rename jadi .csv (atau sebaliknya), kembalikan ekstensinya lalu simpan ulang sebagai .xlsx.`,
          { fileName, sheetName: "Sheet1", hint: "Pastikan ekstensi sesuai isi (CSV = teks, XLSX = biner ZIP). Simpan ulang sebagai .xlsx." }
        );
      }
      const parsed = parseCsvMatrix(text, defval, {
        maxCellChars: opts.maxCellChars,
        maxTotalChars: opts.maxTotalChars,
      });
      const matrix = parsed.matrix;
      if (opts.maxRows !== undefined || opts.maxCols !== undefined) {
        validateMatrixLimits(matrix, {
          maxRows: opts.maxRows ?? Number.MAX_SAFE_INTEGER,
          maxCols: opts.maxCols ?? Number.MAX_SAFE_INTEGER,
          maxCellChars: opts.maxCellChars,
          maxTotalChars: opts.maxTotalChars,
          onOversizeCell: opts.onOversizeCell,
          fileName,
          sheetName: "Sheet1",
        });
      }
      // Selipkan peringatan parser (kutip liar/delimiter) ke console agar
      // bisa diaudit tanpa menggagalkan upload file yang masih bisa dibaca.
      for (const w of parsed.warnings) console.warn(`[csv] ${fileName ?? ""}: ${w}`);
      return {
        sheetNames: ["Sheet1"],
        matrices: new Map([["Sheet1", matrix]]),
        worksheets: new Map(),
      };
    }
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error(
      `${fileName ? `Berkas "${fileName}" · ` : ""}Gagal membaca berkas Excel. Parser hanya mendukung .xlsx/.xlsm (dan .csv). Untuk .xls/.xlsb, simpan ulang sebagai .xlsx lalu unggah kembali.`
    );
  }
  const sheetNames = wb.worksheets.map((ws) => ws.name);
  const matrices = new Map<string, unknown[][]>();
  const worksheets = new Map<string, ExcelJS.Worksheet>();
  for (const ws of wb.worksheets) {
    matrices.set(ws.name, worksheetToMatrix(ws, defval));
    worksheets.set(ws.name, ws);
  }
  return { sheetNames, matrices, worksheets };
}

/** Matriks AOA -> objek baris (baris pertama sebagai header). */
export function matrixToObjects<T extends Record<string, unknown>>(
  matrix: unknown[][]
): T[] {
  if (matrix.length === 0) return [];
  const headers = (matrix[0] ?? []).map((h) =>
    h === null || h === undefined ? "" : String(h)
  );
  const out: T[] = [];
  for (const row of matrix.slice(1)) {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h !== "") obj[h] = (row as unknown[])[i] ?? "";
    });
    out.push(obj as T);
  }
  return out;
}

/**
 * Tulis matriks multi-sheet -> buffer `.xlsx` (untuk fixture test).
 * Signature: input record nama-sheet -> AOA, output Buffer.
 */
export async function writeAoaToBuffer(
  sheets: Record<string, unknown[][]>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of aoa) {
      ws.addRow((Array.isArray(row) ? row : []) as unknown[]);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as unknown as Uint8Array);
}

/** Tulis `.xlsx` ke path (dipakai script CLI Node + fixture test file). */
export async function writeAoaToFile(
  filePath: string,
  sheets: Record<string, unknown[][]>
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of aoa) {
      ws.addRow((Array.isArray(row) ? row : []) as unknown[]);
    }
  }
  await wb.xlsx.writeFile(filePath);
}

/**
 * Unduh AOA sebagai `.xlsx` di browser (pengganti `XLSX.writeFile`).
 * Signature: nama file + nama sheet + AOA + lebar kolom opsional.
 */
export async function downloadAoaAsXlsx(
  fileName: string,
  sheetName: string,
  aoa: (string | number)[][],
  colWidths: number[] = []
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of aoa) ws.addRow(row as unknown[]);
  if (colWidths.length > 0) {
    ws.columns = colWidths.map((w) => ({ width: w }));
  }
  const buf = await wb.xlsx.writeBuffer();
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf as unknown as ArrayBuffer);
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // Lewat helper bersama: anchor masuk DOM (Safari) + revoke tertunda.
  downloadBlob(blob, fileName);
}
