/**
 * Deteksi header toleran untuk modul Reconcile.
 *
 * Masalah yang diatasi: berkas nyata sering diawali baris judul laporan,
 * baris kosong, atau header berbahasa Inggris ("Product/Connote/AWB"),
 * sehingga pencocokan kaku `includes("produk") && includes("resi")` pada
 * baris pertama gagal — atau lebih buruk, mengira baris judul sebagai
 * header lalu melaporkan "Tidak ada baris data di bawah header".
 */

export interface DetectedHeader {
  /** Indeks baris header (0-based, relatif ke matriks). */
  row: number;
  /** Indeks kolom produk & resi (0-based). Selalu berbeda. */
  produkCol: number;
  resiCol: number;
  /** Teks header asli (untuk diagnostik). */
  produkHeader: string;
  resiHeader: string;
}

export interface HeaderScanOptions {
  /**
   * Batasi pemindaian pada N baris awal. Default (undefined): pindai
   * SELURUH sheet — aman karena sistem skor memilih kandidat yang
   * memiliki data di bawahnya, sehingga footer tidak menang atas header.
   * Isi angka (mis. 20) bila ingin membatasi secara eksplisit.
   */
  maxScanRows?: number;
  /** Baris lookahead untuk menilai "ada data di bawah" (default 5). */
  lookaheadRows?: number;
}

/** Alias dinormalisasi (huruf kecil a-z saja). Urutan = prioritas. */
export const PRODUK_ALIASES = [
  "produk",
  "product",
  "products",
  "namaproduk",
  "productname",
  "tipeproduk",
  "producttype",
  "jenis",
  "layanan",
  "service",
  "tipe",
] as const;

export const RESI_ALIASES = [
  "nomorresi",
  "noresi",
  "resi",
  "awb",
  "connote",
  "connoteno",
  "tracking",
  "airwaybill",
] as const;

/** Normalisasi sel header: lowercase, hanya a-z (buang spasi/underscore/angka). */
export function normalizeHeaderCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return "";
  return String(value)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** "Produk" / "Nomor Resi" / "AWB" -> true (judul kolom, bukan data). */
function isExactAlias(norm: string, aliases: readonly string[]): boolean {
  return (aliases as readonly string[]).includes(norm);
}

/** Kolom terbaik untuk daftar alias: alias spesifik (awal array) menang. */
function findBestCol(normalized: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const col = normalized.findIndex((c) => c !== "" && c.includes(alias));
    if (col !== -1) return col;
  }
  return -1;
}

/** 0-based -> "A", "Z", "AA", ... (untuk pesan diagnostik). */
export function columnLetter(index: number): string {
  let col = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function isNonEmptyCell(value: unknown): boolean {
  return cellText(value) !== "";
}

/** Teks sel generik: null/boolean/DATE tidak dianggap isi produk/resi. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return "";
  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).trim();
}

/**
 * Pindai sheet (default: seluruh baris), kembalikan kandidat header terbaik.
 *
 * - Melewati baris judul: satu sel mengandung kata produk DAN resi
 *   ("Laporan Produk dan Resi") -> produkCol === resiCol -> dibuang.
 * - Dari semua kandidat berkoloM berbeda, pilih skor tertinggi:
 *   lebar baris + 2x jumlah baris data terisi pada lookahead.
 *   Seri -> baris paling awal. Footer ("total produk & resi") tanpa data
 *   di bawahnya kalah dari header asli yang datanya penuh.
 */
export function findReconcileHeader(
  matrix: unknown[][],
  opts: HeaderScanOptions = {}
): DetectedHeader | null {
  const lookahead = opts.lookaheadRows ?? 5;
  // Tanpa maxScanRows: pindai seluruh matriks agar header di baris
  // berapapun (judul panjang, logo, baris kosong) tetap ketemu.
  const limit =
    opts.maxScanRows === undefined
      ? matrix.length
      : Math.min(matrix.length, Math.max(opts.maxScanRows, 1));

  let best: DetectedHeader | null = null;
  let bestScore = -1;

  for (let r = 0; r < limit; r += 1) {
    const raw: unknown[] = matrix[r] ?? [];
    const normalized = raw.map((c) => normalizeHeaderCell(c));
    const produkCol = findBestCol(normalized, PRODUK_ALIASES);
    const resiCol = findBestCol(normalized, RESI_ALIASES);
    // Butuh DUA kolom berbeda — satu sel judul bukan header.
    if (produkCol === -1 || resiCol === -1 || produkCol === resiCol) continue;

    const width = raw.filter((c) => isNonEmptyCell(c)).length;
    let dataFill = 0;
    for (let k = r + 1; k < Math.min(matrix.length, r + 1 + lookahead); k += 1) {
      const below: unknown[] = matrix[k] ?? [];
      if (isNonEmptyCell(below[produkCol]) || isNonEmptyCell(below[resiCol])) {
        dataFill += 1;
      }
    }
    const score = width + dataFill * 2;
    if (score > bestScore) {
      bestScore = score;
      best = {
        row: r,
        produkCol,
        resiCol,
        produkHeader: cellText(raw[produkCol]),
        resiHeader: cellText(raw[resiCol]),
      };
    }
  }
  return best;
}

export interface ReconcileInputRow {
  produk: string;
  nomor_resi: string;
}

/**
 * Ambil baris data di bawah header.
 * - Tahan baris tidak rata (ragged): kolom di luar lebar baris = "".
 * - Lewati gema header cetakan ("Produk | Nomor Resi" yang berulang).
 * - Baris yang kedua selnya kosong dibuang (baris separator/total kosong).
 */
export function extractReconcileInputRows(
  matrix: unknown[][],
  header: DetectedHeader
): ReconcileInputRow[] {
  const out: ReconcileInputRow[] = [];
  for (let r = header.row + 1; r < matrix.length; r += 1) {
    const cells: unknown[] = matrix[r] ?? [];
    const produk = cellText(
      header.produkCol < cells.length ? cells[header.produkCol] : ""
    );
    const nomor_resi = cellText(
      header.resiCol < cells.length ? cells[header.resiCol] : ""
    );
    if (produk === "" && nomor_resi === "") continue;
    // Gema header (header cetak berulang tiap halaman): buang diam-diam.
    if (
      isExactAlias(normalizeHeaderCell(produk), PRODUK_ALIASES) &&
      isExactAlias(normalizeHeaderCell(nomor_resi), RESI_ALIASES)
    ) {
      continue;
    }
    out.push({ produk, nomor_resi });
  }
  return out;
}
