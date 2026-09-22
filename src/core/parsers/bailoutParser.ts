/**
 * Parser murni untuk modul Bailout.
 * Mengolah matriks sel mentah (hasil baca Excel) menjadi baris terstruktur.
 */

export interface BailoutRow {
  kodeLoket: string;
  namaLoket: string;
  nominal: number;
  periode: string;
}

const EMPTY_KODE_TOKENS = new Set(["", "0", "-", "NULL", "N/A", "NA"]);
const TOTAL_ROW_TOKENS = ["TOTAL", "JUMLAH", "GRANDTOTAL"];

/** Karakter tak terlihat yang harus dibuang: spasi, NBSP, zero-width, BOM. */
const INVISIBLE_CHARS = /[\s\u00A0\u200B-\u200D\uFEFF]/g;

/**
 * Normalisasi kode loket: buang spasi/karakter tak terlihat, uppercase.
 * Nilai kosong semu ('0', '-', 'NULL', 'N/A', 'NA') menjadi string kosong.
 */
export function normalizeKodeLoket(value: unknown): string {
  const cleaned = String(value ?? "")
    .replace(INVISIBLE_CHARS, "")
    .toUpperCase();
  return EMPTY_KODE_TOKENS.has(cleaned) ? "" : cleaned;
}

function cellToText(cell: unknown): string {
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" && Number.isFinite(cell)) return String(cell);
  return "";
}

/**
 * Bersihkan nilai nominal: "Rp 1.500.000" -> 1500000,
 * "(500.000)" -> -500000, "-" / kosong -> 0.
 * Format Indonesia: '.' pemisah ribuan, ',' desimal.
 */
export function cleanBailoutValue(val: unknown): number {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val !== "string") return 0;

  let s = val.replace(INVISIBLE_CHARS, "").toUpperCase();
  if (s === "" || s === "-" || s === "NULL" || s === "N/A") return 0;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")") && s.length > 2) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^RP/, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  const parsed = Number(s.replace(/\./g, "").replace(/,/g, "."));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

interface HeaderMap {
  headerRowIndex: number;
  kodeCol: number;
  namaCol: number;
  bailoutCol: number;
  periodeCol: number;
}

function compactAlpha(cell: unknown): string {
  return cellToText(cell).toUpperCase().replace(/[^A-Z]/g, "");
}

function findHeader(rows: unknown[][]): HeaderMap | null {
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    let kodeCol = -1;
    let namaCol = -1;
    let bailoutCol = -1;
    let periodeCol = -1;
    for (let c = 0; c < row.length; c += 1) {
      const compact = compactAlpha(row[c]);
      if (kodeCol === -1 && compact.includes("KODE")) kodeCol = c;
      else if (namaCol === -1 && compact.includes("NAMA")) namaCol = c;
      else if (bailoutCol === -1 && compact.includes("BAILOUT")) bailoutCol = c;
      else if (periodeCol === -1 && compact.includes("PERIODE")) periodeCol = c;
    }
    if (kodeCol !== -1 && namaCol !== -1 && bailoutCol !== -1 && periodeCol !== -1) {
      return { headerRowIndex: r, kodeCol, namaCol, bailoutCol, periodeCol };
    }
  }
  return null;
}

function isTotalRow(kodeLoket: string, namaLoket: string): boolean {
  const tokens = [kodeLoket, namaLoket.toUpperCase().replace(/[^A-Z]/g, "")];
  return tokens.some((token) => token !== "" && TOTAL_ROW_TOKENS.includes(token));
}

/**
 * Parse matriks sel menjadi baris bailout.
 * Header dicari dinamis (KODE, NAMA, BAILOUT, PERIODE),
 * baris TOTAL/JUMLAH/GRAND TOTAL dan kode kosong dilewati.
 */
