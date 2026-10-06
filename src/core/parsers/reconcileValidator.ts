/**
 * Validator murni untuk modul Reconcile.
 *
 * Rule 1 (row-level): prefix resi wajib sesuai produk; produk di luar
 * daftar didukung ditolak sebagai UNKNOWN_OR_INVALID_PRODUCT.
 * Rule 1b (row-level): nomor resi ganda dalam satu berkas ditandai
 * DUPLICATE_RESI (berbasis Map frekuensi resi ternormalisasi).
 * Rule 2 (file-level): cakupan prefix wajib dalam satu berkas — DIPERIKSA
 * PER PRODUK (prefix EC3 hanya dihitung dari baris EC3, dst.) agar berkas
 * campuran tidak lolos false-negative.
 */

export interface ReconcileInputRow {
  produk?: string;
  nomor_resi?: string;
}

/** Kategori mesin tiap celah baris — untuk filter/agregasi di UI. */
export type ReconcileRowCode =
  | "PREFIX_MISMATCH"
  | "UNKNOWN_OR_INVALID_PRODUCT"
  | "DUPLICATE_RESI";

export interface ReconcileRowResult {
  index: number;
  produk: string;
  nomorResi: string;
  isValid: boolean;
  reason?: string;
  /** Kategori mesin (opsional agar kompatibel dengan hasil lama). */
  code?: ReconcileRowCode;
}

export type ReconcileFileRule =
  | "EC3_PREFIX_COVERAGE"
  | "PKH_PREFIX_COVERAGE"
  | "PRODUCT_PREFIX_COVERAGE";

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

export const EC3_PREFIXES = ["SHPE", "P26"] as const;
/**
 * Daftar awalan resi BERSAMA untuk produk PKH, PJB, dan PE (Rule 1).
 * Perbandingan case-insensitive via startsWith pada resi ternormalisasi.
 * "26" generik sengaja di akhir: pencocokan validasi tidak sensitif
 * urutan, tetapi penghitungan breakdown memakai longest-match dulu agar
 * "26MNG…" tercatat sebagai 26MNG, bukan 26.
 */
export const SHARED_PREFIXES_PKH_PJB_PE = [
  "P26",
  "TTSPOS",
  "26MNG",
  "26KOM",
  "26EVP",
  "26ASD",
  "26",
] as const;
/** Prefix diterima untuk PKH (Rule 1 / validasi baris) = daftar bersama. */
export const PKH_ACCEPTED_PREFIXES = SHARED_PREFIXES_PKH_PJB_PE;
/**
 * Prefix wajib cakupan berkas PKH (Rule 2). SENGAJA tanpa 26MNG/varian 26
 * lain agar berkas lama (P26+TTSPOS) tidak tertolak.
 */
export const PKH_REQUIRED_COVERAGE = ["P26", "TTSPOS"] as const;

/** Produk yang didukung validator. Di luar ini = UNKNOWN_OR_INVALID_PRODUCT. */
export const SUPPORTED_PRODUCTS = [
  "EC3",
  "PKH",
  "P260",
  "TTSPOS",
  "PE",
  "PJB",
  // Layanan resmi POS tambahan. Daftar prefix per produk di PRODUCT_PREFIXES;
  // prefix bertanda DEFAULT memakai kode produk itu sendiri dan WAJIB
  // dikonfirmasi ulang terhadap data rekon aktual bila ada mismatch massal.
  "3PE", // Pos Ekspor: 3PE... / CC...
  "312", // EMS Barang: EE... (format UPU S10)
  "PPB_PKT",
  "PJE",
  "PJM",
  "Q9",
  "311",
  "010",
  "331",
  "332",
  "3LX",
  "3LP",
] as const;
export type SupportedProduct = (typeof SUPPORTED_PRODUCTS)[number];

