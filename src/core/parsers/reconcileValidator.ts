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
 * Turunan: prefix 3 karakter dari baris PREFIX_MISMATCH dikelompokkan per
 * produk untuk diusulkan sebagai prefix baru (tidak mengubah status baris).
 */

export interface ReconcileInputRow {
  produk?: string;
  nomor_resi?: string;
  /**
   * Nomor baris ASLI di berkas (1-based). Opsional agar pemanggil lama
   * (tanpa sumber baris) tetap jalan — bila kosong, dipakai index+1.
   */
  sourceRow?: number;
}

/** Kategori mesin tiap celah baris — untuk filter/agregasi di UI. */
export type ReconcileRowCode =
  | "PREFIX_MISMATCH"
  | "EMPTY_RESI"
  | "UNKNOWN_OR_INVALID_PRODUCT"
  | "DUPLICATE_RESI";

export interface ReconcileRowResult {
  index: number;
  /**
   * Nomor baris ASLI di berkas Excel (1-based). Tidak bergeser dengan
   * header awal atau baris kosong yang dibuang saat ekstraksi — dipakai
   * UI agar user bisa langsung menuju sel yang bermasalah.
   */
  sourceRow: number;
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

/**
 * Prefix 3 karakter yang tidak dikenali untuk sebuah produk, dikumpulkan
 * dari baris PREFIX_MISMATCH agar bisa ditinjau sebagai usulan prefix baru.
 */
export interface ReconcilePrefixSuggestion {
  productName: string;
  suggestedPrefix: string;
  sampleResi: string;
  occurrenceCount: number;
}

export interface ReconcileValidationResult {
  rows: ReconcileRowResult[];
  fileIssues: ReconcileFileIssue[];
  prefixSuggestions: ReconcilePrefixSuggestion[];
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
  // 3LX: resi berawalan "3LX" (format lama) ATAU "LX" (format rekon
  // aktual, mis. LX123456789). Kedua-duanya sah untuk produk 3LX.
  "3LX": ["3LX", "LX"],
  "3LP": ["3LP"], // DEFAULT: konfirmasi ke data rekon
};

function isSupportedProduct(value: string): value is SupportedProduct {
  return (SUPPORTED_PRODUCTS as readonly string[]).includes(value);
}

const EXTRA_PREFIX_RE = /^[A-Z0-9]{2,16}$/;

/**
 * Gabungkan prefix bawaan dengan prefix tambahan yang disetujui admin
 * (dibaca dari tabel `product_prefixes`). Prefix tambahan tidak pernah
 * mengganti prefix bawaan; hanya menambah dan dideduplikasi.
 */
function buildProductPrefixes(
  extra?: Readonly<Record<string, readonly string[]>>
): Record<SupportedProduct, readonly string[]> {
  const mergedMap = { ...PRODUCT_PREFIXES };
  if (!extra) return mergedMap;

  for (const [rawProduct, extraPrefixes] of Object.entries(extra)) {
    const produk = rawProduct.trim().toUpperCase();
    if (!isSupportedProduct(produk) || !Array.isArray(extraPrefixes)) continue;
    if (extraPrefixes.length === 0) continue;

    const seen = new Set(mergedMap[produk]);
    const merged = [...mergedMap[produk]];
    for (const raw of extraPrefixes) {
      if (typeof raw !== "string") continue;
      const prefix = raw.trim().toUpperCase();
      if (!EXTRA_PREFIX_RE.test(prefix) || seen.has(prefix)) continue;
      seen.add(prefix);
      merged.push(prefix);
    }
    if (merged.length !== mergedMap[produk].length) {
      mergedMap[produk] = merged;
    }
  }

  return mergedMap;
}

/**
 * Alias nilai kolom Produk -> kode produk kanonik.
 *
 * Kolom produk pada file rekon kadang hanya memuat kode ringkas tanpa
 * angka ("LX"), sementara kode produk kanoniknya adalah "3LX". Tanpa
 * alias ini baris tersebut ditolak sebagai UNKNOWN_OR_INVALID_PRODUCT
 * walaupun resinya sah ("LX123456789").
 */
const PRODUCT_ALIASES: Record<string, SupportedProduct> = {
  LX: "3LX",
};

/**
 * Kode produk kanonik dari nilai kolom Produk.
 * Null bila produk kosong atau tak dikenal.
 */
function canonicalProduct(raw: unknown): SupportedProduct | null {
  const norm = normalize(raw);
  if (norm === "") return null;
  if (isSupportedProduct(norm)) return norm;
  return PRODUCT_ALIASES[norm] ?? null;
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

function validateRow(
  row: ReconcileInputRow,
  index: number,
  prefixesByProduct: Record<SupportedProduct, readonly string[]>
): ReconcileRowResult {
  // Nomor baris asli di berkas (bila pemanggil menyediakannya); fallback
  // ke index+1 untuk pemanggil lama yang tak melacak posisi baris.
  const sourceRow =
    typeof row.sourceRow === "number" &&
    Number.isInteger(row.sourceRow) &&
    row.sourceRow > 0
      ? row.sourceRow
      : index + 1;
  // Nilai produk di kolom file (setelah normalisasi) & kode kanoniknya.
  // Alias mis. "LX" -> "3LX"; bila tak dikenal, produk tetap ditampilkan
  // apa adanya (raw) agar user melihat isi sel aslinya.
  const produkRaw = normalize(row.produk);
  const produk = canonicalProduct(row.produk);
  const nomorResi = normalizeResi(row.nomor_resi);

  if (produk === null) {
    return {
      index,
      sourceRow,
      produk: produkRaw,
      nomorResi,
      isValid: false,
      reason: produkRaw === "" ? `${UNKNOWN_PRODUCT_REASON} (produk kosong)` : UNKNOWN_PRODUCT_REASON,
      code: "UNKNOWN_OR_INVALID_PRODUCT",
    };
  }

  if (nomorResi === "") {
    return {
      index,
      sourceRow,
      produk,
      nomorResi,
      isValid: false,
      reason: "Nomor resi kosong",
      code: "EMPTY_RESI",
    };
  }

  const accepted = prefixesByProduct[produk];
  if (!startsWithAny(nomorResi, accepted)) {
    const reason =
      produk === "EC3" && accepted === EC3_PREFIXES
        ? "Resi EC3 harus diawali SHPE atau P26"
        : accepted === SHARED_PREFIXES_PKH_PJB_PE
          ? `Resi ${produk} harus diawali ${formatPrefixList(SHARED_PREFIXES_PKH_PJB_PE)}`
          : `Resi ${produk} harus diawali ${[...accepted].join(" atau ")}`;
    return { index, sourceRow, produk, nomorResi, isValid: false, reason, code: "PREFIX_MISMATCH" };
  }

  return { index, sourceRow, produk, nomorResi, isValid: true };
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

function checkFileCoverage(
  results: ReconcileRowResult[],
  prefixesByProduct: Record<SupportedProduct, readonly string[]>
): ReconcileFileIssue[] {
  const issues: ReconcileFileIssue[] = [];
  const hasProduct = (produk: string) =>
    results.some((row) => row.produk === produk);
  // WAJIB per produk DAN hanya dari baris valid: baris invalid/duplikat
  // tidak boleh menjadi bukti cakupan prefix.
  // (Sebelumnya lintas-produk: resi P26 milik EC3 bisa membuat syarat
  // PKH lolos — false negative pada berkas campuran.)
  const hasResiPrefixFor = (produk: string, prefix: string) =>
    results.some(
      (row) =>
        row.isValid && row.produk === produk && row.nomorResi.startsWith(prefix)
    );
  // Cakupan longgar untuk PE/PJB: cukup SATU resi berproduk sama yang
  // diawali SALAH SATU prefix bersama. Mencegah false warning pada
  // berkas valid (mis. resi 26KOM sah tetapi tidak berprefix "PE").
  const hasSharedPrefixFor = (produk: SupportedProduct) =>
    results.some(
      (row) =>
        row.isValid &&
        row.produk === produk &&
        prefixesByProduct[produk].some((prefix) =>
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
      message: `Berkas memuat produk PE tetapi tidak ada resi PE berprefix valid (${formatPrefixList(prefixesByProduct.PE)})`,
    });
  }

  if (hasProduct("PJB") && !hasSharedPrefixFor("PJB")) {
    issues.push({
      rule: "PRODUCT_PREFIX_COVERAGE",
      message: `Berkas memuat produk PJB tetapi tidak ada resi PJB berprefix valid (${formatPrefixList(prefixesByProduct.PJB)})`,
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
      !prefixesByProduct[produk].some((prefix) =>
        hasResiPrefixFor(produk, prefix)
      )
    ) {
      issues.push({
        rule: "PRODUCT_PREFIX_COVERAGE",
        message: `Berkas memuat produk ${produk} tetapi tidak ada resi ${produk} berprefix valid (${formatPrefixList(prefixesByProduct[produk])})`,
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
  /**
   * Resi valid per prefix PKH (longest-match). Prefix approved dari database
   * ikut masuk sebagai key tambahan, mis. OID.
   */
  pkhValidByPrefix: Record<string, number>;
  /** Resi valid per prefix EC3 (longest-match), termasuk prefix approved. */
  ec3ValidByPrefix: Record<string, number>;
  /**
   * Rincian resi valid per produk & prefix untuk semua produk, termasuk
   * prefix tambahan approved. Dipakai UI agar label dinamis transparan.
   */
  validByPrefix: Record<string, Record<string, number>>;
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

export interface ReconcileBreakdownOptions {
  /** Prefix approved per produk; dipakai untuk memasukkan label dinamis. */
  extraProductPrefixes?: Readonly<Record<string, readonly string[]>>;
}

/** Rincian jumlah resi per produk & prefix dari hasil validasi baris. */
export function buildReconcileBreakdown(
  rows: ReconcileRowResult[],
  options: ReconcileBreakdownOptions = {}
): ReconcileBreakdown {
  const prefixesByProduct = buildProductPrefixes(options.extraProductPrefixes);
  // Longest-match agar "26MNG" tidak tertelan "26", termasuk prefix approved.
  const sortedPrefixesByProduct = {} as Record<
    SupportedProduct,
    readonly string[]
  >;
  for (const produk of SUPPORTED_PRODUCTS) {
    sortedPrefixesByProduct[produk] = [...prefixesByProduct[produk]].sort(
      (a, b) => b.length - a.length || a.localeCompare(b)
    );
  }
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
    validByPrefix: {},
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

    let matchedPrefix: string | null = null;
    if (row.isValid) {
      matchedPrefix =
        sortedPrefixesByProduct[row.produk].find((prefix) =>
          row.nomorResi.startsWith(prefix)
        ) ?? null;
      if (matchedPrefix) {
        const productPrefixCounts =
          (breakdown.validByPrefix[row.produk] ??= {});
        productPrefixCounts[matchedPrefix] =
          (productPrefixCounts[matchedPrefix] ?? 0) + 1;

        if (row.produk === "PKH") {
          breakdown.pkhValidByPrefix[matchedPrefix] =
            (breakdown.pkhValidByPrefix[matchedPrefix] ?? 0) + 1;
        } else if (row.produk === "EC3") {
          breakdown.ec3ValidByPrefix[matchedPrefix] =
            (breakdown.ec3ValidByPrefix[matchedPrefix] ?? 0) + 1;
        }
      }
    }

    if (row.produk === "PKH") {
      if (!row.isValid) {
        breakdown.pkhInvalid += 1;
        continue;
      }
      breakdown.pkhValid += 1;
    } else if (row.produk === "EC3") {
      if (!row.isValid) {
        breakdown.ec3Invalid += 1;
        continue;
      }
      breakdown.ec3Valid += 1;
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
 * Pagination murni untuk tabel hasil validasi (render bertahap).
 *
 * Hanya satu halaman baris yang dikembalikan untuk dirender — untuk
 * berkas 20.000+ baris, merender semuanya (±100.000 node DOM) membuat
 * browser freeze. Ringkasan total TIDAK boleh ikut terpotong: `total`
 * selalu jumlah baris yang cocok filter (bukan jumlah baris di halaman).
 */
export interface ReconcilePageResult<T> {
  /** Baris satu halaman (siap dirender). */
  rows: T[];
  /** Halaman efektif (sudah dijepit ke 1..totalPages). */
  page: number;
  pageSize: number;
  totalPages: number;
  /** Total baris (seluruh data yang ter-filter). */
  total: number;
  /** Baris pertama halaman ini (1-based; 0 bila tak ada data). */
  rangeStart: number;
  /** Baris terakhir halaman ini (1-based). */
  rangeEnd: number;
}

export function paginateReconcileRows<T>(
  rows: T[],
  page: number,
  pageSize: number
): ReconcilePageResult<T> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(
    Math.max(1, Math.floor(page) || 1),
    totalPages
  );
  return {
    rows: rows.slice((safePage - 1) * size, safePage * size),
    page: safePage,
    pageSize: size,
    totalPages,
    total,
    rangeStart: total === 0 ? 0 : (safePage - 1) * size + 1,
    rangeEnd: Math.min(safePage * size, total),
  };
}

const PREFIX_SUGGESTION_RE = /^[A-Z0-9]{3}$/;

/**
 * Kumpulkan 3 karakter pertama dari setiap resi yang PREFIX_MISMATCH,
 * kelompokkan per produk + prefix, lalu hitung frekuensinya. Prefix yang
 * mengandung karakter selain huruf/angka (atau resi < 3 karakter) dilewati
 * karena tidak layak diusulkan sebagai prefix resi.
 */
function collectPrefixSuggestions(
  rows: ReconcileRowResult[],
): ReconcilePrefixSuggestion[] {
  const groups = new Map<string, ReconcilePrefixSuggestion>();

  for (const row of rows) {
    if (row.code !== "PREFIX_MISMATCH") continue;
    const suggestedPrefix = row.nomorResi.slice(0, 3);
    if (!PREFIX_SUGGESTION_RE.test(suggestedPrefix)) continue;

    const key = `${row.produk}\u0000${suggestedPrefix}`;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
    } else {
      groups.set(key, {
        productName: row.produk,
        suggestedPrefix,
        sampleResi: row.nomorResi,
        occurrenceCount: 1,
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) =>
      b.occurrenceCount - a.occurrenceCount ||
      a.productName.localeCompare(b.productName) ||
      a.suggestedPrefix.localeCompare(b.suggestedPrefix)
  );
}

/**
 * Validasi baris-baris reconcile beserta cakupan file.
 * Perbandingan produk & resi bersifat case-insensitive (buang karakter tak
 * kasatmata + trim + uppercase; nomor resi juga hapus seluruh spasi dalam).
 */
export interface ReconcileValidationOptions {
  /**
   * Prefix tambahan per produk yang sudah disetujui admin. Nilai dinormalkan
   * dan digabung dengan prefix bawaan; tidak mengganti prefix bawaan.
   */
  extraProductPrefixes?: Readonly<Record<string, readonly string[]>>;
}

export function validateReconcileRows(
  rows: ReconcileInputRow[],
  options: ReconcileValidationOptions = {},
): ReconcileValidationResult {
  const prefixesByProduct = buildProductPrefixes(options.extraProductPrefixes);
  const validated = rows.map((row, index) =>
    validateRow(row, index, prefixesByProduct)
  );
  markDuplicateResi(validated);
  const fileIssues = checkFileCoverage(validated, prefixesByProduct);
  const invalid = validated.filter((row) => !row.isValid).length;

  return {
    rows: validated,
    fileIssues,
    prefixSuggestions: collectPrefixSuggestions(validated),
    isValid: invalid === 0 && fileIssues.length === 0,
    summary: {
      total: validated.length,
      valid: validated.length - invalid,
      invalid,
    },
  };
}
