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

export const EXCEL_MAX_CELL_CHARS = 32767;

export interface MatrixLimits {
  maxRows: number;
  maxCols: number;
  maxCellChars?: number;
}

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
      return String(result);
    }
    // Rich text: { richText: [{text}] } -> gabungkan.
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: unknown }[])
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
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

/** Validasi batas matriks; throw pesan Indonesia yang jelas bila lewat. */
export function validateMatrixLimits(
  matrix: unknown[][],
  limits: MatrixLimits
): void {
  const maxCell = limits.maxCellChars ?? EXCEL_MAX_CELL_CHARS;
  if (matrix.length > limits.maxRows) {
    throw new Error(
      `Terlalu banyak baris (${matrix.length}). Maksimal ${limits.maxRows}. Pecah file menjadi beberapa bagian.`
    );
  }
  let width = 0;
  for (const row of matrix.slice(0, Math.min(matrix.length, 10))) {
    if (Array.isArray(row) && row.length > width) width = row.length;
  }
  if (width > limits.maxCols) {
    throw new Error(
      `Terlalu banyak kolom (${width}). Maksimal ${limits.maxCols}.`
    );
  }
  for (let r = 0; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (typeof cell === "string" && cell.length > maxCell) {
        throw new Error(
          `Sel baris ${r + 1} kolom ${c + 1} terlalu panjang (${cell.length} karakter). Maksimal ${maxCell}.`
        );
      }
    }
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

/** Parser CSV ringan: deteksi delimiter tab > `;` > `,` pada 5 baris pertama. */
function parseCsvMatrix(text: string, defval: unknown): unknown[][] {
  const lines = text.split(/\r?\n/);
  const sample = lines.slice(0, 5).join("\n");
  const tabs = (sample.match(/\t/g) ?? []).length;
  const semis = (sample.match(/;/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  const delim = tabs > 0 ? "\t" : semis >= commas ? ";" : ",";
  const matrix: unknown[][] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    // Split sederhana dengan dukungan quote ganda standar CSV.
    const cells: unknown[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        const v = cur.trim();
        cells.push(v === "" ? defval : v);
        cur = "";
      } else {
        cur += ch;
      }
    }
    const v = cur.trim();
    cells.push(v === "" ? defval : v);
    matrix.push(cells);
  }
  return matrix;
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
  opts: { defval?: unknown } & Partial<MatrixLimits> = {}
): Promise<LoadedWorkbook> {
  const defval = opts.defval ?? null;
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
    if (text.includes("\n") || text.includes(",") || text.includes(";") || text.includes("\t")) {
      const matrix = parseCsvMatrix(text, defval);
      if (opts.maxRows !== undefined || opts.maxCols !== undefined) {
        validateMatrixLimits(matrix, {
          maxRows: opts.maxRows ?? Number.MAX_SAFE_INTEGER,
          maxCols: opts.maxCols ?? Number.MAX_SAFE_INTEGER,
          maxCellChars: opts.maxCellChars,
        });
      }
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
      "Gagal membaca berkas Excel. Parser baru hanya mendukung .xlsx/.xlsm (dan .csv). Untuk .xls/.xlsb, simpan ulang sebagai .xlsx lalu unggah kembali."
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