/** Prefix resi yang diterima per produk (Rule 1). */
const PRODUCT_PREFIXES: Record<SupportedProduct, readonly string[]> = {
  EC3: EC3_PREFIXES,
  PKH: SHARED_PREFIXES_PKH_PJB_PE,
  P260: ["P26"],
  TTSPOS: ["TTSPOS"],
  // PE & PJB memakai daftar bersama yang SAMA PERSIS dengan PKH
  // (lihat SHARED_PREFIXES_PKH_PJB_PE). Bila format aslinya ternyata
  // berbeda antar produk, pecah array ini per produk di satu titik ini.
  PE: SHARED_PREFIXES_PKH_PJB_PE,
  PJB: SHARED_PREFIXES_PKH_PJB_PE,
  "3PE": ["3PE", "CC"], // Pos Ekspor (data rekon)
  "312": ["EE"], // EMS Barang (UPU S10)
  PPB_PKT: ["PPB"], // DEFAULT: konfirmasi ke data rekon
  PJE: ["PJE"], // DEFAULT: konfirmasi ke data rekon
  PJM: ["PJM"], // DEFAULT: konfirmasi ke data rekon
  Q9: ["Q9"], // DEFAULT: konfirmasi ke data rekon
  "311": ["EE"], // EMS Dokumen (UPU S10, data rekon)
  "010": ["010"], // DEFAULT: konfirmasi ke data rekon
  "331": ["CP"], // Pos Paket Internasional (UPU S10 Colis, data rekon)
  "332": ["CP"], // Pos Paket Internasional (UPU S10 Colis, data rekon)
  "3LX": ["3LX"], // DEFAULT: konfirmasi ke data rekon
  "3LP": ["3LP"], // DEFAULT: konfirmasi ke data rekon
};

function isSupportedProduct(value: string): value is SupportedProduct {
  return (SUPPORTED_PRODUCTS as readonly string[]).includes(value);
}

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

/**
 * Prefix PKH terurut panjang-menurun untuk penghitungan breakdown
 * (longest-match): tanpa ini, prefix generik "26" akan menelan "26MNG",
 * "26KOM", dsb. Validasi `startsWithAny` tidak sensitif urutan.
 */
const PKH_PREFIXES_BY_LENGTH: readonly (
  (typeof PKH_ACCEPTED_PREFIXES)[number]
)[] = [...PKH_ACCEPTED_PREFIXES].sort((a, b) => b.length - a.length);

/**
 * Daftar prefix untuk pesan alasan, gaya Indonesia:
 * ["A"] -> "A"; ["A","B"] -> "A atau B";
 * ["A","B","C"] -> "A, B, atau C". Dibangun dinamis dari konstanta
 * agar pesan tidak drift saat daftar prefix berubah.
 */
function formatPrefixList(prefixes: readonly string[]): string {
  if (prefixes.length === 0) return "";
  if (prefixes.length === 1) return prefixes[0] ?? "";
  const head = prefixes.slice(0, -1).join(", ");
  return `${head}, atau ${prefixes[prefixes.length - 1] ?? ""}`;
}

const UNKNOWN_PRODUCT_REASON =
  `UNKNOWN_OR_INVALID_PRODUCT: produk tidak didukung (harus ${SUPPORTED_PRODUCTS.join(", ")})`;
const DUPLICATE_RESI_REASON =
  "DUPLICATE_RESI: nomor resi ganda dalam berkas";

function validateRow(row: ReconcileInputRow, index: number): ReconcileRowResult {
  const produk = normalize(row.produk);
  const nomorResi = normalizeResi(row.nomor_resi);

  if (!isSupportedProduct(produk)) {
    return {
      index,
      produk,
      nomorResi,
      isValid: false,
      reason: produk === "" ? `${UNKNOWN_PRODUCT_REASON} (produk kosong)` : UNKNOWN_PRODUCT_REASON,
      code: "UNKNOWN_OR_INVALID_PRODUCT",
    };
  }

  if (!startsWithAny(nomorResi, PRODUCT_PREFIXES[produk])) {
    const accepted = PRODUCT_PREFIXES[produk];
    const reason =
      produk === "EC3"
        ? "Resi EC3 harus diawali SHPE atau P26"
        : accepted === SHARED_PREFIXES_PKH_PJB_PE
          ? `Resi ${produk} harus diawali ${formatPrefixList(SHARED_PREFIXES_PKH_PJB_PE)}`
          : `Resi ${produk} harus diawali ${[...accepted].join(" atau ")}`;
    return { index, produk, nomorResi, isValid: false, reason, code: "PREFIX_MISMATCH" };
  }

  return { index, produk, nomorResi, isValid: true };
}

/**
 * Frekuensi resi ternormalisasi (Map) — fondasi deteksi duplikat.
 * Resi kosong ("") dikecualikan agar baris-baris kosong tidak saling
 * dituduh ganda.
 */
export function countResiOccurrences(
  rows: Pick<ReconcileRowResult, "nomorResi">[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.nomorResi === "") continue;
    counts.set(row.nomorResi, (counts.get(row.nomorResi) ?? 0) + 1);
  }
  return counts;
}

