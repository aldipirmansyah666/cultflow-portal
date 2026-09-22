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

const EC3_PREFIXES = ["SHPE", "P260"] as const;
const PKH_PREFIXES = ["P260", "TTSPOS"] as const;

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function startsWithAny(resi: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => resi.startsWith(prefix));
}

function validateRow(row: ReconcileInputRow, index: number): ReconcileRowResult {
  const produk = normalize(row.produk);
  const nomorResi = normalize(row.nomor_resi);

  if (produk === "EC3" && !startsWithAny(nomorResi, EC3_PREFIXES)) {
    return {
      index,
      produk,
      nomorResi,
      isValid: false,
      reason: "Resi EC3 harus diawali SHPE atau P260",
    };
  }

  if (produk === "PKH" && !startsWithAny(nomorResi, PKH_PREFIXES)) {
    return {
      index,
      produk,
      nomorResi,
      isValid: false,
      reason: "Resi PKH harus diawali P260 atau TTSPOS",
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
    for (const prefix of PKH_PREFIXES) {
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

/**
 * Validasi baris-baris reconcile beserta cakupan file.
 * Perbandingan produk & resi bersifat case-insensitive (di-trim + uppercase).
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