export function parseBailoutRows(rows: unknown[][]): BailoutRow[] {
  const header = findHeader(rows);
  if (!header) return [];

  const result: BailoutRow[] = [];
  for (let r = header.headerRowIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const kodeLoket = normalizeKodeLoket(cellToText(row[header.kodeCol]));
    const namaLoket = cellToText(row[header.namaCol]).trim();
    if (kodeLoket === "" || isTotalRow(kodeLoket, namaLoket)) continue;

    result.push({
      kodeLoket,
      namaLoket,
      nominal: cleanBailoutValue(row[header.bailoutCol]),
      periode: cellToText(row[header.periodeCol]).trim(),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Port dari `kurlog-operations-portal` (lib/bailoutParser.ts):
// alias header fleksibel, normalisasi nama, skor baris header, sanitasi
// periode ke ISO, parser AOA longgar (periode opsional + dedup kode),
// dan parser paste TSV mentah. Bentuk baris mengikuti BailoutRow modul ini.
// ---------------------------------------------------------------------------

export const KODE_ALIASES = [
  "KODE LOKET",
  "KODE",
  "MITRA ID",
  "PAYMENT POINT",
  "KODE AGEN",
  "KODE LOKET DI ONPAYS",
] as const;

export const NAMA_ALIASES = [
  "NAMA LOKET",
  "NAMA",
  "NAMA MITRA",
  "NAMA PAYMENT POINT",
  "NAMA AGEN",
  "NAMA LOKET DI ONPAYS",
] as const;

export const BAILOUT_ALIASES = [
  "BAILOUT",
  "MINUS",
  "MINUS H-1",
  "NOMINAL",
  "SALDO MINUS",
] as const;

export const PERIODE_ALIASES = [
  "PERIODE",
  "TANGGAL",
  "DATE",
  "PERIOD",
  "TGL",
] as const;

const PASTE_NBSP_REGEX = /\u00A0/g;
const PASTE_ZERO_WIDTH_REGEX = /[\uFEFF\u200B\u200C\u200D\u2060\u180E]/g;

/** NBSP -> spasi, zero-width -> hapus, CR -> hapus (delimiter TAB dipertahankan). */
function stripPasteInvisible(value: string): string {
  return value
    .replace(PASTE_NBSP_REGEX, " ")
    .replace(PASTE_ZERO_WIDTH_REGEX, "")
    .replace(/\r/g, "");
}

/** Header/sel: bersihkan invisible, \t\n -> spasi, trim, uppercase, collapse. */
function normalizePasteCell(value: unknown): string {
  return stripPasteInvisible(String(value ?? ""))
    .replace(/[\t\n]/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/** Normalisasi nama untuk preview (trim + collapse spasi, bersihkan invisible). */
export function normalizeNama(value: unknown): string {
  return stripPasteInvisible(String(value ?? ""))
    .replace(/[\t\n]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findBestColumnIndex(
  normalizedHeader: string[],
  aliases: readonly string[]
): number {
  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    const idx = normalizedHeader.findIndex((cell) => cell.includes(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function findColumnIndices(headerRow: unknown[]): {
  kodeIdx: number;
  namaIdx: number;
  bailoutIdx: number;
  periodeIdx: number;
} {
  const normalized = headerRow.map(normalizePasteCell);
  return {
    kodeIdx: findBestColumnIndex(normalized, KODE_ALIASES),
    namaIdx: findBestColumnIndex(normalized, NAMA_ALIASES),
    bailoutIdx: findBestColumnIndex(normalized, BAILOUT_ALIASES),
    periodeIdx: findBestColumnIndex(normalized, PERIODE_ALIASES),
  };
}

/**
 * Skor baris header (maks 10 baris): KODE/NAMA/BAILOUT masing-masing +1,
 * PERIODE opsional +0.5. Skor >= 3 langsung menang, terbaik >= 1 diterima.
 */
export function findHeaderRowIndex(rows: unknown[][]): number {
  let bestIdx = -1;
  let bestScore = 0;
  const maxScan = Math.min(rows.length, 10);
  for (let i = 0; i < maxScan; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const normalized = row.map(normalizePasteCell);
    let score = 0;
    if (
      normalized.some((cell) => KODE_ALIASES.some((alias) => cell.includes(alias)))
    )
      score++;
    if (
      normalized.some((cell) => NAMA_ALIASES.some((alias) => cell.includes(alias)))
    )
      score++;
    if (
      normalized.some((cell) =>
        BAILOUT_ALIASES.some((alias) => cell.includes(alias))
      )
    )
      score++;
    // periode bersifat opsional, tidak menambah score wajib tapi jadi tie-breaker
    if (
      normalized.some((cell) =>
        PERIODE_ALIASES.some((alias) => cell.includes(alias))
      )
    )
      score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    if (score >= 3) return i;
  }
  if (bestScore >= 1) return bestIdx;
  return -1;
}

/** Alias kompatibilitas: parseBailoutValue == cleanBailoutValue. */
export const parseBailoutValue = cleanBailoutValue;

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d))
    return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

/**
 * Sanitasi periode/tanggal dari Excel/copas ke ISO YYYY-MM-DD.
 * Mendukung: YYYYMMDD, YYYY-MM-DD(/.), DD/MM/YYYY(-.), serial Excel,
 * dan fallback Date native tervalidasi. Null bila tidak valid
 * (tidak pernah mengembalikan "Invalid Date").
 */
export function normalizePeriodeToISO(value: unknown): string | null {
  if (value == null) return null;
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const asStr = String(Math.trunc(value));
    if (/^\d{8}$/.test(asStr)) {
      raw = asStr;
    } else {
      // Serial Excel (days since 1899-12-30) bila dalam range wajar
      if (value > 30000 && value < 60000) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + Math.trunc(value) * 86400000);
        if (!isNaN(d.getTime())) {
          const y = d.getUTCFullYear();
          const m = d.getUTCMonth() + 1;
          const day = d.getUTCDate();
          if (isValidCalendarDate(y, m, day)) {
            return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          }
        }
      }
      raw = asStr;
    }
  } else {
    raw = String(value);
  }

  const str = stripPasteInvisible(raw).replace(/\s+/g, " ").trim();
  if (
    str === "" ||
    str === "-" ||
    str.toUpperCase() === "NULL" ||
    str.toUpperCase() === "N/A"
  )
    return null;

  // 1) YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    const y = Number(str.slice(0, 4));
    const m = Number(str.slice(4, 6));
    const d = Number(str.slice(6, 8));
    if (isValidCalendarDate(y, m, d))
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return null;
  }

  // 2) YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  const ymdMatch = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymdMatch) {
    const y = Number(ymdMatch[1]);
    const m = Number(ymdMatch[2]);
    const d = Number(ymdMatch[3]);
    if (isValidCalendarDate(y, m, d))
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return null;
  }

  // 3) DD/MM/YYYY atau DD-MM-YYYY atau DD.MM.YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    if (isValidCalendarDate(y, m, d))
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return null;
  }

  // 4) Fallback Date native tervalidasi
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

/** Selalu mengembalikan ISO valid (fallback hari ini bila null). */
export function sanitizePeriodeOrToday(value: unknown): string {
  const iso = normalizePeriodeToISO(value);
  if (iso) return iso;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse baris bailout dari AOA dengan header dinamis (periode opsional).
 * Deduplikasi: kode yang sama -> last wins.
 */
export function parseBailoutRowsFromAOA(rows: unknown[][]): BailoutRow[] {
  if (rows.length === 0) return [];
  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) return [];
  const headerRow = rows[headerIdx] ?? [];
  const { kodeIdx, namaIdx, bailoutIdx, periodeIdx } =
    findColumnIndices(headerRow);
  if (kodeIdx === -1 && namaIdx === -1 && bailoutIdx === -1) return [];

  const dedup = new Map<string, BailoutRow>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    if (row.every((c) => stripPasteInvisible(String(c ?? "")).trim() === ""))
      continue;

    const kodeLoket = normalizeKodeLoket(kodeIdx !== -1 ? row[kodeIdx] : "");
    const namaLoket = namaIdx !== -1 ? normalizeNama(row[namaIdx] ?? "") : "";
    const nominal =
      bailoutIdx !== -1 ? cleanBailoutValue(row[bailoutIdx] ?? "") : 0;
    const periode =
      periodeIdx !== -1 ? cellToText(row[periodeIdx]).trim() : "";

    if (!namaLoket && !kodeLoket) continue;
    const upperNama = namaLoket.toUpperCase();
    if (upperNama === "TOTAL" || kodeLoket === "TOTAL") continue;
    if (upperNama.includes("JUMLAH") || upperNama.includes("GRAND TOTAL"))
      continue;

    const key = kodeLoket === "" ? `__row_${i}` : kodeLoket;
    const existing = dedup.get(key);
    dedup.set(key, {
      kodeLoket,
      namaLoket: namaLoket === "" ? (existing?.namaLoket ?? "") : namaLoket,
      nominal,
      periode,
    });
  }
  return Array.from(dedup.values());
}

/**
 * Parser paste (tab-separated dari Excel/Spreadsheet).
 * Tidak menghapus \t sebelum split; sanitasi invisible dilakukan setelah
 * mempertahankan delimiter. Fallback koma, lalu 2+ spasi (copas PDF).
 */
export function parseBailoutFromPaste(text: string): BailoutRow[] {
  if (!text || stripPasteInvisible(text).trim() === "") return [];

  const sanitized = stripPasteInvisible(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const rawLines = sanitized.split("\n");
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const rows: string[][] = lines.map((line) => {
    if (line.includes("\t")) {
      return line.split("\t").map((c) => stripPasteInvisible(c).trim());
    }
    if (line.includes(",")) {
      return line.split(",").map((c) => stripPasteInvisible(c).trim());
    }
    return line.split(/\s{2,}/).map((c) => stripPasteInvisible(c).trim());
  });

  const headerIdx = findHeaderRowIndex(rows as unknown[][]);
  if (headerIdx === -1) return [];
  const headerRow = rows[headerIdx] ?? [];
  const { kodeIdx, namaIdx, bailoutIdx } = findColumnIndices(headerRow);
  if (kodeIdx === -1 && namaIdx === -1 && bailoutIdx === -1) return [];

  const dedup = new Map<string, BailoutRow>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cols = rows[i] ?? [];
    if (cols.length === 0) continue;
    if (cols.every((c) => String(c ?? "").trim() === "")) continue;

    const kodeLoket = normalizeKodeLoket(
      kodeIdx !== -1 ? (cols[kodeIdx] ?? "") : ""
    );
    const namaLoket = namaIdx !== -1 ? normalizeNama(cols[namaIdx] ?? "") : "";
    const nominal =
      bailoutIdx !== -1 ? cleanBailoutValue(cols[bailoutIdx] ?? "") : 0;

    if (!namaLoket && !kodeLoket) continue;
    if (namaLoket.toUpperCase() === "TOTAL" || kodeLoket === "TOTAL") continue;
    if (!namaLoket) continue;
    if (
      namaLoket.toUpperCase().includes("JUMLAH") ||
      namaLoket.toUpperCase().includes("GRAND TOTAL")
    )
      continue;

    const key = kodeLoket === "" ? `__row_${i}` : kodeLoket;
    const existing = dedup.get(key);
    dedup.set(key, {
      kodeLoket,
      namaLoket: namaLoket === "" ? (existing?.namaLoket ?? "") : namaLoket,
      nominal,
      periode: "",
    });
  }
  return Array.from(dedup.values()).filter(
    (row) =>
      row.namaLoket.trim() !== "" && row.namaLoket.toUpperCase() !== "TOTAL"
  );
}