/**
 * Tandai baris-baris ber-resi ganda sebagai invalid (Rule 1b).
 * Baris yang sudah invalid karena alasan lain tetap invalid — alasan
 * duplikat ditambahkan agar kedua masalah terekam.
 */
function markDuplicateResi(rows: ReconcileRowResult[]): void {
  const counts = countResiOccurrences(rows);
  for (const row of rows) {
    if (row.nomorResi === "" || (counts.get(row.nomorResi) ?? 0) <= 1) {
      continue;
    }
    if (row.isValid) {
      row.isValid = false;
      row.reason = DUPLICATE_RESI_REASON;
      row.code = "DUPLICATE_RESI";
    } else if (!row.reason?.includes("DUPLICATE_RESI")) {
      row.reason = `${row.reason} ; ${DUPLICATE_RESI_REASON}`;
    }
  }
}

function checkFileCoverage(results: ReconcileRowResult[]): ReconcileFileIssue[] {
  const issues: ReconcileFileIssue[] = [];
  const hasProduct = (produk: string) =>
    results.some((row) => row.produk === produk);
  // WAJIB per produk: prefix hanya dihitung dari baris berproduk sama.
  // (Sebelumnya lintas-produk: resi P26 milik EC3 bisa membuat syarat
  // PKH lolos — false negative pada berkas campuran.)
  const hasResiPrefixFor = (produk: string, prefix: string) =>
    results.some(
      (row) => row.produk === produk && row.nomorResi.startsWith(prefix)
    );
  // Cakupan longgar untuk PE/PJB: cukup SATU resi berproduk sama yang
  // diawali SALAH SATU prefix bersama. Mencegah false warning pada
  // berkas valid (mis. resi 26KOM sah tetapi tidak berprefix "PE").
  const hasSharedPrefixFor = (produk: string) =>
    results.some(
      (row) =>
        row.produk === produk &&
        SHARED_PREFIXES_PKH_PJB_PE.some((prefix) =>
          row.nomorResi.startsWith(prefix)
        )
    );

  if (hasProduct("EC3")) {
    for (const prefix of EC3_PREFIXES) {
      if (!hasResiPrefixFor("EC3", prefix)) {
        issues.push({
          rule: "EC3_PREFIX_COVERAGE",
          message: `Berkas memuat produk EC3 tetapi tidak ada resi EC3 berprefix ${prefix}`,
        });
      }
    }
  }

  if (hasProduct("PKH")) {
    for (const prefix of PKH_REQUIRED_COVERAGE) {
      if (!hasResiPrefixFor("PKH", prefix)) {
        issues.push({
          rule: "PKH_PREFIX_COVERAGE",
          message: `Berkas memuat produk PKH tetapi tidak ada resi PKH berprefix ${prefix}`,
        });
      }
    }
  }

  if (hasProduct("P260") && !hasResiPrefixFor("P260", "P26")) {
    issues.push({
      rule: "PRODUCT_PREFIX_COVERAGE",
      message: `Berkas memuat produk P260 tetapi tidak ada resi P260 berprefix P26`,
    });
  }

  if (hasProduct("TTSPOS") && !hasResiPrefixFor("TTSPOS", "TTSPOS")) {
    issues.push({
      rule: "PRODUCT_PREFIX_COVERAGE",
      message: `Berkas memuat produk TTSPOS tetapi tidak ada resi TTSPOS berprefix TTSPOS`,
    });
  }

  if (hasProduct("PE") && !hasSharedPrefixFor("PE")) {
    issues.push({
      rule: "PRODUCT_PREFIX_COVERAGE",
      message: `Berkas memuat produk PE tetapi tidak ada resi PE berprefix valid (${formatPrefixList(SHARED_PREFIXES_PKH_PJB_PE)})`,
    });
  }

  if (hasProduct("PJB") && !hasSharedPrefixFor("PJB")) {
    issues.push({
      rule: "PRODUCT_PREFIX_COVERAGE",
      message: `Berkas memuat produk PJB tetapi tidak ada resi PJB berprefix valid (${formatPrefixList(SHARED_PREFIXES_PKH_PJB_PE)})`,
    });
  }

  // Cakupan longgar generik untuk layanan lain (3PE, 312, Q9, ...):
  // cukup SATU resi berproduk sama yang diawali SALAH SATU prefix yang
  // diterima produk tersebut. EC3/PKH/P260/TTSPOS/PE/PJB ditangani di atas.
  const STRICT_COVERAGE_PRODUCTS = new Set(["EC3", "PKH", "P260", "TTSPOS", "PE", "PJB"]);
  for (const produk of SUPPORTED_PRODUCTS) {
    if (STRICT_COVERAGE_PRODUCTS.has(produk)) continue;
    if (
      hasProduct(produk) &&
      !PRODUCT_PREFIXES[produk].some((prefix) => hasResiPrefixFor(produk, prefix))
    ) {
      issues.push({
        rule: "PRODUCT_PREFIX_COVERAGE",
        message: `Berkas memuat produk ${produk} tetapi tidak ada resi ${produk} berprefix valid (${formatPrefixList(PRODUCT_PREFIXES[produk])})`,
      });
    }
  }

  return issues;
}

