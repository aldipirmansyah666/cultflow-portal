/**
 * Validator murni untuk modul Reconcile.
 *
 * Rule 1 (row-level): prefix resi wajib sesuai produk.
 * Rule 2 (file-level): cakupan prefix wajib dalam satu berkas.
 */

export interface ReconcileInputRow {
  produk?: string;
  nomor_resi?: string;
}

export interface ReconcileRowResult {
  index: number;
  produk: string;
  nomorResi: string;
  isValid: boolean;
  reason?: string;
}

export type ReconcileFileRule = "EC3_PREFIX_COVERAGE" | "PKH_PREFIX_COVERAGE";

export interface ReconcileFileIssue {
  rule: ReconcileFileRule;
  message: string;
}

export interface ReconcileValidationResult {
  rows: ReconcileRowResult[];
  fileIssues: ReconcileFileIssue[];
  isValid: boolean;
  summary: { total: number; valid: number; invalid: number };
}

export const EC3_PREFIXES = ["SHPE", "P260"] as const;
/** Prefix diterima untuk PKH (Rule 1 / validasi baris). */
export const PKH_ACCEPTED_PREFIXES = ["P260", "TTSPOS", "26MNG"] as const;
/**
 * Prefix wajib cakupan berkas PKH (Rule 2). SENGAJA tanpa 26MNG agar
 * berkas lama (P260+TTSPOS) tidak tertolak.
 */
export const PKH_REQUIRED_COVERAGE = ["P260", "TTSPOS"] as const;

const NBSP_REGEX = /\u00A0/g;
const ZERO_WIDTH_REGEX = /[\uFEFF\u200B\u200C\u200D\u2060\u180E]/g;

/** Buang karakter tak kasatmata (NBSP, zero-width, carriage return). */
function stripInvisible(value: string): string {
  return value
    .replace(NBSP_REGEX, "")
    .replace(ZERO_WIDTH_REGEX, "")
    .replace(/\r/g, "");
}

function normalize(value: unknown): string {
  return stripInvisible(String(value ?? "")).trim().toUpperCase();
}

/** Normalisasi nomor resi: tak kasatmata + seluruh spasi dihapus + uppercase. */
export function normalizeResi(value: unknown): string {
  return normalize(value).replace(/\s+/g, "");
}

function startsWithAny(resi: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => resi.startsWith(prefix));
}

function validateRow(row: ReconcileInputRow, index: number): ReconcileRowResult {
  const produk = normalize(row.produk);
  const nomorResi = normalizeResi(row.nomor_resi);

  if (produk === "EC3" && !startsWithAny(nomorResi, EC3_PREFIXES)) {
    return {
      index,
      produk,
      nomorResi,
      isValid: false,
      reason: "Resi EC3 harus diawali SHPE atau P260",
    };
  }

  if (produk === "PKH" && !startsWithAny(nomorResi, PKH_ACCEPTED_PREFIXES)) {
    return {
      index,
      produk,
      nomorResi,
      isValid: false,
      reason: "Resi PKH harus diawali P260, TTSPOS, atau 26MNG",
    };
  }

  return { index, produk, nomorResi, isValid: true };
}

function checkFileCoverage(results: ReconcileRowResult[]): ReconcileFileIssue[] {
  const issues: ReconcileFileIssue[] = [];
  const hasProduct = (produk: string) =>
    results.some((row) => row.produk === produk);
  const hasResiPrefix = (prefix: string) =>
    results.some((row) => row.nomorResi.startsWith(prefix));

  if (hasProduct("EC3")) {
    for (const prefix of EC3_PREFIXES) {
      if (!hasResiPrefix(prefix)) {
        issues.push({
          rule: "EC3_PREFIX_COVERAGE",
          message: `Berkas memuat produk EC3 tetapi tidak ada resi ${prefix}`,
        });
      }
    }
  }

  if (hasProduct("PKH")) {
    for (const prefix of PKH_REQUIRED_COVERAGE) {
      if (!hasResiPrefix(prefix)) {
        issues.push({
          rule: "PKH_PREFIX_COVERAGE",
          message: `Berkas memuat produk PKH tetapi tidak ada resi ${prefix}`,
        });
      }
    }
  }

  return issues;
}

export interface ReconcileBreakdown {
  pkhValid: number;
  ec3Valid: number;
  pkhInvalid: number;
  ec3Invalid: number;
  /** Resi valid per prefix (PKH: P260/TTSPOS/26MNG). */
  pkhValidByPrefix: Record<(typeof PKH_ACCEPTED_PREFIXES)[number], number>;
  /** Resi valid per prefix (EC3: SHPE/P260). */
  ec3ValidByPrefix: Record<(typeof EC3_PREFIXES)[number], number>;
}

/** Rincian jumlah resi per produk & prefix dari hasil validasi baris. */
export function buildReconcileBreakdown(
  rows: ReconcileRowResult[]
): ReconcileBreakdown {
  const breakdown: ReconcileBreakdown = {
    pkhValid: 0,
    ec3Valid: 0,
    pkhInvalid: 0,
    ec3Invalid: 0,
    pkhValidByPrefix: { P260: 0, TTSPOS: 0, "26MNG": 0 },
    ec3ValidByPrefix: { SHPE: 0, P260: 0 },
  };
  for (const row of rows) {
    if (row.produk === "PKH") {
      if (!row.isValid) {
        breakdown.pkhInvalid += 1;
        continue;
      }
      breakdown.pkhValid += 1;
      for (const prefix of PKH_ACCEPTED_PREFIXES) {
        if (row.nomorResi.startsWith(prefix)) {
          breakdown.pkhValidByPrefix[prefix] += 1;
          break;
        }
      }
    } else if (row.produk === "EC3") {
      if (!row.isValid) {
        breakdown.ec3Invalid += 1;
        continue;
      }
      breakdown.ec3Valid += 1;
      for (const prefix of EC3_PREFIXES) {
        if (row.nomorResi.startsWith(prefix)) {
          breakdown.ec3ValidByPrefix[prefix] += 1;
          break;
        }
      }
    }
  }
  return breakdown;
}

/**
 * Validasi baris-baris reconcile beserta cakupan file.
 * Perbandingan produk & resi bersifat case-insensitive (buang karakter tak
 * kasatmata + trim + uppercase; nomor resi juga hapus seluruh spasi dalam).
 */
export function validateReconcileRows(
  rows: ReconcileInputRow[],
): ReconcileValidationResult {
  const validated = rows.map((row, index) => validateRow(row, index));
  const fileIssues = checkFileCoverage(validated);
  const invalid = validated.filter((row) => !row.isValid).length;

  return {
    rows: validated,
    fileIssues,
    isValid: invalid === 0 && fileIssues.length === 0,
    summary: {
      total: validated.length,
      valid: validated.length - invalid,
      invalid,
    },
  };
}