export interface ReconcileBreakdown {
  pkhValid: number;
  ec3Valid: number;
  pkhInvalid: number;
  ec3Invalid: number;
  /** Resi valid per prefix PKH (longest-match; lihat buildReconcileBreakdown). */
  pkhValidByPrefix: Record<(typeof PKH_ACCEPTED_PREFIXES)[number], number>;
  /** Resi valid per prefix (EC3: SHPE/P26). */
  ec3ValidByPrefix: Record<(typeof EC3_PREFIXES)[number], number>;
  /** Baris valid/invalid produk P260 & TTSPOS. */
  otherValid: number;
  otherInvalid: number;
  /** Baris valid/invalid produk PE. */
  peValid: number;
  peInvalid: number;
  /** Baris valid/invalid produk PJB. */
  pjbValid: number;
  pjbInvalid: number;
  /** Baris produk tak dikenal (UNKNOWN_OR_INVALID_PRODUCT). */
  unknownInvalid: number;
  /**
   * Rincian generik per produk pendukung (termasuk layanan baru 3PE, 312,
   * Q9, ...). Hanya produk yang muncul di berkas yang memiliki entri.
   * Field bernama (pkhValid, peValid, ...) dipertahankan untuk kompatibilitas.
   */
  byProduct: Record<string, { valid: number; invalid: number }>;
  /** Baris yang nomor resinya muncul >1x dalam berkas. */
  duplicateResiRows: number;
  /** Grup resi ganda (jumlah nomor resi unik yang terduplikasi). */
  duplicateResiGroups: number;
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
    pkhValidByPrefix: {
      P26: 0,
      TTSPOS: 0,
      "26MNG": 0,
      "26KOM": 0,
      "26EVP": 0,
      "26ASD": 0,
      "26": 0,
    },
    ec3ValidByPrefix: { SHPE: 0, P26: 0 },
    otherValid: 0,
    otherInvalid: 0,
    peValid: 0,
    peInvalid: 0,
    pjbValid: 0,
    pjbInvalid: 0,
    unknownInvalid: 0,
    byProduct: {},
    duplicateResiRows: 0,
    duplicateResiGroups: 0,
  };
  // Pelacakan duplikat via Map frekuensi resi (resi kosong dikecualikan).
  const counts = countResiOccurrences(rows);
  for (const [resi, count] of counts) {
    if (resi !== "" && count > 1) {
      breakdown.duplicateResiGroups += 1;
      breakdown.duplicateResiRows += count;
    }
  }
  for (const row of rows) {
    if (!isSupportedProduct(row.produk)) {
      // Produk tak dikenal selalu invalid (lihat validateRow) — hitung
      // di sini agar tidak hilang dari agregat.
      breakdown.unknownInvalid += 1;
      continue;
    }
    const stat = (breakdown.byProduct[row.produk] ??= { valid: 0, invalid: 0 });
    if (row.isValid) stat.valid += 1;
    else stat.invalid += 1;
    if (row.produk === "PKH") {
      if (!row.isValid) {
        breakdown.pkhInvalid += 1;
        continue;
      }
      breakdown.pkhValid += 1;
      for (const prefix of PKH_PREFIXES_BY_LENGTH) {
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
    } else if (row.produk === "P260" || row.produk === "TTSPOS") {
      if (!row.isValid) {
        breakdown.otherInvalid += 1;
      } else {
        breakdown.otherValid += 1;
      }
    } else if (row.produk === "PE") {
      if (!row.isValid) {
        breakdown.peInvalid += 1;
      } else {
        breakdown.peValid += 1;
      }
    } else if (row.produk === "PJB") {
      if (!row.isValid) {
        breakdown.pjbInvalid += 1;
      } else {
        breakdown.pjbValid += 1;
      }
    }
    // Produk pendukung lain (3PE, 312, Q9, ...): cukup tercatat di
    // byProduct di atas; tidak ada counter bernama khusus.
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
  markDuplicateResi(validated);
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
