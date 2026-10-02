/**
 * Service Rekapitulasi Fee Loket/Agen — tipe, mock data, helper parsing Excel,
 * filter realtime, pagination, dan export CSV/Excel.
 *
 * Murni (tanpa dependensi Next/Supabase) agar mudah diuji dan dipakai di
 * Client Component. SheetJS (`xlsx`) diimpor dinamis di page agar tidak
 * membebani initial bundle.
 */

export type FeeStatus = "TERBAYAR" | "PENDING";

export interface FeeRincian {
  label: string;
  nilai: number;
}

export type FeeAuditFlag = "OVER_DEDUCTED_CLAMPED";

export interface FeeRekapRow {
  id: string;
  ppid: string;
  namaLoket: string;
  /** Periode kanonis "YYYY-MM" (contoh "2026-09"). */
  periode: string;
  totalFee: number;
  status: FeeStatus;
  rincian: FeeRincian[];
  updatedAt: string;
  /**
   * Penanda audit clamp: diisi "OVER_DEDUCTED_CLAMPED" bila total mentah
   * (fee + potongan) negatif dan dipaksa ke 0 agar koreksi finansial
   * tidak hilang tanpa jejak. Lihat `clampFeeTotal()`.
   */
  auditFlag?: FeeAuditFlag;
  /**
   * Profil lengkap + rincian modul ala Excel Master (opsional).
   * Diisi `parseLoketBsbFull` dan diteruskan `saveFeeImport` ke API
   * import agar tersimpan ke `loket_profiles` /
   * `loket_transaction_details`. Null/undefined = data lama (tanpa
   * breakdown) — UI memakai fallback profil virtual dari fee.
   */
  profil?: LoketProfileFull | null;
}

export interface UploadLog {
  id: string;
  tanggalUpload: string;
  namaFile: string;
  jumlahBaris: number;
  periode: string;
  diunggahOleh: string;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("id-ID");

export function formatRupiah(nilai: number): string {
  if (!Number.isFinite(nilai)) return "Rp 0";
  return rupiahFormatter.format(Math.round(nilai));
}

export function formatNumber(nilai: number): string {
  if (!Number.isFinite(nilai)) return "0";
  return numberFormatter.format(nilai);
}

const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/** "2026-09" -> "September 2026". Fallback: kembalikan input. */
export function formatPeriode(periode: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periode.trim());
  if (!m) return periode;
  const bulan = Number(m[2]);
  if (bulan < 1 || bulan > 12) return periode;
  return `${BULAN_ID[bulan - 1]} ${m[1]}`;
}

/** "2026-09" dari pilihan bulan (1-12) + tahun. */
export function buildPeriode(bulan: number, tahun: number): string {
  return `${tahun}-${String(bulan).padStart(2, "0")}`;
}

/**
 * Sanitasi kata kunci untuk pola `or/ilike` PostgREST:
 * buang koma (pemisah kondisi) dan karakter wildcard.
 * (Dipertahankan untuk kompatibilitas; query PPID kanonis memakai
 * `canonicalFeeSearch` di bawah.)
 */
export function sanitizeFeeSearch(raw: string): string {
  return raw
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * Escape pola LIKE PostgREST: `\`, `%`, `_` dijadikan literal (backslash
 * adalah karakter escape LIKE di Postgres), koma/parens/quotes yang
 * memecah sintaks `or()` dibuang. TIDAK mengubah huruf/spasi — tidak
 * seperti `sanitizeFeeSearch` yang menelan `_` menjadi spasi (itu yang
 * membuat PPID ber-underscore tidak pernah ketemu).
 */
export function escapeFeeLike(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/[,()'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export interface FeeSearchPatterns {
  /** Pola kanonis untuk kolom ppid (tanpa spasi, UPPER). */
  ppid: string;
  /** Pola mentah tersanitasi untuk kolom nama_loket (spasi dipertahankan). */
  nama: string;
}

/**
 * Bangun pola pencarian ganda: PPID dikanonisasi persis seperti saat
 * simpan (`normalizePpid`) sehingga cocok dengan isi DB; nama loket
 * memakai sanitasi longgar agar substring alami ("kios berkah") tetap
 * ketemu. String kosong = filter peran itu dilewati.
 */
export function canonicalFeeSearch(raw: unknown): FeeSearchPatterns {
  const text = raw === null || raw === undefined ? "" : String(raw);
  return {
    ppid: escapeFeeLike(normalizePpid(text)),
    nama: sanitizeFeeSearch(text),
  };
}

/** Daftar periode unik terurut menurun dari baris data. */
export function periodeOptions(rows: FeeRekapRow[]): string[] {
  return [...new Set(rows.map((r) => r.periode))].sort((a, b) =>
    b.localeCompare(a)
  );
}

/** Periode terbaru (maks) atau "" bila kosong. */
export function latestPeriode(rows: FeeRekapRow[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => r.periode).sort((a, b) => b.localeCompare(a))[0] ?? "";
}

// ---------------------------------------------------------------------------
// Mock data (12 PPID sampel — langsung bisa diuji interaksinya)
// ---------------------------------------------------------------------------

function slip(
  id: string,
  ppid: string,
  namaLoket: string,
  periode: string,
  totalFee: number,
  status: FeeStatus,
  parts: [string, number][]
): FeeRekapRow {
  return {
    id,
    ppid,
    namaLoket,
    periode,
    totalFee,
    status,
    rincian: parts.map(([label, nilai]) => ({ label, nilai })),
    updatedAt: `${periode}-28T10:00:00+07:00`,
  };
}

export const MOCK_FEE_DATA: FeeRekapRow[] = [
  slip("fee-01", "SBPOS-CKM-001", "Agen Barokah Cikampek", "2026-09", 1_250_000, "TERBAYAR", [["Komisi transaksi", 850_000], ["Insentif aktivasi", 250_000], ["Bonus target", 150_000]]),
  slip("fee-02", "SBPOS-KRW-014", "Kios Berkah Karawang", "2026-09", 975_500, "TERBAYAR", [["Komisi transaksi", 700_000], ["Insentif aktivasi", 175_500], ["Bonus target", 100_000]]),
  slip("fee-03", "SBPOS-PWK-027", "Loket Maju Jaya Purwakarta", "2026-09", 2_100_750, "PENDING", [["Komisi transaksi", 1_600_000], ["Insentif aktivasi", 300_750], ["Bonus target", 200_000]]),
  slip("fee-04", "SBPOS-SBG-033", "Agen Sinar Subang", "2026-09", 640_000, "PENDING", [["Komisi transaksi", 480_000], ["Insentif aktivasi", 100_000], ["Bonus target", 60_000]]),
  slip("fee-05", "SBPOS-BKS-045", "Loket Amanah Bekasi", "2026-08", 1_875_250, "TERBAYAR", [["Komisi transaksi", 1_300_000], ["Insentif aktivasi", 325_250], ["Bonus target", 250_000]]),
  slip("fee-06", "SBPOS-DPK-052", "Kios Sejahtera Depok", "2026-08", 1_120_000, "TERBAYAR", [["Komisi transaksi", 800_000], ["Insentif aktivasi", 200_000], ["Bonus target", 120_000]]),
  slip("fee-07", "SBPOS-BGR-066", "Agen Tunas Bogor", "2026-08", 2_450_000, "TERBAYAR", [["Komisi transaksi", 1_800_000], ["Insentif aktivasi", 400_000], ["Bonus target", 250_000]]),
  slip("fee-08", "SBPOS-CRB-071", "Loket Fajar Cirebon", "2026-09", 815_000, "PENDING", [["Komisi transaksi", 600_000], ["Insentif aktivasi", 140_000], ["Bonus target", 75_000]]),
  slip("fee-09", "SBPOS-TSK-088", "Agen Wasilah Tasikmalaya", "2026-09", 1_540_300, "TERBAYAR", [["Komisi transaksi", 1_100_000], ["Insentif aktivasi", 260_300], ["Bonus target", 180_000]]),
  slip("fee-10", "SBPOS-BDG-102", "Kios Prima Bandung", "2026-08", 3_020_000, "TERBAYAR", [["Komisi transaksi", 2_200_000], ["Insentif aktivasi", 520_000], ["Bonus target", 300_000]]),
  slip("fee-11", "SBPOS-CIM-115", "Loket Ngupaya Cimahi", "2026-09", 455_750, "PENDING", [["Komisi transaksi", 340_000], ["Insentif aktivasi", 75_750], ["Bonus target", 40_000]]),
  slip("fee-12", "SBPOS-SMD-120", "Agen Lancar Sumedang", "2026-08", 1_980_400, "PENDING", [["Komisi transaksi", 1_450_000], ["Insentif aktivasi", 330_400], ["Bonus target", 200_000]]),
];

export const MOCK_UPLOAD_LOGS: UploadLog[] = [
  { id: "log-01", tanggalUpload: "2026-09-28T09:12:00+07:00", namaFile: "rekap-fee-2026-09.xlsx", jumlahBaris: 7, periode: "2026-09", diunggahOleh: "admin" },
  { id: "log-02", tanggalUpload: "2026-08-29T14:05:00+07:00", namaFile: "rekap-fee-2026-08.xlsx", jumlahBaris: 5, periode: "2026-08", diunggahOleh: "admin" },
];

// ---------------------------------------------------------------------------
// Filter realtime + pagination (murni, dipakai useMemo di page)
// ---------------------------------------------------------------------------

export function filterFeeRows(
  rows: FeeRekapRow[],
  search: string,
  periode: string
): FeeRekapRow[] {
  // PPID dibandingkan via kunci pencarian (kanonis + tanpa hubung) di
  // kedua sisi — NBSP/spasi/hubung/case diabaikan ("sbpos ckm 001" cocok
  // "SBPOS-CKM-001"); nama loket tetap substring longgar karena
  // mengandung spasi alami.
  const qPpid = ppidSearchKey(search);
  const qNama = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (periode !== "" && periode !== "SEMUA" && r.periode !== periode) {
      return false;
    }
    if (qPpid === "" && qNama === "") return true;
    return (
      (qPpid !== "" && ppidSearchKey(r.ppid).includes(qPpid)) ||
      (qNama !== "" && r.namaLoket.toLowerCase().includes(qNama))
    );
  });
}

export interface PageSlice<T> {
  pageRows: T[];
  totalPages: number;
  safePage: number;
}

export function paginateRows<T>(
  rows: T[],
  page: number,
  pageSize: number
): PageSlice<T> {
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  return { pageRows: rows.slice(start, start + size), totalPages, safePage };
}

// ---------------------------------------------------------------------------
// Parsing Excel (murni, SheetJS dipasok dari page via dynamic import)
// ---------------------------------------------------------------------------

/** Label header asli yang terpetakan ke tiap peran (diagnostik mapping). */
export interface DetectedFeeColumns {
  ppid: string;
  nama: string;
  fee: string;
  status: string;
  periode: string;
  potongan: string[];
}

export interface ParsedFeePreview {
  rows: FeeRekapRow[];
  skipped: number;
  detectedHeaderRow: number;
  /** Kolom terdeteksi (label asli) — ditampilkan di UI agar mapping terverifikasi. */
  columns: DetectedFeeColumns;
  /** Audit Rp-0 massal + sampel mentah + hitungan formula tanpa nilai. */
  audit: FeeParseAudit;
}

const EMPTY_COLUMNS: DetectedFeeColumns = {
  ppid: "",
  nama: "",
  fee: "",
  status: "",
  periode: "",
  potongan: [],
};

/** Karakter tak-kasatmata dari Excel (NBSP, BOM, zero-width). */
const INVISIBLE_CHARS = /[\u00a0\uFEFF\u200B-\u200D\u2060\u180E]/g;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(INVISIBLE_CHARS, " ").trim();
}

/**
 * Parse nominal robust dari sel Excel — SATU-SATUNYA parser uang yang
 * dipakai service maupun API import (unifikasi).
 * Menerima Number, bigint, "50000", "Rp 50.000", "Rp 1.250.000" (NBSP),
 * "1.250.000,50" (desimal koma Indonesia), "(2.500)"/"(Rp 5.000)"/
 * "-3.000" (negatif akuntansi).
 * Mengembalikan bilangan bulat (rounded); 0 untuk kosong/tak-valid.
 * Tanda negatif dipertahankan (dibutuhkan kolom potongan & deteksi
 * over-deducted); JANGAN clamp di sini — clamp + flag ada di
 * `clampFeeTotal()`.
 */
export function parseAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  if (typeof value !== "string") return 0;
  let s = value.replace(INVISIBLE_CHARS, " ").trim();
  if (s === "") return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(rp|idr|rb)\.?[\s]*/i, "").trim();
  // Akhiran ",-" Indonesia ("Rp 1.250.000,-" / "2.500,-") = bulat, bukan desimal.
  s = s.replace(/,-\s*$/, "").trim();
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  let normalized: string;
  if (/,\d{1,2}\s*$/.test(s)) {
    // Koma desimal Indonesia: titik = ribuan, koma = desimal.
    normalized = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (
    /^\d+\.\d{1,2}$/.test(s) &&
    !/^\d{1,3}(\.\d{3})+$/.test(s)
  ) {
    // Titik desimal ala US ("1500000.00"): satu titik dengan 1-2 digit
    // pecahan yang BUKAN pola ribuan (\d{1,3} + grup tepat 3 digit).
    // Tanpa cabang ini "1500000.00" terbaca 150000000 (100x lipat).
    normalized = s;
  } else {
    // Tanpa koma desimal: semua titik/koma = pemisah ribuan.
    normalized = s.replace(/[.]/g, "");
  }
  const digits = normalized.replace(/[^0-9.]/g, "");
  if (digits === "" || digits === ".") return 0;
  const n = Number(digits);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  return negative ? -rounded : rounded;
}

/**
 * Clamp total fee negatif ke 0 DENGAN jejak audit.
 * Mengembalikan `{ total, clamped, raw }`: `clamped=true` bila `raw < 0`.
 * Pemanggil WAJIB menyalurkan `clamped` ke `auditFlag:
 * "OVER_DEDUCTED_CLAMPED"` pada baris / entri rincian, bukan diam-diam
 * memakai `Math.max(0, ...)`.
 */
export function clampFeeTotal(raw: number): {
  total: number;
  clamped: boolean;
  raw: number;
} {
  const rounded = Number.isFinite(raw) ? Math.round(raw) : 0;
  if (rounded < 0) return { total: 0, clamped: true, raw: rounded };
  return { total: rounded, clamped: false, raw: rounded };
}

/**
 * Normalisasi header kolom Excel: lowercase + trim + collapse spasi.
 * "PPID ", "Nama Loket", "TOTAL FEE (Rp)" -> "ppid", "nama loket",
 * "total fee rp". Dipakai agar tidak ada mismatch properti object.
 */
export function normalizeHeaderCell(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kanonis PPID — SATU-SATUNYA normalisasi kode loket/agen.
 * Membuang seluruh karakter tak-kasatmata (NBSP, zero-width, BOM) DAN
 * seluruh whitespace, lalu UPPER. Kode PPID tidak mengandung spasi
 * ("12BSPA19010BDLMH", "SBPOS-CKM-001") sehingga "12BSPA\u00a019010"
 * maupun " 12bspa19010 " kanonis ke "12BSPA19010".
 * WAJIB dipakai di semua titik: parse Excel, simpan DB (toFeeDbRow),
 * baca DB (toFeeRekapRow), pencarian client, dan query server — agar
 * PPID yang ada di database tidak terbaca "tidak ditemukan".
 */
export function normalizePpid(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Kunci pencarian PPID: kanonis + tanpa hubung. Kode PPID memakai "-"
 * sebagai pemisah visual ("SBPOS-CKM-001") sehingga pencarian wajib
 * mengabaikannya — "sbpos ckm 001", "sbpos-ckm-001", dan "sbposckm001"
 * adalah kode yang sama. HANYA untuk pencarian (filter/lookup), bukan
 * untuk penyimpanan/pencocokan strict (lihat `normalizePpid`,
 * `getSelectedLoketData`).
 */
export function ppidSearchKey(value: unknown): string {
  return normalizePpid(value).replace(/-/g, "");
}

/** Nama loket tampilan dengan fallback ke PPID bila kosong (data master/API). */
export function displayNamaLoket(
  row: Pick<FeeRekapRow, "namaLoket" | "ppid">
): string {
  const nama = (row.namaLoket ?? "").trim();
  return nama !== "" ? nama : (row.ppid ?? "").trim();
}

/**
 * Lookup strict baris loket untuk modal/detail:
 * String(row.ppid).trim().toUpperCase() === String(ppid).trim().toUpperCase(),
 * opsional filter periode, terurut periode menurun.
 */
export function getSelectedLoketData(
  rows: FeeRekapRow[],
  ppid: unknown,
  periode = "SEMUA"
): FeeRekapRow[] {
  const key = normalizePpid(ppid);
  if (key === "") return [];
  return rows
    .filter(
      (r) =>
        normalizePpid(r.ppid) === key &&
        (periode === "" || periode === "SEMUA" || r.periode === periode)
    )
    .sort((a, b) => b.periode.localeCompare(a.periode));
}

/**
 * Profil agen virtual 100% dari data fee (`fee_loket`) — tanpa master
 * `data_lengkap_utama`. Selama PPID ada di data fee (periode apa pun),
 * profil dianggap terdaftar (`found`); angka ringkasan mengikuti filter
 * periode aktif (kosong bila filter tidak cocok).
 */
export interface FeeAgentProfile {
  ppid: string;
  namaLoket: string;
  status: FeeStatus;
  periods: string[];
  totalFee: number;
  rowCount: number;
}

export function buildFeeAgentProfile(
  allRows: FeeRekapRow[],
  scopePeriode = "SEMUA"
): FeeAgentProfile | null {
  if (allRows.length === 0) return null;
  const sorted = [...allRows].sort((a, b) =>
    b.periode.localeCompare(a.periode)
  );
  const scoped =
    scopePeriode === "" || scopePeriode === "SEMUA"
      ? sorted
      : sorted.filter((r) => r.periode === scopePeriode);
  // Nama: baris terbaru yang punya nama asli (bukan fallback PPID).
  const named =
    sorted.find(
      (r) =>
        r.namaLoket.trim() !== "" &&
        normalizePpid(r.namaLoket) !== normalizePpid(r.ppid)
    ) ?? sorted[0]!;
  const ref = sorted[0]!;
  return {
    ppid: ref.ppid,
    namaLoket: displayNamaLoket(named),
    status:
      scoped.length > 0 && scoped.every((r) => r.status === "TERBAYAR")
        ? "TERBAYAR"
        : "PENDING",
    periods: [...new Set(scoped.map((r) => r.periode))].sort((a, b) =>
      b.localeCompare(a)
    ),
    totalFee: scoped.reduce((s, r) => s + r.totalFee, 0),
    rowCount: scoped.length,
  };
}

/** Teks slip profil agen + fee untuk disalin/dikirim ke agen. */
export function buildFeeAgentSlipText(
  profile: FeeAgentProfile,
  fees: FeeRekapRow[]
): string {
  const head = [
    `PPID: ${profile.ppid === "" ? "-" : profile.ppid}`,
    `Nama Loket/Agen: ${profile.namaLoket === "" ? "-" : profile.namaLoket}`,
    `Periode: ${
      profile.periods.length === 0
        ? "-"
        : profile.periods.map(formatPeriode).join(", ")
    }`,
    `Status: ${profile.status === "TERBAYAR" ? "Terbayar" : "Pending"}`,
    `Total Fee: ${formatRupiah(profile.totalFee)}`,
  ];
  if (fees.length === 0) {
    return [...head, `Rincian: belum ada data pada filter ini`].join("\n");
  }
  return [
    ...head,
    `------------------------------`,
    ...fees.map(
      (f) =>
        `${formatPeriode(f.periode)}: ${formatRupiah(f.totalFee)} (${
          f.status === "TERBAYAR" ? "Terbayar" : "Pending"
        })`
    ),
  ].join("\n");
}

/**
 * Skor kecocokan satu header ternormalisasi terhadap peran kolom.
 * Token-based (bukan substring) agar "Kode Loket" TIDAK dikira PPID dan
 * "Fee Jasa" tidak mengalahkan "Total Fee".
 */
function scoreFeeColumn(norm: string, role: "ppid" | "nama" | "fee" | "status" | "periode"): number {
  if (norm === "") return -1;
  const tokens = new Set(norm.split(" "));
  const compact = norm.replace(/ /g, "");
  switch (role) {
    case "ppid":
      if (tokens.has("ppid")) return 100;
      if (norm === "kode agen" || norm === "kode loket") return 10;
      return -1;
    case "nama":
      if (norm === "nama loket" || norm === "nama agen" || norm === "nama pos") return 100;
      if (
        tokens.has("nama") &&
        (tokens.has("loket") ||
          tokens.has("agen") ||
          tokens.has("pos") ||
          tokens.has("outlet") ||
          tokens.has("mitra"))
      )
        return 90;
      // Nama polos ("Loket", "Agen", "Outlet", "Kios", ...) — tetapi JANGAN
      // "kode loket" (itu kunci, bukan nama).
      if (
        (tokens.has("loket") ||
          tokens.has("agen") ||
          tokens.has("pos") ||
          tokens.has("outlet") ||
          tokens.has("gerai") ||
          tokens.has("kios") ||
          tokens.has("toko") ||
          tokens.has("konter") ||
          tokens.has("counter")) &&
        !tokens.has("kode")
      )
        return 10;
      return -1;
    case "fee": {
      // Kolom hitung (Jumlah Transaksi/Resi/…) BUKAN uang — kecuali sel
      // menegaskan fee/nominal. Mencegah "Total Transaksi" dimakan fee.
      const moneyHint =
        tokens.has("fee") ||
        tokens.has("nominal") ||
        tokens.has("komisi") ||
        tokens.has("rupiah") ||
        tokens.has("rp");
      if (!moneyHint) {
        const COUNT_TOKENS = new Set([
          "transaksi",
          "trx",
          "resi",
          "kirim",
          "paket",
          "lembar",
          "koli",
          "trans",
        ]);
        if ([...tokens].some((t) => COUNT_TOKENS.has(t))) return -1;
      }
      if (compact.includes("totalfee")) return 100;
      if (tokens.has("total") && tokens.has("fee")) return 95;
      if (compact.includes("grandtotal")) return 92;
      if (tokens.has("subtotal")) return 88;
      // Varian fee total: "Jumlah/JML Fee", "Fee Bersih/Netto", "Fee Dibayar", ...
      if (
        tokens.has("fee") &&
        (tokens.has("jumlah") ||
          tokens.has("jml") ||
          tokens.has("nilai") ||
          tokens.has("bersih") ||
          tokens.has("net") ||
          tokens.has("netto") ||
          tokens.has("diterima") ||
          tokens.has("dibayar") ||
          tokens.has("lunas"))
      )
        return 90;
      // Varian total payout: "Total Bayar/Dibayar/Transfer/Lunas",
      // "Jumlah Penerimaan", "Nilai Pencairan", ...
      if (
        (tokens.has("total") ||
          tokens.has("grand") ||
          tokens.has("jumlah") ||
          tokens.has("jml") ||
          tokens.has("nilai")) &&
        (tokens.has("diterima") ||
          tokens.has("penerimaan") ||
          tokens.has("dibayar") ||
          tokens.has("terbayar") ||
          tokens.has("bayar") ||
          tokens.has("lunas") ||
          tokens.has("transfer") ||
          tokens.has("cair") ||
          tokens.has("pencairan") ||
          tokens.has("realisasi") ||
          tokens.has("bersih") ||
          tokens.has("netto") ||
          tokens.has("net") ||
          tokens.has("rupiah") ||
          tokens.has("rp"))
      )
        return 90;
      if (tokens.has("fee")) return 50;
      if (tokens.has("nominal") || tokens.has("komisi")) return 40;
      return -1;
    }
    case "status":
      // "Status Syarat" (sheet Agen CUM) dikecualikan — bukan status bayar.
      if (tokens.has("status") && !tokens.has("syarat")) return 100;
      if (norm === "pembayaran") return 50;
      return -1;
    case "periode":
      if (norm === "periode") return 100;
      if (norm === "bulan" || norm === "tahun") return 50;
      return -1;
  }
}

const POTONGAN_TOKENS = new Set([
  "potongan",
  "potong",
  "denda",
  "pph",
  "pajak",
  "materai",
  "admin",
  "biaya",
]);

/** True bila header adalah kolom potongan/biaya (bukan kolom fee utama). */
function isPotonganColumn(norm: string, feeLabel: string): boolean {
  if (norm === "" || norm === feeLabel) return false;
  return norm.split(" ").some((t) => POTONGAN_TOKENS.has(t));
}

/**
 * Klasifikasi status pembayaran sel Excel.
 * Kata kunci negatif/tertunda dicek TEGAS terlebih dahulu agar
 * "Belum Bayar" / "Tidak Dibayar" / "Belum Lunas" tidak lolos sebagai
 * TERBAYAR hanya karena mengandung substring "BAYAR"/"LUNAS".
 * "UNPAID" dicek sebagai token utuh dulu (mengandung substring "PAID").
 */
const FEE_STATUS_NEGATIVE_TOKENS = new Set([
  "BELUM",
  "TIDAK",
  "BATAL",
  "GAGAL",
  "PENDING",
  "PIUTANG",
  "UNPAID",
]);

export function parseStatus(value: unknown): FeeStatus {
  const norm = normalizeHeaderCell(value).toUpperCase();
  if (norm === "") return "PENDING";
  const tokens = new Set(norm.split(" "));
  for (const neg of FEE_STATUS_NEGATIVE_TOKENS) {
    if (tokens.has(neg)) return "PENDING";
  }
  if (
    norm.includes("BAYAR") ||
    norm.includes("LUNAS") ||
    norm.includes("PAID") ||
    norm.includes("SUCCESS") ||
    norm.includes("DONE")
  ) {
    return "TERBAYAR";
  }
  return "PENDING";
}

/** Rentang merge SheetJS (`ws["!merges"]`): `{ s: {r,c}, e: {r,c} }`. */
export interface SheetMerge {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

function isMergeLike(value: unknown): value is SheetMerge {
  if (typeof value !== "object" || value === null) return false;
  const m = value as { s?: unknown; e?: unknown };
  const pt = (p: unknown): p is { r: number; c: number } =>
    typeof p === "object" &&
    p !== null &&
    typeof (p as { r?: unknown }).r === "number" &&
    typeof (p as { c?: unknown }).c === "number";
  return pt(m.s) && pt(m.e);
}

/**
 * Isi-sel merged (khusus .xlsb rekap yang menggabung sel PPID/Nama ke
 * bawah): SheetJS hanya menaruh nilai di sel kiri-atas merge, sel
 * bawahnya "" sehingga barisnya terbuang sebagai "kosong". Fungsi ini
 * meneruskan nilai anchor ke sel kosong dalam rentang (tanpa menimpa
 * sel terisi). Mengembalikan matriks BARU.
 */
export function fillMergedCells(
  matrix: unknown[][],
  merges: unknown
): unknown[][] {
  if (!Array.isArray(matrix) || !Array.isArray(merges)) return matrix;
  const out = matrix.map((row) => (Array.isArray(row) ? [...row] : []));
  for (const raw of merges) {
    if (!isMergeLike(raw)) continue;
    const anchor = out[raw.s.r]?.[raw.s.c];
    if (anchor === null || anchor === undefined || cellText(anchor) === "") {
      continue;
    }
    for (let r = raw.s.r; r <= raw.e.r; r += 1) {
      if (!out[r]) continue;
      for (let c = raw.s.c; c <= raw.e.c; c += 1) {
        if (r === raw.s.r && c === raw.s.c) continue;
        const cur = out[r]?.[c];
        if (cur === null || cur === undefined || cellText(cur) === "") {
          out[r]![c] = anchor;
        }
      }
    }
  }
  return out;
}

/**
 * Pangkas baris kosong di ekor matriks. File .xlsb sering punya `!ref`
 * seluas ribuan baris (format kolom penuh) sehingga ekor kosong ikut
 * terhitung "dilewati" — fungsi ini membuangnya agar `skipped` hanya
 * mencerminkan baris kosong di TENGAH data. Mengembalikan matriks BARU.
 */
export function trimTrailingEmptyRows(matrix: unknown[][]): unknown[][] {
  if (!Array.isArray(matrix)) return matrix;
  let end = matrix.length;
  while (end > 0) {
    const row = matrix[end - 1];
    const empty =
      !Array.isArray(row) ||
      row.every((cell) => cellText(cell) === "");
    if (!empty) break;
    end -= 1;
  }
  return matrix.slice(0, end);
}

export interface DetectedFeeHeader {
  headerRow: number;
  ppidCol: number;
  namaCol: number;
  feeCol: number;
  feeLabel: string;
  statusCol: number;
  periodeCol: number;
  potonganCols: { index: number; label: string }[];
  columns: DetectedFeeColumns;
}

/**
 * Hint pemetaan kolom eksplisit (indeks 0-based) untuk layout sheet yang
 * sudah diketahui — mis. sheet "Loket BSB": PPID idx 1, Nama idx 2,
 * fee idx [189, 191, 196] (dicoba berurutan). Hint hanya dipakai bila
 * header di indeks tersebut lolos ambang skor perannya; selebihnya
 * fallback ke auto-deteksi.
 */
export interface FeeColumnHints {
  ppid?: number;
  nama?: number;
  fee?: number[];
  status?: number;
  periode?: number;
}

export interface FeeParseOptions {
  /** Baris header yang diharapkan (0-based) — dicek PERTAMA, lalu scan umum. */
  headerRowHint?: number;
  /** Baris data pertama (0-based) — hanya berlaku bila header ketemu di hint. */
  dataStartRowHint?: number;
  columnHints?: FeeColumnHints;
  /**
   * Inspektor sel mentah worksheet (untuk deteksi formula .xlsb tanpa
   * nilai cache). Page memasok `(r, c) => ws[encode_cell({r, c})]`.
   * Tanpa ini, audit formula dilewati (0).
   */
  inspectCell?: (r: number, c: number) => { hasFormula: boolean } | undefined;
}

/** Satu sampel audit: nilai mentah sel fee vs hasil parse. */
export interface FeeAuditSample {
  /** Indeks baris matriks (0-based) — tampilkan +1 sebagai nomor baris Excel. */
  matrixRow: number;
  ppid: string;
  /** Nilai mentah sel fee (JSON-able) sebelum parseAmount. */
  raw: unknown;
  parsed: number;
  hasFormula: boolean;
}

export interface FeeParseAudit {
  totalRows: number;
  zeroFeeRows: number;
  /** True bila SEMUA baris Rp 0 — pemicu warning massal di UI. */
  allZero: boolean;
  /** Sel fee berformula tanpa nilai tersimpan (khas .xlsb bermasalah). */
  formulaWithoutValue: number;
  /** Baris yang total mentahnya negatif lalu di-clamp ke 0 (OVER_DEDUCTED_CLAMPED). */
  clampedFeeRows: number;
  samples: FeeAuditSample[];
}

const EMPTY_AUDIT: FeeParseAudit = {
  totalRows: 0,
  zeroFeeRows: 0,
  allZero: false,
  formulaWithoutValue: 0,
  clampedFeeRows: 0,
  samples: [],
};

/**
 * Target sheet + layout file rekap yang sudah dipetakan:
 * "Fee Loket CUM_Agustus 2026" → sheet "Loket BSB", header baris ke-3
 * (indeks 2), data mulai baris ke-6 (indeks 5), PPID idx 1,
 * Nama Loket idx 2, fee di idx 189/191/196 (JUMLAH FEE BULAN INI /
 * JUMLAH FEE / Fee Siap Transfer — dicoba berurutan).
 */
export const LOKET_BSB_SHEET = "Loket BSB";

export const LOKET_BSB_TARGET: {
  sheetName: string;
  headerRowHint: number;
  dataStartRowHint: number;
  columnHints: FeeColumnHints;
} = {
  sheetName: LOKET_BSB_SHEET,
  headerRowHint: 2,
  dataStartRowHint: 5,
  columnHints: { ppid: 1, nama: 2, fee: [189, 191, 196] },
};

/**
 * Pilih sheet target bila ada: exact "Loket BSB" dulu, lalu
 * case-insensitive. Null bila tidak ada (pemanggil fallback ke
 * pemindaian semua sheet).
 */
export function selectFeeSheet(
  sheetNames: string[]
): { name: string; target: FeeSheetTarget } | null {
  if (!Array.isArray(sheetNames)) return null;
  const found =
    sheetNames.find((n) => n === LOKET_BSB_SHEET) ??
    sheetNames.find(
      (n) =>
        typeof n === "string" &&
        n.trim().toLowerCase() === LOKET_BSB_SHEET.toLowerCase()
    );
  if (!found) return null;
  return {
    name: found,
    target: {
      sheetName: found,
      headerRowHint: LOKET_BSB_TARGET.headerRowHint,
      dataStartRowHint: LOKET_BSB_TARGET.dataStartRowHint,
      columnHints: { ...LOKET_BSB_TARGET.columnHints },
    },
  };
}

export interface FeeSheetTarget {
  sheetName: string;
  headerRowHint?: number;
  dataStartRowHint?: number;
  columnHints?: FeeColumnHints;
}

/**
 * Deteksi baris header + petakan kolom (dipakai parser dan pemindai
 * sheet). `opts` opsional: hint baris header dicek pertama; hint kolom
 * menang atas auto-deteksi bila lolos ambang. Null bila tidak ada
 * baris header valid dalam 10 baris pertama.
 */
export function detectFeeHeader(
  matrix: unknown[][],
  opts?: FeeParseOptions
): DetectedFeeHeader | null {
  if (!Array.isArray(matrix) || matrix.length === 0) return null;
  const hints = opts?.columnHints;
  const limit = Math.min(matrix.length, 10);
  // Urutan cek: hint baris dulu (layout diketahui), lalu scan umum.
  const order: number[] = [];
  if (
    opts?.headerRowHint != null &&
    Number.isInteger(opts.headerRowHint) &&
    opts.headerRowHint >= 0 &&
    opts.headerRowHint < limit
  ) {
    order.push(opts.headerRowHint);
  }
  for (let r = 0; r < limit; r += 1) {
    if (!order.includes(r)) order.push(r);
  }
  for (const r of order) {
    const cells = (matrix[r] ?? []).map(normalizeHeaderCell);
    const best = (role: "ppid" | "nama" | "fee" | "status" | "periode") => {
      let idx = -1;
      let score = -1;
      cells.forEach((c, i) => {
        const s = scoreFeeColumn(c, role);
        if (s > score) {
          score = s;
          idx = i;
        }
      });
      return score >= 0 ? idx : -1;
    };
    // Hint kolom eksplisit (ambang: skor peran minimal 10).
    const hinted = (
      role: "ppid" | "nama" | "fee" | "status" | "periode",
      hint?: number
    ) => {
      if (
        hint == null ||
        !Number.isInteger(hint) ||
        hint < 0 ||
        hint >= cells.length
      ) {
        return -1;
      }
      return scoreFeeColumn(cells[hint] ?? "", role) >= 10 ? hint : -1;
    };
    // Fee: coba daftar hint berurutan (189 → 191 → 196), ambang 40.
    const hintedFee = (() => {
      const list = hints?.fee;
      if (!Array.isArray(list)) return -1;
      for (const h of list) {
        if (!Number.isInteger(h) || h < 0 || h >= cells.length) continue;
        if (scoreFeeColumn(cells[h] ?? "", "fee") >= 40) return h;
      }
      return -1;
    })();
    const ppidHint = hinted("ppid", hints?.ppid);
    const namaHint = hinted("nama", hints?.nama);
    const ppid = ppidHint >= 0 ? ppidHint : best("ppid");
    const nama = namaHint >= 0 ? namaHint : best("nama");
    const fee = hintedFee >= 0 ? hintedFee : best("fee");
    // Anti tabrakan: tiga peran wajib harus menunjuk kolom fisik berbeda.
    if (
      ppid !== -1 &&
      nama !== -1 &&
      fee !== -1 &&
      new Set([ppid, nama, fee]).size === 3
    ) {
      const feeLabel = cells[fee] ?? "";
      const statusHint = hinted("status", hints?.status);
      const periodeHint = hinted("periode", hints?.periode);
      let statusCol = statusHint >= 0 ? statusHint : best("status");
      if (statusCol === ppid || statusCol === nama || statusCol === fee) {
        statusCol = -1;
      }
      let periodeCol = periodeHint >= 0 ? periodeHint : best("periode");
      if (periodeCol === ppid || periodeCol === nama || periodeCol === fee) {
        periodeCol = -1;
      }
      const potonganCols = cells
        .map((c, i) => ({ index: i, label: cells[i] ?? "" }))
        .filter(
          ({ index, label }) =>
            index !== ppid &&
            index !== nama &&
            index !== fee &&
            index !== statusCol &&
            index !== periodeCol &&
            isPotonganColumn(label, feeLabel)
        );
      // Label asli untuk diagnostik UI (bukti kolom TOTAL FEE yang dipakai).
      const headerLabels = (matrix[r] ?? []).map(cellText);
      return {
        headerRow: r,
        ppidCol: ppid,
        namaCol: nama,
        feeCol: fee,
        feeLabel,
        statusCol,
        periodeCol,
        potonganCols,
        columns: {
          ppid: headerLabels[ppid] ?? "",
          nama: headerLabels[nama] ?? "",
          fee: headerLabels[fee] ?? "",
          status: statusCol !== -1 ? (headerLabels[statusCol] ?? "") : "",
          periode: periodeCol !== -1 ? (headerLabels[periodeCol] ?? "") : "",
          potongan: potonganCols.map((c) => headerLabels[c.index] ?? ""),
        },
      };
    }
  }
  return null;
}

/**
 * Parse matriks AOA SheetJS menjadi baris fee.
 * Header dideteksi dinamis (maks 10 baris pertama), dinormalisasi ke
 * lowercase + trim, lalu dicocokkan per-token dengan prioritas:
 * PPID > Kode Agen/Loket; "Nama Loket"/"Nama Agen" > "Loket"/"Agen";
 * "Total Fee" > "Fee" > Nominal/Komisi. Satu kolom fisik tidak boleh
 * memegang dua peran (anti tabrakan "Kode Loket").
 * Kolom potongan (Potongan/Denda/Admin/PPh/...) dijumlahkan sebagai
 * pengurang dengan rincian sendiri; STATUS/PERIODE opsional.
 * Ekor kosong dipangkas dulu agar `skipped` akurat.
 * `periodeFallback` dipakai bila file tidak memuat kolom periode valid.
 * `opts` opsional (FeeParseOptions): hint baris header, baris data
 * pertama, dan indeks kolom eksplisit untuk layout yang sudah diketahui
 * (mis. sheet "Loket BSB" via LOKET_BSB_TARGET).
 */
export function parseFeeRowsFromAOA(
  matrix: unknown[][],
  periodeFallback: string,
  fileLabel = "import",
  opts?: FeeParseOptions
): ParsedFeePreview {
  const clean = trimTrailingEmptyRows(
    Array.isArray(matrix) ? matrix : []
  );
  if (clean.length === 0) {
    return { rows: [], skipped: 0, detectedHeaderRow: -1, columns: EMPTY_COLUMNS, audit: EMPTY_AUDIT };
  }
  const detected = detectFeeHeader(clean, opts);
  if (!detected) {
    return { rows: [], skipped: 0, detectedHeaderRow: -1, columns: EMPTY_COLUMNS, audit: EMPTY_AUDIT };
  }
  // Baris data pertama: hint layout (mis. Loket BSB mulai indeks 5) hanya
  // berlaku bila header memang ketemu di baris hint — jika tidak, mulai
  // tepat di bawah header agar data tidak terlewat.
  const honoredHint =
    opts?.dataStartRowHint != null &&
    opts.headerRowHint != null &&
    detected.headerRow === opts.headerRowHint;
  const startRow = honoredHint
    ? Math.max(detected.headerRow + 1, opts.dataStartRowHint as number)
    : detected.headerRow + 1;

  return buildRowsFromDetection(clean, detected, {
    startRow,
    periodeFallback,
    fileLabel,
    inspectCell: opts?.inspectCell,
    // Sengaja TANPA Math.max di sini: tanda negatif dipertahankan agar
    // over-deducted terdeteksi di clamp terpusat + flag audit.
    amountOf: (v) => parseAmount(v),
  });
}

/**
 * Konversi absolut nilai sel fee: Number() dulu (sesuai aturan mutlak —
 * angka/string numerik polos apa adanya), fallback parseAmount untuk
 * format Indonesia ("Rp 1.500.000", "1.500.000,50", "(2.500)", "-").
 * Selalu finite; 0 untuk kosong/tak-valid.
 */
export function toAbsoluteAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;
  const s = value.trim();
  if (s === "") return 0;
  // Fast path HANYA untuk string integer polos ("1500000", "-2500"):
  // string bertitik seperti "-3.000"/"2.500" adalah pemisah ribuan
  // Indonesia (bukan desimal JS) sehingga wajib lewat parseAmount agar
  // konsisten dengan parser dinamis — Number("-3.000") === -3 adalah
  // bug tafsir yang pernah membuat kedua parser divergen.
  if (/^[+-]?\d+$/.test(s)) {
    const direct = Number(s);
    if (Number.isFinite(direct)) return direct;
  }
  return parseAmount(s);
}

/**
 * Indeks kolom fee absolut sheet Loket BSB (0-based), dicoba berurutan:
 * 191 = JUMLAH FEE, 189 = JUMLAH FEE BULAN INI.
 */
export const ABSOLUTE_FEE_COLS = [191, 189];

/** PPID / Nama Loket absolut sheet Loket BSB (0-based). */
export const ABSOLUTE_PPID_COL = 1;
export const ABSOLUTE_NAMA_COL = 2;
/** Header mutlak sheet Loket BSB: baris ke-3 (indeks 2). */
export const ABSOLUTE_HEADER_ROW = 2;
/** Data mutlak sheet Loket BSB: mulai baris ke-6 (indeks 5). */
export const ABSOLUTE_DATA_START_ROW = 5;

/**
 * Kandidat kolom fee absolut yang headernya valid (skor fee ≥ 40),
 * berurutan prioritas ABSOLUTE_FEE_COLS (191 → 189).
 */
export function validatedAbsoluteFeeCols(normCells: string[]): number[] {
  const out: number[] = [];
  for (const idx of ABSOLUTE_FEE_COLS) {
    if (idx < 0 || idx >= normCells.length) continue;
    if (scoreFeeColumn(normCells[idx] ?? "", "fee") >= 40) out.push(idx);
  }
  return out;
}

/**
 * Header mutlak sheet Loket BSB: PPID idx 1, Nama idx 2, fee = kandidat
 * tervalidasi pertama. Status/periode/potongan tetap dideteksi dinamis
 * pada baris header. Null bila sanity gagal (pemanggil fallback ke
 * deteksi dinamis penuh).
 */
export function absoluteLoketBsbHeader(
  matrix: unknown[][]
): DetectedFeeHeader | null {
  if (!Array.isArray(matrix) || matrix.length <= ABSOLUTE_HEADER_ROW) {
    return null;
  }
  const norm = (matrix[ABSOLUTE_HEADER_ROW] ?? []).map(normalizeHeaderCell);
  if (scoreFeeColumn(norm[ABSOLUTE_PPID_COL] ?? "", "ppid") < 10) return null;
  if (scoreFeeColumn(norm[ABSOLUTE_NAMA_COL] ?? "", "nama") < 10) return null;
  const candidates = validatedAbsoluteFeeCols(norm);
  if (candidates.length === 0) return null;
  const feeCol = candidates[0] as number;
  const taken = new Set([ABSOLUTE_PPID_COL, ABSOLUTE_NAMA_COL, feeCol]);
  const bestOnRow = (role: "status" | "periode") => {
    let idx = -1;
    let score = -1;
    norm.forEach((c, i) => {
      if (taken.has(i)) return;
      const s = scoreFeeColumn(c, role);
      if (s > score) {
        score = s;
        idx = i;
      }
    });
    return score >= 0 ? idx : -1;
  };
  const feeLabel = norm[feeCol] ?? "";
  const statusCol = bestOnRow("status");
  const periodeCol = bestOnRow("periode");
  const potonganCols = norm
    .map((label, index) => ({ index, label }))
    .filter(
      ({ index, label }) =>
        !taken.has(index) &&
        index !== statusCol &&
        index !== periodeCol &&
        isPotonganColumn(label, feeLabel)
    );
  const headerLabels = (matrix[ABSOLUTE_HEADER_ROW] ?? []).map(cellText);
  return {
    headerRow: ABSOLUTE_HEADER_ROW,
    ppidCol: ABSOLUTE_PPID_COL,
    namaCol: ABSOLUTE_NAMA_COL,
    feeCol,
    feeLabel,
    statusCol,
    periodeCol,
    potonganCols,
    columns: {
      ppid: headerLabels[ABSOLUTE_PPID_COL] ?? "",
      nama: headerLabels[ABSOLUTE_NAMA_COL] ?? "",
      fee: headerLabels[feeCol] ?? "",
      status: statusCol !== -1 ? (headerLabels[statusCol] ?? "") : "",
      periode: periodeCol !== -1 ? (headerLabels[periodeCol] ?? "") : "",
      potongan: potonganCols.map((c) => headerLabels[c.index] ?? ""),
    },
  };
}

/**
 * Parser ABSOLUT sheet Loket BSB — aturan mutlak, tanpa tebak label:
 * header indeks 2; PPID idx 1; Nama idx 2; fee idx 191/189;
 * data dari indeks 5; dropna PPID; konversi Number()-dulu.
 * Fallback: null (pemanggil lanjutkan ke parseFeeRowsFromAOA dinamis).
 */
export function parseLoketBsbRows(
  matrix: unknown[][],
  periodeFallback: string,
  fileLabel = "import",
  inspectCell?: FeeParseOptions["inspectCell"]
): ParsedFeePreview | null {
  const clean = trimTrailingEmptyRows(
    Array.isArray(matrix) ? matrix : []
  );
  const detected = absoluteLoketBsbHeader(clean);
  if (!detected) return null;
  const startRow = Math.max(detected.headerRow + 1, ABSOLUTE_DATA_START_ROW);
  // Bukti data: bila kolom prioritas (191) kosong di SELURUH baris data
  // SEMENTARA kandidat lain (189) berisi angka, pakai yang berisi —
  // ini perangkap "kolom kosong terbaca Rp 0". Pindai semua baris
  // (bukan 20 pertama) agar nilai yang baru muncul di bawah tetap
  // menang; loop O(n) murah dibanding risiko salah kolom massal.
  // Bila prioritas berisi data (atau semua kosong = fee memang 0),
  // prioritas menang.
  const normHeader = (clean[detected.headerRow] ?? []).map(normalizeHeaderCell);
  const candidates = validatedAbsoluteFeeCols(normHeader);
  let refined = detected;
  if (candidates.length > 1 && candidates[0] === detected.feeCol) {
    const hasData = (idx: number) => {
      for (let r = startRow; r < clean.length; r += 1) {
        if (toAbsoluteAmount((clean[r] ?? [])[idx]) !== 0) return true;
      }
      return false;
    };
    if (!hasData(detected.feeCol)) {
      const alt = candidates.slice(1).find((idx) => hasData(idx));
      if (alt != null) {
        const headerLabels = (clean[detected.headerRow] ?? []).map(cellText);
        refined = {
          ...detected,
          feeCol: alt,
          feeLabel: normHeader[alt] ?? "",
          columns: { ...detected.columns, fee: headerLabels[alt] ?? "" },
        };
      }
    }
  }
  return buildRowsFromDetection(clean, refined, {
    startRow,
    periodeFallback,
    fileLabel,
    inspectCell,
    // Sengaja TANPA Math.max di sini: lihat komentar di parseFeeRowsFromAOA.
    amountOf: (v) => toAbsoluteAmount(v),
  });
}

interface RowBuildOptions {
  startRow: number;
  periodeFallback: string;
  fileLabel: string;
  inspectCell?: FeeParseOptions["inspectCell"];
  amountOf: (v: unknown) => number;
}

/** Loop baris bersama untuk parser dinamis & absolut (dropna PPID + audit). */
function buildRowsFromDetection(
  clean: unknown[][],
  detected: DetectedFeeHeader,
  options: RowBuildOptions
): ParsedFeePreview {
  const {
    headerRow,
    ppidCol,
    namaCol,
    feeCol,
    feeLabel,
    statusCol,
    periodeCol,
    potonganCols,
    columns,
  } = detected;
  const { startRow, periodeFallback, fileLabel, inspectCell, amountOf } = options;
  const feeHeaderLabel =
    feeLabel
      .split(" ")
      .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : ""))
      .join(" ") || "Fee";

  const rows: FeeRekapRow[] = [];
  let skipped = 0;
  const auditSamples: FeeAuditSample[] = [];
  let formulaWithoutValue = 0;
  let clampedFeeRows = 0;
  for (let r = startRow; r < clean.length; r += 1) {
    const cells = clean[r] ?? [];
    const ppid = normalizePpid(cells[ppidCol]);
    const nama = cellText(cells[namaCol]);
    // dropna PPID: baris kosong/sela tidak ikut (penyebab TOTAL 0 di preview).
    if (ppid === "" && nama === "") {
      skipped += 1;
      continue;
    }
    if (ppid === "") {
      skipped += 1;
      continue;
    }
    const feeRaw = cells[feeCol];
    const feeMeta = inspectCell?.(r, feeCol);
    const hasFormula = feeMeta?.hasFormula === true;
    // Formula .xlsb tanpa nilai cache (v kosong) = akar Rp-0 massal yang
    // khas: sel "terlihat" berisi angka di Excel tapi SheetJS membaca "".
    const fee = amountOf(feeRaw);
    if (auditSamples.length < 5) {
      auditSamples.push({ matrixRow: r, ppid, raw: feeRaw, parsed: fee, hasFormula });
    }
    if (hasFormula && fee === 0) formulaWithoutValue += 1;
    const potonganList = potonganCols.map((c) => ({
      label: c.label
        .split(" ")
        .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : ""))
        .join(" "),
      nilai: -Math.abs(parseAmount(cells[c.index])),
    }));
    const totalPotongan = potonganList.reduce((s, d) => s + d.nilai, 0);
    // Clamp terpusat + flag audit: over-potongan / fee negatif TIDAK
    // boleh hilang diam-diam via Math.max(0, ...).
    const clamped = clampFeeTotal(fee + totalPotongan);
    const totalFee = clamped.total;
    if (clamped.clamped) clampedFeeRows += 1;
    // Fallback nama: kolom Excel -> PPID (data master/API menyusul di UI).
    const namaLoket = nama !== "" ? nama : ppid;
    const status =
      statusCol !== -1 ? parseStatus(cells[statusCol]) : "PENDING";
    const periodeRaw =
      periodeCol !== -1 ? cellText(cells[periodeCol]) : "";
    const periode =
      /^\d{4}-\d{2}$/.test(periodeRaw) && Number(periodeRaw.slice(5)) >= 1 &&
      Number(periodeRaw.slice(5)) <= 12
        ? periodeRaw
        : periodeFallback;
    const rincian: FeeRincian[] = [
      { label: feeHeaderLabel, nilai: fee },
      ...potonganList.filter((d) => d.nilai !== 0),
    ];
    if (clamped.clamped) {
      rincian.push({
        label: `OVER_DEDUCTED_CLAMPED (nilai asli ${clamped.raw})`,
        nilai: 0,
      });
    }
    rows.push({
      id: `${fileLabel}-${r}`,
      ppid,
      namaLoket,
      periode,
      totalFee,
      status,
      rincian,
      updatedAt: new Date().toISOString(),
      ...(clamped.clamped ? { auditFlag: "OVER_DEDUCTED_CLAMPED" as const } : {}),
    });
  }
  const zeroFeeRows = rows.filter((x) => x.totalFee === 0).length;
  return {
    rows,
    skipped,
    detectedHeaderRow: headerRow,
    columns,
    audit: {
      totalRows: rows.length,
      zeroFeeRows,
      allZero: rows.length > 0 && zeroFeeRows === rows.length,
      formulaWithoutValue,
      clampedFeeRows,
      samples: auditSamples,
    },
  };
}

// ---------------------------------------------------------------------------
// Export CSV (tanpa dependensi tambahan; Excel via SheetJS di page)
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (/[";\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildFeeCsv(rows: FeeRekapRow[]): string {
  const header = "No;PPID;Nama Loket;Periode;Total Fee (Rp);Status";
  const lines = rows.map((r, i) =>
    [
      String(i + 1),
      csvEscape(r.ppid),
      csvEscape(r.namaLoket),
      csvEscape(formatPeriode(r.periode)),
      String(r.totalFee),
      r.status,
    ].join(";")
  );
  return [header, ...lines].join("\n");
}

/** Teks slip ringkas untuk print / kirim ke agen via WA. */
export function buildFeeSlipText(row: FeeRekapRow): string {
  const lines = [
    `SLIP FEE LOKET/AGEN`,
    `PPID   : ${row.ppid}`,
    `Loket  : ${row.namaLoket}`,
    `Periode: ${formatPeriode(row.periode)}`,
    `------------------------------`,
    ...row.rincian.map(
      (d) => `${d.label}: ${formatRupiah(d.nilai)}`
    ),
    `------------------------------`,
    `TOTAL  : ${formatRupiah(row.totalFee)}`,
    `Status : ${row.status === "TERBAYAR" ? "TERBAYAR" : "PENDING"}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Klasifikasi error DB (murni — dipakai API routes agar 500 generik
// menjadi pesan JSON yang jelas: tabel belum dimigrasi vs RLS vs lain).
// ---------------------------------------------------------------------------

interface DbErrorLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

export interface ClassifiedFeeDbError {
  /** HTTP status yang disarankan (503 bila infra/belum migrasi). */
  status: number;
  /** Kode mesin untuk branching di client ("MIGRATION_MISSING", ...). */
  code: string;
  message: string;
}

/**
 * Akar 500 di GET /api/fee-rekap & /logs: migration
 * 20260924000000_fee_loket.sql belum di-apply sehingga tabel tidak ada
 * (PostgREST 42P01 / PGRST205). Klasifikasi ini mengubahnya menjadi
 * 503 + instruksi migrasi yang actionable, bukan "Internal Server Error".
 */
export function classifyFeeDbError(
  error: DbErrorLike | null | undefined,
  table: string,
  fallback: string
): ClassifiedFeeDbError {
  const code = typeof error?.code === "string" ? error.code : "";
  const text = [error?.message, error?.details, error?.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" | ");
  const message =
    (typeof error?.message === "string" && error.message) || fallback;

  if (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist|table .* does not exist|could not find the table/i.test(
      `${code} ${text}`
    )
  ) {
    return {
      status: 503,
      code: "MIGRATION_MISSING",
      message:
        `Tabel ${table} belum tersedia. Jalankan migration ` +
        `20260924000000_fee_loket.sql (supabase db push), lalu coba lagi.`,
    };
  }
  // Kolom Master belum ada (42703 / PGRST204 "column ... does not exist"):
  // migration extra 20261003000000 belum di-apply sementara kode sudah
  // request kolom baru (subsidi_antar_loket, total_fee, ...). Tanpa
  // klasifikasi ini, slip menampilkan Rp 0/kosong tanpa penjelasan.
  if (
    code === "42703" ||
    code === "PGRST204" ||
    /column .* does not exist|could not find the .* column/i.test(
      `${code} ${text}`
    )
  ) {
    return {
      status: 503,
      code: "MIGRATION_MISSING",
      message:
        `Kolom Master pada ${table} belum lengkap. Jalankan migration ` +
        `20261003000000_loket_profiles_master_extra.sql (supabase db push), lalu coba lagi.`,
    };
  }
  if (
    code === "42501" ||
    code === "PGRST301" ||
    /permission denied|row-level security|not authorized/i.test(`${code} ${text}`)
  ) {
    return {
      status: 503,
      code: "RLS_DENIED",
      message: `Akses database ditolak untuk ${table} (RLS/GRANT). Pastikan migration RLS lockdown sudah di-apply dan API memakai service_role.`,
    };
  }
  return { status: 500, code: "DB_ERROR", message };
}

// ---------------------------------------------------------------------------
// Chunking impor (murni — fondasi perbaikan 413 untuk 10.000+ baris)
// ---------------------------------------------------------------------------

/** Ukuran satu chunk POST impor (kecil agar lolos limit body platform). */
export const IMPORT_CHUNK_SIZE = 500;

/** Maksimal baris per satu request POST impor di server. */
export const IMPORT_MAX_ROWS_PER_REQUEST = 1000;

/** Pecah array menjadi potongan berukuran `size` (terakhir bisa lebih kecil). */
export function splitIntoChunks<T>(rows: T[], size: number): T[][] {
  const chunk = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    out.push(rows.slice(i, i + chunk));
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB mapping (snake_case Supabase <-> camelCase UI)
// ---------------------------------------------------------------------------

interface FeeDbRow {
  id: string;
  ppid: string;
  nama_loket: string;
  periode: string;
  /**
   * Kolom DB `bigint` — PostgREST mengembalikan int8 sebagai STRING JSON
   * (bukan number). WAJIB dikoersi via parseAmount; typeof-check Number
   * murni adalah akar Rp-0 massal di tabel + Slip.
   */
  total_fee: number | string;
  status: string;
  rincian: unknown;
  updated_at: string;
}

function normalizeFeeStatus(value: unknown): FeeStatus {
  return String(value ?? "").trim().toUpperCase() === "TERBAYAR"
    ? "TERBAYAR"
    : "PENDING";
}

function normalizeRincian(value: unknown, totalFee: number): FeeRincian[] {
  if (!Array.isArray(value)) {
    return [{ label: "Total fee", nilai: totalFee }];
  }
  const out = (value as unknown[])
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .slice(0, 20)
    .map((d) => ({
      label: typeof d.label === "string" && d.label.trim() !== "" ? d.label.trim() : "Komponen fee",
      // parseAmount toleran Number maupun String (jsonb/PostgREST bisa string).
      nilai: parseAmount(d.nilai),
    }));
  return out.length > 0 ? out : [{ label: "Total fee", nilai: totalFee }];
}

/** Petakan satu baris `fee_loket` ke `FeeRekapRow` UI. */
export function toFeeRekapRow(row: FeeDbRow): FeeRekapRow {  // parseAmount menerima Number/bigint maupun String numerik ("1500000")
  // dari PostgREST; clamp negatif ke 0 HANYA via clampFeeTotal + flag.
  const clamped = clampFeeTotal(parseAmount(row.total_fee));
  const totalFee = clamped.total;
  const rincian = normalizeRincian(row.rincian, totalFee);
  if (clamped.clamped) {
    rincian.push({
      label: `OVER_DEDUCTED_CLAMPED (nilai asli ${clamped.raw})`,
      nilai: 0,
    });
  }
  return {
    id: String(row.id ?? ""),
    // Kanonis seperti saat simpan agar pencarian strict selalu cocok
    // (baris lama ber-NBSP ikut ternormalisasi di sisi baca).
    ppid: normalizePpid(row.ppid),
    namaLoket: String(row.nama_loket ?? ""),
    periode: String(row.periode ?? ""),
    totalFee,
    status: normalizeFeeStatus(row.status),
    rincian,
    updatedAt: String(row.updated_at ?? ""),
    ...(clamped.clamped ? { auditFlag: "OVER_DEDUCTED_CLAMPED" as const } : {}),
  };
}

/**
 * Baris mentah `loket_profiles` dari PostgREST. Kolom `bigint` datang
 * sebagai STRING JSON (int8) atau number — WAJIB dikoersi via
 * `parseAmount` (lihat komentar `FeeDbRow`); akses langsung tanpa
 * koersi adalah akar "Total Fee Rp 0" di tabel monitoring.
 */
export interface LoketProfilDbRow {
  id?: unknown;
  ppid: unknown;
  nama_loket: unknown;
  bank?: unknown;
  no_rekening?: unknown;
  nama_pemilik?: unknown;
  rekomender?: unknown;
  elektrik_area?: unknown;
  periode: unknown;
  fee_bulan_ini: unknown;
  fee_bulan_sebelumnya: unknown;
  subsidi_antar_loket?: unknown;
  total_fee?: unknown;
  minus?: unknown;
  hold?: unknown;
  potongan_lainnya?: unknown;
  potongan_ongkir?: unknown;
  total_fee_transfer?: unknown;
  fee_ke_deposit?: unknown;
  fee_transfer_rekening?: unknown;
  sisa_fee?: unknown;
  keterangan?: unknown;
  tanggal_transfer?: unknown;
  fee_siap_transfer?: unknown;
  status_pembayaran?: unknown;
  updated_at?: unknown;
}

/**
 * Petakan satu baris `loket_profiles` ke `FeeRekapRow` UI — sumber
 * kebenaran Master untuk tabel monitoring (menggantikan `fee_loket`).
 * - Total = `total_fee` tersimpan; bila 0/absen (baris lama pra-migrasi
 *   extra), dihitung dari komponen E14 (Bulan Ini + Lalu + Subsidi) agar
 *   tidak pernah 0 akibat kolom yang belum terisi.
 * - Status biner via `isPaidStatus` (kaya → TERBAYAR) agar badge tabel
 *   konsisten dengan Status Fee slip.
 * - Rincian = breakdown keuangan Master (transparan seperti slip).
 */
export function toFeeRekapRowFromProfil(row: LoketProfilDbRow): FeeRekapRow {
  const feeBulanIni = parseAmount(row.fee_bulan_ini);
  const feeBulanSebelumnya = parseAmount(row.fee_bulan_sebelumnya);
  const subsidi = parseAmount(row.subsidi_antar_loket);
  let totalFee = parseAmount(row.total_fee);
  if (totalFee === 0) {
    totalFee = feeBulanIni + feeBulanSebelumnya + subsidi;
  }
  const clamped = clampFeeTotal(totalFee);
  const statusRaw = normalizeLoketStatusInput(row.status_pembayaran);
  const status: FeeStatus = isPaidStatus(statusRaw) ? "TERBAYAR" : "PENDING";
  const rincian: FeeRincian[] = [
    { label: "Fee Bulan Ini", nilai: feeBulanIni },
    { label: "Fee Bulan Sebelumnya", nilai: feeBulanSebelumnya },
  ];
  if (subsidi !== 0) rincian.push({ label: "Subsidi Antar Loket", nilai: subsidi });
  const minus = parseAmount(row.minus);
  const hold = parseAmount(row.hold);
  const potongan = parseAmount(row.potongan_lainnya);
  const ongkir = parseAmount(row.potongan_ongkir);
  if (minus !== 0) rincian.push({ label: "Minus", nilai: minus });
  if (hold !== 0) rincian.push({ label: "Hold", nilai: hold });
  if (potongan !== 0) rincian.push({ label: "Potongan Lainnya", nilai: potongan });
  if (ongkir !== 0) rincian.push({ label: "Potongan Ongkir", nilai: ongkir });
  rincian.push({
    label: "Fee Siap Transfer",
    nilai: parseAmount(row.fee_siap_transfer),
  });
  if (clamped.clamped) {
    rincian.push({
      label: `OVER_DEDUCTED_CLAMPED (nilai asli ${clamped.raw})`,
      nilai: 0,
    });
  }
  return {
    id: String(row.id ?? `${row.ppid}||${row.periode}`),
    ppid: normalizePpid(row.ppid),
    namaLoket: String(row.nama_loket ?? ""),
    periode: String(row.periode ?? ""),
    totalFee: clamped.total,
    status,
    rincian,
    updatedAt: String(row.updated_at ?? ""),
    ...(clamped.clamped ? { auditFlag: "OVER_DEDUCTED_CLAMPED" as const } : {}),
  };
}

/** True bila baris DB mentah berbentuk profil Master (ada `fee_bulan_ini`). */
export function isProfilDbRow(row: unknown): row is LoketProfilDbRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "fee_bulan_ini" in (row as Record<string, unknown>)
  );
}

/** Periode kanonis "YYYY-MM". */
export const FEE_PERIODE_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Satu item payload impor fee (snake_case API maupun camelCase client). */
export interface FeeImportPayloadItem {
  ppid?: unknown;
  nama_loket?: unknown;
  namaLoket?: unknown;
  periode?: unknown;
  total_fee?: unknown;
  totalFee?: unknown;
  status?: unknown;
  rincian?: unknown;
  /**
   * Profil lengkap ala Excel Master (opsional, dikirim saveFeeImport bila
   * hasil parse berasal dari `parseLoketBsbFull`). Diabaikan oleh
   * `toFeeDbRow` (kompatibilitas mundur); dibaca oleh mapper profil
   * `toLoketProfileDbRow` / `normalizeImportDetails` di API import.
   */
  profil?: unknown;
  details?: unknown;
}

export interface FeeDbMappedRow {
  ppid: string;
  nama_loket: string;
  periode: string;
  total_fee: number;
  status: FeeStatus;
  rincian: { label: string; nilai: number }[];
  updated_at: string;
  /** Nilai fee mentah sebelum clamp (untuk audit jumlah). */
  rawTotal: number;
  /** True bila total mentah negatif lalu di-clamp ke 0. */
  clamped: boolean;
}

function cleanFeeStr(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/**
 * Petakan satu item payload impor menjadi baris DB `fee_loket`.
 * - PPID dikanonisasi via `normalizePpid` (persis seperti saat parse &
 *   cari) agar tidak ada varian NBSP/spasi/case yang membuat baris
 *   "tidak ditemukan" atau duplikat kunci.
 * - `total_fee` diambil defensif dari `total_fee` maupun camelCase
 *   `totalFee` (keduanya diparse via `parseAmount`) — payload yang
 *   salah bentuk key tidak lagi diam-diam menjadi Rp 0 tanpa jejak.
 * - Periode SELALU memakai `fallbackPeriode` (periode deklarasi admin
 *   di dropdown) agar baris tersimpan, hasil respons, log upload, dan
 *   verifikasi baca-ulang selalu merujuk periode yang sama.
 * - Null bila PPID kosong (baris dilewati + dihitung server).
 * Komponen rincian memakai `parseAmount` (tanda negatif potongan
 * dipertahankan); hanya TOTAL final yang di-clamp via `clampFeeTotal`.
 */
export function toFeeDbRow(
  item: FeeImportPayloadItem,
  fallbackPeriode: string
): FeeDbMappedRow | null {
  if (typeof item !== "object" || item === null) return null;
  const ppid = normalizePpid(item.ppid).slice(0, 100);
  if (ppid === "") return null;
  const periode = FEE_PERIODE_REGEX.test(fallbackPeriode) ? fallbackPeriode : "";
  if (periode === "") return null;
  // Defensif: terima snake_case (kontrak API) maupun camelCase (client).
  const rawTotal = parseAmount(
    item.total_fee ?? (item as { totalFee?: unknown }).totalFee
  );
  const statusRaw = cleanFeeStr(item.status, 20).toUpperCase();
  const status: FeeStatus = statusRaw === "TERBAYAR" ? "TERBAYAR" : "PENDING";
  const namaLoket =
    cleanFeeStr(item.nama_loket, 200) ||
    cleanFeeStr((item as { namaLoket?: unknown }).namaLoket, 200) ||
    ppid;
  const rincianIn = Array.isArray(item.rincian) ? item.rincian : null;
  const rincian = (
    rincianIn ??
    [{ label: "Total fee (impor Excel)", nilai: rawTotal }]
  )
    .filter(
      (d): d is Record<string, unknown> =>
        typeof d === "object" && d !== null
    )
    .slice(0, 20)
    .map((d) => ({
      label: cleanFeeStr(d.label, 120) || "Komponen fee",
      nilai: parseAmount(d.nilai),
    }));
  const clamped = clampFeeTotal(rawTotal);
  if (clamped.clamped) {
    rincian.push({
      label: `OVER_DEDUCTED_CLAMPED (nilai asli ${clamped.raw})`,
      nilai: 0,
    });
  }
  return {
    ppid,
    nama_loket: namaLoket,
    periode,
    total_fee: clamped.total,
    status,
    rincian:
      rincian.length > 0
        ? rincian
        : [{ label: "Total fee (impor Excel)", nilai: clamped.total }],
    updated_at: new Date().toISOString(),
    rawTotal: clamped.raw,
    clamped: clamped.clamped,
  };
}

interface UploadLogDbRow {
  id: string;
  tanggal_upload: string;
  nama_file: string;
  jumlah_baris: number;
  periode: string;
  diunggah_oleh: string;
}

/** Petakan satu baris `fee_upload_logs` ke `UploadLog` UI. */
export function toUploadLog(row: UploadLogDbRow): UploadLog {
  return {
    id: String(row.id ?? ""),
    tanggalUpload: String(row.tanggal_upload ?? ""),
    namaFile: String(row.nama_file ?? ""),
    jumlahBaris: Number(row.jumlah_baris) || 0,
    periode: String(row.periode ?? ""),
    diunggahOleh: String(row.diunggah_oleh ?? ""),
  };
}

// ---------------------------------------------------------------------------
// API client (dipakai Client Component; throw dengan pesan server)
// ---------------------------------------------------------------------------

export interface FeeListParams {
  q?: string;
  periode?: string;
  page?: number;
  pageSize?: number;
}

export interface FeeListResult {
  data: FeeRekapRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /**
   * True bila server masih menyimpan baris di luar halaman ini
   * (`total` > baris yang dikembalikan) — UI WAJIB menampilkan
   * peringatan agar pemotongan tidak terjadi diam-diam.
   */
  truncated: boolean;
  /** Sumber agregasi ringkasan server ("rpc" SQL vs "fallback" paginasi). */
  summarySource?: string;
  periods: string[];
  summary: { totalLoket: number; totalTerbayarAktif: number; latestPeriode: string };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    return new Error(body.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

/** Muat daftar fee + periode + ringkasan dari API (persistence riil). */
export async function fetchFeeList(params: FeeListParams = {}): Promise<FeeListResult> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.periode) query.set("periode", params.periode);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 2000));
  const res = await fetch(`/api/fee-rekap?${query.toString()}`);
  if (!res.ok) throw await readError(res, "Gagal memuat fee");
  const body = (await res.json()) as {
    data: (FeeDbRow | LoketProfilDbRow)[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    truncated?: unknown;
    summarySource?: unknown;
    periods: string[];
    summary: FeeListResult["summary"];
  };
  // Sumber kebenaran Master: baris profil (`fee_bulan_ini`, dst.)
  // dipetakan via toFeeRekapRowFromProfil; baris legacy fee_loket via
  // toFeeRekapRow. Deteksi bentuk per baris agar campuran transisi
  // (sebagian periode sudah re-impor Master) tetap benar.
  const data = (body.data ?? []).map((r) =>
    isProfilDbRow(r) ? toFeeRekapRowFromProfil(r) : toFeeRekapRow(r as FeeDbRow)
  );
  const total =
    typeof body.total === "number" && Number.isFinite(body.total)
      ? Math.max(0, Math.floor(body.total))
      : data.length;
  // truncated eksplisit dari server; fallback hitung lokal bila server lama.
  const truncated =
    typeof body.truncated === "boolean" ? body.truncated : data.length < total;
  return {
    data,
    total,
    page: body.page ?? 1,
    pageSize: body.pageSize ?? 2000,
    totalPages: body.totalPages ?? 1,
    truncated,
    summarySource:
      typeof body.summarySource === "string" ? body.summarySource : undefined,
    periods: body.periods ?? [],
    summary: body.summary ?? { totalLoket: 0, totalTerbayarAktif: 0, latestPeriode: "" },
  };
}

/** Muat riwayat upload dari API. */
export async function fetchUploadLogs(): Promise<UploadLog[]> {
  const res = await fetch("/api/fee-rekap/logs");
  if (!res.ok) throw await readError(res, "Gagal memuat riwayat");
  const body = (await res.json()) as { logs: UploadLogDbRow[] };
  return (body.logs ?? []).map(toUploadLog);
}

export interface SaveFeeImportInput {
  rows: FeeRekapRow[];
  fileName: string;
  periode: string;
}

export interface SaveFeeImportResult {
  upserted: number;
  periode: string;
  /** Jumlah nilai fee mentah yang diterima server (akumulasi semua chunk). */
  receivedSum: number;
  /** Jumlah nilai fee yang benar-benar tersimpan (akumulasi semua chunk). */
  storedSum: number;
  /** Baris bernilai total 0 di server (akumulasi semua chunk). */
  zeroRows: number;
  /** Profil Master ter-upsert ke loket_profiles (0 bila payload legacy). */
  profilesUpserted: number;
  /** Rincian modul ter-upsert ke loket_transaction_details. */
  detailsUpserted: number;
}

export interface SaveFeeProgress {
  /** Chunk yang baru selesai (1-based). */
  done: number;
  /** Total chunk. */
  total: number;
  /** Baris ter-upsert akumulasi sejauh ini. */
  upserted: number;
}

/**
 * Simpan hasil parse Excel via API (ADMIN) dengan chunking otomatis.
 *
 * Perbaikan 413: alih-alih 1 POST raksasa (10.000+ baris melebihi limit
 * body platform maupun MAX server), baris dipecah menjadi chunk
 * `IMPORT_CHUNK_SIZE` dan dikirim sequential. Upsert `ppid+periode`
 * bersifat idempotent sehingga chunk yang diulang aman. Log upload
 * ditulis server hanya pada chunk terakhir (`totalRows` = total semua
 * baris untuk `jumlah_baris` yang akurat).
 */
export async function saveFeeImport(
  input: SaveFeeImportInput,
  onProgress?: (p: SaveFeeProgress) => void
): Promise<SaveFeeImportResult> {
  const payload = input.rows.map((r) => ({
    ppid: r.ppid,
    nama_loket: r.namaLoket,
    periode: r.periode,
    total_fee: r.totalFee,
    status: r.status,
    rincian: r.rincian,
    // Profil Master (Loket BSB multi-level) — diteruskan apa adanya agar
    // API import mengisi loket_profiles + loket_transaction_details.
    // Undefined = baris legacy: hanya fee_loket yang di-upsert.
    ...(r.profil
      ? {
          profil: {
            ppid: r.profil.ppid,
            namaLoket: r.profil.namaLoket,
            bank: r.profil.bank,
            noRekening: r.profil.noRekening,
            namaPemilik: r.profil.namaPemilik,
            rekomender: r.profil.rekomender,
            elektrikArea: r.profil.elektrikArea,
            feeBulanIni: r.profil.feeBulanIni,
            feeBulanSebelumnya: r.profil.feeBulanSebelumnya,
            subsidiAntarLoket: r.profil.subsidiAntarLoket,
            totalFee: r.profil.totalFee,
            minus: r.profil.minus,
            hold: r.profil.hold,
            potonganLainnya: r.profil.potonganLainnya,
            potonganOngkir: r.profil.potonganOngkir,
            totalFeeTransfer: r.profil.totalFeeTransfer,
            feeKeDeposit: r.profil.feeKeDeposit,
            feeTransferRekening: r.profil.feeTransferRekening,
            sisaFee: r.profil.sisaFee,
            keterangan: r.profil.keterangan,
            tanggalTransfer: r.profil.tanggalTransfer,
            feeSiapTransfer: r.profil.feeSiapTransfer,
            statusPembayaran: r.profil.statusPembayaran,
          },
          details: r.profil.details.map((d) => ({
            modul: d.modul,
            lembar: d.lembar,
            feePerLembar: d.feePerLembar,
            total: d.total,
          })),
        }
      : {}),
  }));
  const chunks = splitIntoChunks(payload, IMPORT_CHUNK_SIZE);
  let upserted = 0;
  let receivedSum = 0;
  let storedSum = 0;
  let zeroRows = 0;
  let profilesUpserted = 0;
  let detailsUpserted = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const res = await fetch("/api/fee-rekap/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: chunks[i],
        fileName: input.fileName,
        periode: input.periode,
        totalRows: payload.length,
        chunk: { index: i, total: chunks.length },
      }),
    });
    if (!res.ok) {
      const err = await readError(res, "Gagal menyimpan fee");
      // Sertakan posisi chunk agar admin tahu progres saat gagal di tengah jalan.
      throw new Error(`${err.message} (batch ${i + 1}/${chunks.length})`);
    }
    const body = (await res.json()) as {
      upserted: number;
      periode: string;
      receivedSum?: unknown;
      storedSum?: unknown;
      zeroRows?: unknown;
      profilesUpserted?: unknown;
      detailsUpserted?: unknown;
    };
    upserted += body.upserted ?? 0;
    receivedSum += parseAmount(body.receivedSum ?? 0);
    storedSum += parseAmount(body.storedSum ?? 0);
    const z = body.zeroRows;
    zeroRows += typeof z === "number" && Number.isFinite(z) ? Math.max(0, Math.floor(z)) : 0;
    const pu = body.profilesUpserted;
    profilesUpserted += typeof pu === "number" && Number.isFinite(pu) ? Math.max(0, Math.floor(pu)) : 0;
    const du = body.detailsUpserted;
    detailsUpserted += typeof du === "number" && Number.isFinite(du) ? Math.max(0, Math.floor(du)) : 0;
    onProgress?.({ done: i + 1, total: chunks.length, upserted });
  }
  return { upserted, periode: input.periode, receivedSum, storedSum, zeroRows, profilesUpserted, detailsUpserted };
}

// ---------------------------------------------------------------------------
// Hapus baris fee (ADMIN) — dipakai tombol Hapus per baris + dialog konfirmasi
// ---------------------------------------------------------------------------

/** Maksimal id per satu request DELETE. */
export const FEE_DELETE_MAX_IDS = 500;

/**
 * Normalisasi daftar id hapus: string non-kosong, dedup, dibatasi.
 * Melempar bila tidak ada id valid (agar UI bisa menampilkan pesan).
 */
export function normalizeDeleteIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new Error("ids harus array tak-kosong");
  const unique = [
    ...new Set(
      ids
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v !== "")
    ),
  ];
  if (unique.length === 0) throw new Error("ID/ids wajib diisi");
  if (unique.length > FEE_DELETE_MAX_IDS) {
    throw new Error(`Maksimal ${FEE_DELETE_MAX_IDS} id per hapus massal`);
  }
  return unique;
}

export interface DeleteFeeResult {
  deleted: number;
}

/** Hapus baris fee via API (ADMIN). Melempar pesan error server. */
export async function deleteFeeRows(ids: string[]): Promise<DeleteFeeResult> {
  const list = normalizeDeleteIds(ids);
  const res = await fetch("/api/fee-rekap", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: list }),
  });
  if (!res.ok) throw await readError(res, "Gagal menghapus fee");
  const body = (await res.json()) as { deleted?: number };
  return { deleted: body.deleted ?? list.length };
}

export interface DropAllFeeResult {
  profiles: number;
  details: number;
  feeLoket: number;
}

/**
 * Reset total database fee (ADMIN): hapus SELURUH baris
 * `loket_transaction_details` + `loket_profiles` + `fee_loket` agar bisa
 * re-import bersih dari awal. Riwayat upload (`fee_upload_logs`)
 * dipertahankan sebagai jejak audit. Melempar pesan error server.
 */
export async function dropAllFeeData(): Promise<DropAllFeeResult> {
  const res = await fetch("/api/fee-rekap/drop-all", { method: "DELETE" });
  if (!res.ok) throw await readError(res, "Gagal menghapus seluruh data fee");
  const body = (await res.json()) as {
    deleted?: Partial<Record<"profiles" | "details" | "feeLoket", unknown>>;
  };
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  return {
    profiles: num(body.deleted?.profiles),
    details: num(body.deleted?.details),
    feeLoket: num(body.deleted?.feeLoket),
  };
}

// ---------------------------------------------------------------------------
// Model Excel Master: sheet `Loket BSB` (multi-level) + sheet `Cari`
// ---------------------------------------------------------------------------
//
// Struktur absolut sheet `Loket BSB` (indeks 0-based, diverifikasi terhadap
// file "Fee Loket CUM_Agustus 2026.xlsx", 10.697 baris x 209 kolom):
//   - Baris 1 (indeks 0): nomor kolom bantu (diabaikan).
//   - Baris 2 (indeks 1): grup (DATA LOKET / SKEMA FEE LOKET / PLN / ...).
//   - Baris 3 (indeks 2): header identitas + ringkasan (No, PPID,
//     Nama Loket, BANK, No.Rekening, Nama Pemilik, Rekomender,
//     Elektrik Area, BA ..., POST/PRE/NONTAG/JUMLAH, ..., JUMLAH FEE
//     BULAN INI, FEE BULAN SEBELUMNYA, JUMLAH FEE, MINUS, HOLD,
//     Potongan lainnya, Potongan Ongkir, Fee Siap Transfer, ...).
//   - Baris 4 (indeks 3): nama modul tarif (PLN Postpaid, ...) + total
//     agregat + label sub (CASHBACK, Adm 0, ...).
//   - Baris 5 (indeks 4): nilai agregat / tarif acuan.
//   - Baris 6+ (indeks 5+): data loket (dropna PPID).
//
// Sheet `Cari` mem-VLOOKUP satu PPID menjadi:
//   - Slip profil (C6:E24): PPID, Nama Loket, Nomor Rekening, BANK,
//     Pemilik, Fee Bulan Ini (=N2 agregat rincian), Fee Bulan
//     Sebelumnya (kolom 190), Subsidi (kolom 165), Total, Minus (192),
//     Hold/Tahan (193), Potongan Lainnya (194), Potongan Ongkir (195),
//     Total di Transfer (=Total-Minus... ), Status, ke Deposit,
//     ke Rekening, Sisa.
//   - Tabel RINCIAN TRANSAKSI (K-N, Table13): MODUL | LEMBAR |
//     FEE/LEMBAR | TOTAL FEE dengan tiga pola sumber:
//       (a) LEMBAR+TOTAL tersimpan (PLN x3, JASTEL): fee = total/lembar.
//       (b) TARIF+LEMBAR tersimpan (mayoritas): total = lembar x tarif.
//       (c) Agregat khusus (PDAM/PBB/POS/SICEPAT): lembar = jumlah
//         beberapa kolom, total tersimpan di kolom Q.

/** Kolom identitas Loket BSB (0-based, absolut). */
export const LOKET_IDENTITY_COLS = {
  ppid: 1,
  nama: 2,
  bank: 3,
  noRekening: 4,
  namaPemilik: 5,
  rekomender: 6,
  elektrikArea: 7,
} as const;

/** Kolom ringkasan keuangan Loket BSB (0-based, absolut). */
export const LOKET_SUMMARY_COLS = {
  feeBulanIni: 189,
  feeBulanSebelumnya: 190,
  jumlahFee: 191,
  minus: 192,
  hold: 193,
  potonganLainnya: 194,
  potonganOngkir: 195,
  feeSiapTransfer: 196,
  keterangan: 197,
  totalTransfer: 206,
  sisaFee: 207,
  tanggalTransfer: 208,
  subsidi: 165,
} as const;

/** Kolom "Fee Ke Deposit" (I18 = I10+I12+I14+I16 pada sheet `Cari`). */
export const LOKET_DEPOSIT_COLS = [198, 200, 202, 204] as const;
/** Kolom "Transfer ke Rekening" (I19 = I11+I13+I15+I17 pada sheet `Cari`). */
export const LOKET_TRANSFER_COLS = [199, 201, 203, 205] as const;

/**
 * Baris matriks yang memuat serial tanggal transfer (Excel row 4 =
 * referensi I5:I8 sheet `Cari`: 'Loket BSB'!GQ4/GS4/GU4/GW4).
 * BUKAN baris header identitas (indeks 2) — baris ini memuat total
 * agregat + serial tanggal seperti 46268 (= 3-Sep-2026).
 */
export const LOKET_DATE_HEADER_ROW = 3;

/** Serial tanggal header (I5:I8) per grup transfer, sepadan GQ/GS/GU/GW. */
const TRANSFER_DATE_SERIAL_COLS = [198, 200, 202, 204] as const;
/** Pasangan kolom (deposit, transfer) per grup, sepadan H5:H8. */
const TRANSFER_GROUP_COLS = [
  [198, 199],
  [200, 201],
  [202, 203],
  [204, 205],
] as const;

const BULAN_EN_SINGKAT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Serial tanggal Excel (epoch 1899-12-30, zona UTC agar anti-geser hari)
 * menjadi "3-Sep-2026" — format yang dipakai baris Tanggal Transfer.
 * Menerima number maupun string numerik ("46268"); null untuk kosong /
 * tak-valid / di luar rentang wajar (1982–2064). Teks non-numerik
 * ("Transfer ...", "Belum di kirim") BUKAN serial → null (catatan teks
 * diteruskan terpisah sebagai fallback, bukan lewat sini).
 */
export function excelSerialToTanggal(value: unknown): string | null {
  let serial: number;
  if (typeof value === "number") {
    serial = value;
  } else if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    serial = n;
  } else {
    return null;
  }
  if (!Number.isFinite(serial)) return null;
  const rounded = Math.round(serial);
  if (rounded < 30000 || rounded > 60000) return null;
  const d = new Date(Math.round((rounded - 25569) * 86400 * 1000));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()}-${BULAN_EN_SINGKAT[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/**
 * Tanggal Transfer meniru E27 sheet `Cari`:
 * `IF(H5>0,I5,IF(H6>0,I6,IF(H7>0,I7,IF(H8>0,I8,"Belum di kirim"))))` —
 * grup transfer pertama yang jumlahnya > 0 menentukan serial tanggalnya.
 * Bila serial grup rusak/absen, jatuh ke catatan kolom 208
 * ("Transfer 05 Agustus 2026"); bila tidak ada aktivitas transfer sama
 * sekali, "Belum di kirim" persis seperti Excel (bukan string kosong,
 * agar baris slip selalu terisi dan tidak disangka mapping gagal).
 */
export function resolveTanggalTransfer(
  headerCells: unknown[],
  cells: unknown[],
  catatanCol208: string
): string {
  const at = (idx: number): number => parseAmount((cells ?? [])[idx]);
  for (let g = 0; g < TRANSFER_GROUP_COLS.length; g += 1) {
    const pair = TRANSFER_GROUP_COLS[g] as unknown as [number, number];
    if (at(pair[0]) + at(pair[1]) > 0) {
      const tanggal = excelSerialToTanggal(
        (headerCells ?? [])[TRANSFER_DATE_SERIAL_COLS[g] as unknown as number]
      );
      return tanggal ?? (catatanCol208 !== "" ? catatanCol208 : "Belum di kirim");
    }
  }
  return catatanCol208 !== "" ? catatanCol208 : "Belum di kirim";
}

/** Satu baris modul pada tabel RINCIAN sheet `Cari`. */
export interface ModulColMap {
  /** Nama modul persis seperti kolom K sheet `Cari`. */
  modul: string;
  /** Kolom tarif (blok A, VLOOKUP offset O) — pola (b). Null = pola (a)/(c). */
  tarifCol: number | null;
  /** Kolom LEMBAR (blok B, VLOOKUP offset P) — pola (a)/(b). */
  lembarCol: number | null;
  /** Jumlah beberapa kolom LEMBAR — pola (c) agregat (PDAM, dsb.). */
  lembarSumCols?: number[];
  /** Kolom TOTAL tersimpan (blok C, VLOOKUP offset Q) — pola (a)/(c). */
  totalCol: number | null;
}

/**
 * Peta 79 modul sheet `Cari` ke kolom absolut Loket BSB.
 * Offset VLOOKUP = indeks absolut (kolom B = indeks 1, offset 1).
 * Duplikat nama Excel ("XL" x2, "WOM FINANCE" x2) didisambiguasi
 * dengan akhiran " (2)" agar kunci unik (ppid, periode, modul) terjaga.
 */
export const CARI_MODULE_MAP: ModulColMap[] = [
  { modul: "PLN Postpaid", tarifCol: null, lembarCol: 82, totalCol: 161 },
  { modul: "PLN Prepaid", tarifCol: null, lembarCol: 83, totalCol: 162 },
  { modul: "PLN Nontaglis", tarifCol: null, lembarCol: 84, totalCol: 163 },
  { modul: "JASTEL", tarifCol: null, lembarCol: 86, totalCol: 166 },
  { modul: "INDOVISION", tarifCol: 15, lembarCol: 88, totalCol: null },
  { modul: "BPJS TK", tarifCol: 16, lembarCol: 89, totalCol: null },
  { modul: "PLN CASHBACK", tarifCol: 17, lembarCol: 90, totalCol: null },
  { modul: "MF-WOM", tarifCol: 18, lembarCol: 91, totalCol: null },
  { modul: "MF- MCF/MAF", tarifCol: 19, lembarCol: 92, totalCol: null },
  { modul: "ICONNET", tarifCol: 20, lembarCol: 93, totalCol: null },
  { modul: "FIF", tarifCol: 21, lembarCol: 94, totalCol: null },
  { modul: "Bayar KAI", tarifCol: 22, lembarCol: 95, totalCol: null },
  { modul: "Beli KAI", tarifCol: 23, lembarCol: 96, totalCol: null },
  { modul: "HALLO", tarifCol: 24, lembarCol: 97, totalCol: null },
  { modul: "XL", tarifCol: 25, lembarCol: 98, totalCol: null },
  { modul: "BPJS Kesehatan", tarifCol: 26, lembarCol: 99, totalCol: null },
  { modul: "TRF UANG", tarifCol: 27, lembarCol: 100, totalCol: null },
  { modul: "e-SAMSAT JABAR", tarifCol: 28, lembarCol: 101, totalCol: null },
  { modul: "PERTAGAS", tarifCol: 29, lembarCol: 102, totalCol: null },
  { modul: "E-SAMSAT JATIM", tarifCol: 30, lembarCol: 103, totalCol: null },
  { modul: "SIMOLNAS", tarifCol: 31, lembarCol: 104, totalCol: null },
  { modul: "MEGA CENTRAL FINANCE", tarifCol: 32, lembarCol: 105, totalCol: null },
  { modul: "MEGA FINANCE", tarifCol: 33, lembarCol: 106, totalCol: null },
  { modul: "WOM FINANCE", tarifCol: 34, lembarCol: 107, totalCol: null },
  { modul: "BUSSAN AUTO FINANCE", tarifCol: 35, lembarCol: 108, totalCol: null },
  { modul: "MEGA AUTO FINANCE", tarifCol: 36, lembarCol: 109, totalCol: null },
  { modul: "HOME CREDIT INDONESIA", tarifCol: 37, lembarCol: 110, totalCol: null },
  { modul: "WOKA FINANCE", tarifCol: 38, lembarCol: 111, totalCol: null },
  { modul: "SMART FINANCE", tarifCol: 39, lembarCol: 112, totalCol: null },
  { modul: "RADANA FINANCE", tarifCol: 40, lembarCol: 113, totalCol: null },
  { modul: "THREE", tarifCol: 41, lembarCol: 114, totalCol: null },
  { modul: "SMARTFREN", tarifCol: 42, lembarCol: 115, totalCol: null },
  { modul: "INDOSAT", tarifCol: 43, lembarCol: 116, totalCol: null },
  { modul: "FREN", tarifCol: 44, lembarCol: 117, totalCol: null },
  { modul: "XL (2)", tarifCol: 45, lembarCol: 118, totalCol: null },
  { modul: "e-SAMSAT JATENG", tarifCol: 46, lembarCol: 119, totalCol: null },
  { modul: "PGN", tarifCol: 47, lembarCol: 120, totalCol: null },
  { modul: "ADIRA", tarifCol: 48, lembarCol: 125, totalCol: null },
  { modul: "KVISION", tarifCol: 49, lembarCol: 126, totalCol: null },
  { modul: "BS BIMA FINANCE", tarifCol: 50, lembarCol: 127, totalCol: null },
  { modul: "FIRST MEDIA", tarifCol: 51, lembarCol: 128, totalCol: null },
  { modul: "CBN", tarifCol: 52, lembarCol: 129, totalCol: null },
  { modul: "XL HOME FIBER", tarifCol: 53, lembarCol: 130, totalCol: null },
  { modul: "OXYGEN", tarifCol: 54, lembarCol: 131, totalCol: null },
  { modul: "MY REPUBLIC RETAIL", tarifCol: 55, lembarCol: 132, totalCol: null },
  { modul: "MEGAVISION", tarifCol: 56, lembarCol: 133, totalCol: null },
  { modul: "TOPAS PASCABAYAR", tarifCol: 57, lembarCol: 134, totalCol: null },
  { modul: "TRANSVISION", tarifCol: 58, lembarCol: 135, totalCol: null },
  { modul: "MANDALA FINANCE", tarifCol: 59, lembarCol: 136, totalCol: null },
  { modul: "NSC FINANCE", tarifCol: 60, lembarCol: 137, totalCol: null },
  { modul: "ADIRA FINANCE", tarifCol: 61, lembarCol: 138, totalCol: null },
  { modul: "WOM FINANCE (2)", tarifCol: 62, lembarCol: 139, totalCol: null },
  { modul: "PERTAGAS NIAGA PREPAID", tarifCol: 63, lembarCol: 140, totalCol: null },
  { modul: "BUKALAPAK", tarifCol: 64, lembarCol: 141, totalCol: null },
  { modul: "TOKOPEDIA", tarifCol: 65, lembarCol: 142, totalCol: null },
  { modul: "BLIBLI.COM", tarifCol: 66, lembarCol: 143, totalCol: null },
  { modul: "MNC SHOP", tarifCol: 67, lembarCol: 144, totalCol: null },
  { modul: "ITC FINANCE", tarifCol: 68, lembarCol: 145, totalCol: null },
  { modul: "BFI FINANCE", tarifCol: 69, lembarCol: 146, totalCol: null },
  { modul: "OTO FINANCE", tarifCol: 70, lembarCol: 147, totalCol: null },
  { modul: "MANDIRI UTAMA FINANCE", tarifCol: 71, lembarCol: 148, totalCol: null },
  { modul: "ARTHA PRIMA FINANCE", tarifCol: 72, lembarCol: 149, totalCol: null },
  { modul: "ARTHA ASIA FINANCE", tarifCol: 73, lembarCol: 150, totalCol: null },
  { modul: "SUZUKI FINANCE", tarifCol: 74, lembarCol: 151, totalCol: null },
  { modul: "SMS FINANCE", tarifCol: 75, lembarCol: 152, totalCol: null },
  { modul: "BCA MULTIFINANCE", tarifCol: 76, lembarCol: 153, totalCol: null },
  { modul: "AEON FINANCE", tarifCol: 77, lembarCol: 154, totalCol: null },
  { modul: "DENDA BPJS KESEHATAN", tarifCol: 78, lembarCol: 155, totalCol: null },
  { modul: "TIKET PELNI", tarifCol: 79, lembarCol: 156, totalCol: null },
  { modul: "VA TRANSFER", tarifCol: 80, lembarCol: 157, totalCol: null },
  { modul: "PDAM", tarifCol: null, lembarCol: null, lembarSumCols: [121, 122, 123], totalCol: 180 },
  { modul: "PBB", tarifCol: null, lembarCol: null, lembarSumCols: [124], totalCol: 181 },
  { modul: "FEE LOKET POS", tarifCol: null, lembarCol: null, lembarSumCols: [158], totalCol: 182 },
  { modul: "PPH 23 POS", tarifCol: null, lembarCol: null, lembarSumCols: [158], totalCol: 183 },
  { modul: "FEE LOKET POS NETT", tarifCol: null, lembarCol: null, lembarSumCols: [158], totalCol: 184 },
  { modul: "FEE LOKET SICEPAT", tarifCol: null, lembarCol: null, lembarSumCols: [159], totalCol: 185 },
  { modul: "PPH 23 SICEPAT", tarifCol: null, lembarCol: null, lembarSumCols: [159], totalCol: 186 },
  { modul: "FEE LOKET SICEPAT NETT", tarifCol: null, lembarCol: null, lembarSumCols: [159], totalCol: 187 },
  { modul: "MINI ATM BERSAMA", tarifCol: 81, lembarCol: 160, totalCol: null },
];

/** Satu baris rincian modul: LEMBAR | FEE/LEMBAR | TOTAL (ala tabel Cari). */
export interface TransactionBreakdown {
  modul: string;
  lembar: number;
  feePerLembar: number;
  total: number;
}

/** Status pembayaran turunan Excel (kolom Total Transfer + Fee Siap Transfer). */
export type LoketPaymentStatus =
  | "TERBAYAR"
  | "PENDING"
  | "BELUM_TRANSFER"
  | "KE_DEPOSIT"
  | "TRANSFER_REKENING"
  | "TOPUP_SISA";

/**
 * Status kaya mengikuti logika J20 sheet `Cari`:
 * J18=(deposit>0)?1:0, J19=(transfer>0)?2:0, J20=J18+J19 —
 * 0 "Belum di Transfer", 1 "Fee Ke Deposit", 2 "Transfer ke Rekening",
 * 3 "Topup Minus Sisa Transfer Fee" (keduanya).
 */
export function deriveRichStatus(
  feeKeDeposit: number,
  feeTransferRekening: number
): LoketPaymentStatus {
  if (feeKeDeposit > 0 && feeTransferRekening > 0) return "TOPUP_SISA";
  if (feeTransferRekening > 0) return "TRANSFER_REKENING";
  if (feeKeDeposit > 0) return "KE_DEPOSIT";
  return "BELUM_TRANSFER";
}

/** True bila status berarti dana sudah keluar (terbayar / deposit / transfer). */
export function isPaidStatus(status: unknown): boolean {
  return (
    status === "TERBAYAR" ||
    status === "KE_DEPOSIT" ||
    status === "TRANSFER_REKENING" ||
    status === "TOPUP_SISA"
  );
}

/**
 * Normalisasi input status longgar (payload/API/DB) ke union resmi.
 * Nilai tak dikenal jatuh ke BELUM_TRANSFER agar slip jujur
 * ("Belum di Transfer") alih-alih diam-diam PENDING.
 */
export function normalizeLoketStatusInput(value: unknown): LoketPaymentStatus {
  const v = String(value ?? "").trim().toUpperCase();
  if (
    v === "TERBAYAR" ||
    v === "PENDING" ||
    v === "BELUM_TRANSFER" ||
    v === "KE_DEPOSIT" ||
    v === "TRANSFER_REKENING" ||
    v === "TOPUP_SISA"
  ) {
    return v;
  }
  return "BELUM_TRANSFER";
}

/**
 * Label Status Fee persis E21 sheet `Cari`. Nilai legacy TERBAYAR/PENDING
 * (data lama) dipetakan ke "Terbayar"/"Pending".
 */
export function statusLabelCari(status: unknown): string {
  switch (String(status ?? "").trim().toUpperCase()) {
    case "KE_DEPOSIT":
      return "Fee Ke Deposit";
    case "TRANSFER_REKENING":
      return "Transfer ke Rekening";
    case "TOPUP_SISA":
      return "Topup Minus Sisa Transfer Fee";
    case "BELUM_TRANSFER":
      return "Belum di Transfer";
    case "TERBAYAR":
      return "Terbayar";
    default:
      return "Pending";
  }
}

/**
 * Profil loket lengkap meniru Slip sheet `Cari` (C6:E24) + tabel rincian.
 * Disimpan ke `loket_profiles` (identitas + ringkasan) dan
 * `loket_transaction_details` (details, sparse: hanya modul beraktivitas).
 */
export interface LoketProfileFull {
  ppid: string;
  namaLoket: string;
  bank: string;
  noRekening: string;
  namaPemilik: string;
  rekomender: string;
  elektrikArea: string;
  periode: string;
  feeBulanIni: number;
  feeBulanSebelumnya: number;
  /** E13 sheet `Cari` (kolom 165 SUBSIDI PLN Antar Loket). */
  subsidiAntarLoket: number;
  /** E14 = Bulan Ini + Bulan Sebelumnya + Subsidi. */
  totalFee: number;
  minus: number;
  hold: number;
  potonganLainnya: number;
  /** Kolom 195 (sebelumnya digabung ke potonganLainnya). */
  potonganOngkir: number;
  /** E19 = Total Fee − Potongan Lainnya − Potongan Ongkir. */
  totalFeeTransfer: number;
  /** SUM kolom 198,200,202,204 (I18 sheet `Cari`). */
  feeKeDeposit: number;
  /** SUM kolom 199,201,203,205 (I19 sheet `Cari`). */
  feeTransferRekening: number;
  /** E24 = Total Fee di Transfer − Deposit − Transfer ke Rek. */
  sisaFee: number;
  /** Kolom 197 (KET). */
  keterangan: string;
  /** Kolom 208 (Ket Trf, mis. "Transfer 05 Agustus 2026"). */
  tanggalTransfer: string;
  feeSiapTransfer: number;
  statusPembayaran: LoketPaymentStatus;
  /** Rincian modul beraktivitas (lembar/total/fee ada yang non-nol). */
  details: TransactionBreakdown[];
}

/**
 * Status turunan: TERBAYAR bila Total Transfer (kolom 206) > 0 —
 * diverifikasi terhadap file master (loket aktif "Transfer 05 Agustus
 * 2026" vs loket hold dengan Total Transfer 0). PENDING bila tidak.
 */
export function deriveLoketStatus(totalTransfer: number): LoketPaymentStatus {
  return totalTransfer > 0 ? "TERBAYAR" : "PENDING";
}

/**
 * Hitung satu baris rincian modul dari sel baris Loket BSB.
 * Meniru tiga pola formula sheet `Cari`:
 *  (a) total tersimpan + lembar tersimpan -> fee = round(total/lembar).
 *  (b) tarif + lembar tersimpan -> total = lembar * tarif.
 *  (c) lembar = jumlah beberapa kolom + total tersimpan -> fee turunan.
 * Null bila modul tanpa aktivitas (`lembar === 0 && total === 0`):
 * tarif skema yang tersimpan per loket (pola (b) dengan LEMBAR 0) BUKAN
 * aktivitas — dibuang agar 10.000 loket tidak menjadi ±700rb baris
 * tarif-nol di `loket_transaction_details`. UI menandai "modul tanpa
 * transaksi disembunyikan" persis untuk kasus ini.
 */
export function buildModuleBreakdown(
  cells: unknown[],
  map: ModulColMap
): TransactionBreakdown | null {
  const at = (idx: number): number => parseAmount((cells ?? [])[idx]);
  let lembar = 0;
  if (map.lembarCol != null) {
    lembar = at(map.lembarCol);
  } else if (map.lembarSumCols) {
    lembar = map.lembarSumCols.reduce((s, idx) => s + at(idx), 0);
  }
  let feePerLembar = 0;
  let total = 0;
  if (map.totalCol != null && map.tarifCol == null && map.lembarCol != null) {
    // Pola (a): PLN x3 + JASTEL — TOTAL tersimpan, fee turunan.
    total = at(map.totalCol);
    feePerLembar = lembar !== 0 ? Math.round(total / lembar) : 0;
  } else if (map.tarifCol != null && map.lembarCol != null) {
    // Pola (b): mayoritas — TOTAL = LEMBAR x TARIF.
    feePerLembar = at(map.tarifCol);
    total = lembar * feePerLembar;
  } else if (map.totalCol != null) {
    // Pola (c): PDAM/PBB/POS/SICEPAT — TOTAL tersimpan, fee turunan.
    total = at(map.totalCol);
    feePerLembar = lembar !== 0 ? Math.round(total / lembar) : 0;
  }
  if (lembar === 0 && total === 0) return null;
  return { modul: map.modul, lembar, feePerLembar, total };
}

export interface LoketBsbFullParse {
  /** Profil lengkap per loket (untuk loket_profiles + details). */
  profiles: LoketProfileFull[];
  /** Baris ringkas untuk tabel monitoring + tabel legacy fee_loket. */
  rows: FeeRekapRow[];
  skipped: number;
}

/**
 * Parser ABSOLUT PENUH sheet `Loket BSB` — meniru Excel Master:
 * identitas (1-7) + ringkasan keuangan (189-196) + rincian 79 modul
 * per pola sheet `Cari`. Return null bila sanity header gagal
 * (pemanggil fallback ke parser dinamis). Dropna PPID; ekor kosong
 * dipangkas dulu agar `skipped` akurat.
 */
export function parseLoketBsbFull(
  matrix: unknown[][],
  periodeFallback: string,
  fileLabel = "import"
): LoketBsbFullParse | null {
  const clean = trimTrailingEmptyRows(Array.isArray(matrix) ? matrix : []);
  if (clean.length <= ABSOLUTE_DATA_START_ROW) return null;
  const norm = (clean[ABSOLUTE_HEADER_ROW] ?? []).map(normalizeHeaderCell);
  if (scoreFeeColumnForBsb(norm[ABSOLUTE_PPID_COL] ?? "", "ppid") < 10) return null;
  if (scoreFeeColumnForBsb(norm[ABSOLUTE_NAMA_COL] ?? "", "nama") < 10) return null;

  const profiles: LoketProfileFull[] = [];
  const rows: FeeRekapRow[] = [];
  let skipped = 0;
  for (let r = ABSOLUTE_DATA_START_ROW; r < clean.length; r += 1) {
    const cells = clean[r] ?? [];
    const ppid = normalizePpid(cells[LOKET_IDENTITY_COLS.ppid]);
    const namaRaw = cellTextLike(cells[LOKET_IDENTITY_COLS.nama]);
    if (ppid === "" && namaRaw === "") {
      skipped += 1;
      continue;
    }
    if (ppid === "") {
      skipped += 1;
      continue;
    }
    const namaLoket = namaRaw !== "" ? namaRaw : ppid;
    const periode = periodeFallback;
    const at = (idx: number): number => parseAmount(cells[idx]);
    const feeBulanIni = at(LOKET_SUMMARY_COLS.feeBulanIni);
    const feeBulanSebelumnya = at(LOKET_SUMMARY_COLS.feeBulanSebelumnya);
    const jumlahFee = at(LOKET_SUMMARY_COLS.jumlahFee);
    const subsidiAntarLoket = at(LOKET_SUMMARY_COLS.subsidi);
    // E14 sheet `Cari`: Total Fee = Bulan Ini + Bulan Sebelumnya + Subsidi.
    const totalFee = feeBulanIni + feeBulanSebelumnya + subsidiAntarLoket;
    const minus = at(LOKET_SUMMARY_COLS.minus);
    const hold = at(LOKET_SUMMARY_COLS.hold);
    // E17/E18: potongan ditampilkan terpisah seperti Excel (dulu 194+195
    // digabung sehingga "Potongan Ongkir" selalu 0 di slip).
    const potonganLainnya = at(LOKET_SUMMARY_COLS.potonganLainnya);
    const potonganOngkir = at(LOKET_SUMMARY_COLS.potonganOngkir);
    // E19: Total Fee di Transfer = Total − Potongan Lainnya − Ongkir.
    const totalFeeTransfer = totalFee - potonganLainnya - potonganOngkir;
    const feeSiapTransfer = at(LOKET_SUMMARY_COLS.feeSiapTransfer);
    const totalTransfer = at(LOKET_SUMMARY_COLS.totalTransfer);
    // E22/E23: agregat I18/I19 (deposit vs transfer ke rekening).
    const feeKeDeposit = LOKET_DEPOSIT_COLS.reduce((s, idx) => s + at(idx), 0);
    const feeTransferRekening = LOKET_TRANSFER_COLS.reduce((s, idx) => s + at(idx), 0);
    // E24: Sisa Fee = Total di Transfer − Deposit − Transfer ke Rek.
    const sisaFee = totalFeeTransfer - feeKeDeposit - feeTransferRekening;
    const statusPembayaran = deriveRichStatus(feeKeDeposit, feeTransferRekening);

    const details: TransactionBreakdown[] = [];
    for (const map of CARI_MODULE_MAP) {
      const b = buildModuleBreakdown(cells, map);
      if (b) details.push(b);
    }
    const profil: LoketProfileFull = {
      ppid,
      namaLoket,
      bank: cellTextLike(cells[LOKET_IDENTITY_COLS.bank]),
      noRekening: cellTextLike(cells[LOKET_IDENTITY_COLS.noRekening]),
      namaPemilik: cellTextLike(cells[LOKET_IDENTITY_COLS.namaPemilik]),
      rekomender: cellTextLike(cells[LOKET_IDENTITY_COLS.rekomender]),
      elektrikArea: cellTextLike(cells[LOKET_IDENTITY_COLS.elektrikArea]),
      periode,
      feeBulanIni,
      feeBulanSebelumnya,
      subsidiAntarLoket,
      totalFee,
      minus,
      hold,
      potonganLainnya,
      potonganOngkir,
      totalFeeTransfer,
      feeKeDeposit,
      feeTransferRekening,
      sisaFee,
      keterangan: cellTextLike(cells[LOKET_SUMMARY_COLS.keterangan]),
      // E27: serial header grup transfer pertama yang aktif; fallback
      // catatan kolom 208; "Belum di kirim" bila belum ada transfer.
      tanggalTransfer: resolveTanggalTransfer(
        clean[LOKET_DATE_HEADER_ROW] ?? [],
        cells,
        cellTextLike(cells[LOKET_SUMMARY_COLS.tanggalTransfer])
      ),
      feeSiapTransfer,
      statusPembayaran,
      details,
    };
    profiles.push(profil);

    // Baris ringkas monitoring: total = JUMLAH FEE (191) fallback
    // BULAN INI (189) — prioritas sama seperti ABSOLUTE_FEE_COLS.
    // Status tabel tetap biner: terbayar bila dana terbukti keluar
    // (Total Transfer / deposit / transfer ke rekening ada yang > 0).
    const paid =
      totalTransfer > 0 || feeKeDeposit > 0 || feeTransferRekening > 0;
    const rawTotal = jumlahFee !== 0 ? jumlahFee : feeBulanIni;
    const clamped = clampFeeTotal(rawTotal);
    const rincian: FeeRincian[] = [
      { label: "Fee Bulan Ini", nilai: feeBulanIni },
      { label: "Fee Bulan Sebelumnya", nilai: feeBulanSebelumnya },
    ];
    if (subsidiAntarLoket !== 0) rincian.push({ label: "Subsidi Antar Loket", nilai: subsidiAntarLoket });
    if (minus !== 0) rincian.push({ label: "Minus", nilai: minus });
    if (hold !== 0) rincian.push({ label: "Hold", nilai: hold });
    if (potonganLainnya !== 0) rincian.push({ label: "Potongan Lainnya", nilai: potonganLainnya });
    if (potonganOngkir !== 0) rincian.push({ label: "Potongan Ongkir", nilai: potonganOngkir });
    rincian.push({ label: "Fee Siap Transfer", nilai: feeSiapTransfer });
    if (clamped.clamped) {
      rincian.push({ label: `OVER_DEDUCTED_CLAMPED (nilai asli ${clamped.raw})`, nilai: 0 });
    }
    rows.push({
      id: `${fileLabel}-${r}`,
      ppid,
      namaLoket,
      periode,
      totalFee: clamped.total,
      status: paid ? "TERBAYAR" : "PENDING",
      rincian,
      updatedAt: new Date().toISOString(),
      ...(clamped.clamped ? { auditFlag: "OVER_DEDUCTED_CLAMPED" as const } : {}),
      profil,
    });
  }
  return { profiles, rows, skipped };
}

/** Skor kolom minimal untuk sanity header absolut (duplikat ringan agar tidak mengubah skor dinamis). */
function scoreFeeColumnForBsb(norm: string, role: "ppid" | "nama"): number {
  if (norm === "") return -1;
  const tokens = new Set(norm.split(" "));
  if (role === "ppid") {
    if (tokens.has("ppid")) return 100;
    if (norm === "kode agen" || norm === "kode loket") return 10;
    return -1;
  }
  if (norm === "nama loket" || norm === "nama agen" || norm === "nama pos") return 100;
  if (
    tokens.has("nama") &&
    (tokens.has("loket") || tokens.has("agen") || tokens.has("pos") || tokens.has("outlet") || tokens.has("mitra"))
  ) {
    return 90;
  }
  if (
    (tokens.has("loket") || tokens.has("agen") || tokens.has("pos") || tokens.has("outlet")) &&
    !tokens.has("kode")
  ) {
    return 10;
  }
  return -1;
}

/** Teks sel tampilan (invisible chars -> spasi, trim). */
function cellTextLike(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u00a0\uFEFF\u200B-\u200D\u2060\u180E]/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Mapping DB relasional baru (loket_profiles / loket_transaction_details)
// ---------------------------------------------------------------------------

export interface LoketProfileDbRow {
  ppid: string;
  nama_loket: string;
  bank: string;
  no_rekening: string;
  nama_pemilik: string;
  rekomender: string;
  elektrik_area: string;
  periode: string;
  fee_bulan_ini: number;
  fee_bulan_sebelumnya: number;
  subsidi_antar_loket: number;
  total_fee: number;
  minus: number;
  hold: number;
  potongan_lainnya: number;
  potongan_ongkir: number;
  total_fee_transfer: number;
  fee_ke_deposit: number;
  fee_transfer_rekening: number;
  sisa_fee: number;
  keterangan: string;
  tanggal_transfer: string;
  fee_siap_transfer: number;
  status_pembayaran: LoketPaymentStatus;
  updated_at: string;
}

export interface LoketDetailDbRow {
  ppid: string;
  periode: string;
  modul_nama: string;
  jumlah_lembar: number;
  fee_per_lembar: number;
  total_fee: number;
}

/** Maksimal modul per loket per request (pagar anti-payload raksasa). */
export const LOKET_DETAILS_MAX_PER_LOKET = 200;

/**
 * Petakan profil parse menjadi baris DB `loket_profiles`.
 * Null bila PPID kosong / periode tak-valid (baris dilewati + dihitung).
 * Status kaya (J20 Excel) diteruskan apa adanya; nilai tak dikenal
 * jatuh ke BELUM_TRANSFER (bukan PENDING) agar slip jujur.
 */
export function toLoketProfileDbRow(
  profil: LoketProfileFull,
  fallbackPeriode: string
): LoketProfileDbRow | null {
  if (typeof profil !== "object" || profil === null) return null;
  const ppid = normalizePpid(profil.ppid).slice(0, 100);
  if (ppid === "") return null;
  const periode = FEE_PERIODE_REGEX.test(fallbackPeriode) ? fallbackPeriode : "";
  if (periode === "") return null;
  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const RICH: LoketPaymentStatus[] = [
    "TERBAYAR",
    "PENDING",
    "BELUM_TRANSFER",
    "KE_DEPOSIT",
    "TRANSFER_REKENING",
    "TOPUP_SISA",
  ];
  return {
    ppid,
    nama_loket: str(profil.namaLoket, 200) || ppid,
    bank: str(profil.bank, 100),
    no_rekening: str(profil.noRekening, 100),
    nama_pemilik: str(profil.namaPemilik, 200),
    rekomender: str(profil.rekomender, 200),
    elektrik_area: str(profil.elektrikArea, 100),
    periode,
    fee_bulan_ini: parseAmount(profil.feeBulanIni),
    fee_bulan_sebelumnya: parseAmount(profil.feeBulanSebelumnya),
    subsidi_antar_loket: parseAmount(profil.subsidiAntarLoket),
    total_fee: parseAmount(profil.totalFee),
    minus: parseAmount(profil.minus),
    hold: parseAmount(profil.hold),
    potongan_lainnya: parseAmount(profil.potonganLainnya),
    potongan_ongkir: parseAmount(profil.potonganOngkir),
    total_fee_transfer: parseAmount(profil.totalFeeTransfer),
    fee_ke_deposit: parseAmount(profil.feeKeDeposit),
    fee_transfer_rekening: parseAmount(profil.feeTransferRekening),
    sisa_fee: parseAmount(profil.sisaFee),
    keterangan: str(profil.keterangan, 200),
    tanggal_transfer: str(profil.tanggalTransfer, 100),
    fee_siap_transfer: parseAmount(profil.feeSiapTransfer),
    status_pembayaran: RICH.includes(profil.statusPembayaran)
      ? profil.statusPembayaran
      : "BELUM_TRANSFER",
    updated_at: new Date().toISOString(),
  };
}

/**
 * Petakan details profil menjadi baris DB `loket_transaction_details`
 * (sparse — modul nol sudah dibuang saat parse; di sini dibatasi dan
 * dikoersi aman). Mengembalikan array (bisa kosong).
 */
export function toLoketDetailDbRows(
  profil: LoketProfileFull,
  fallbackPeriode: string
): LoketDetailDbRow[] {
  if (typeof profil !== "object" || profil === null) return [];
  const ppid = normalizePpid(profil.ppid).slice(0, 100);
  if (ppid === "") return [];
  const periode = FEE_PERIODE_REGEX.test(fallbackPeriode) ? fallbackPeriode : "";
  if (periode === "") return [];
  const seen = new Set<string>();
  const out: LoketDetailDbRow[] = [];
  const list = Array.isArray(profil.details) ? profil.details : [];
  for (const item of list.slice(0, LOKET_DETAILS_MAX_PER_LOKET)) {
    const rec: Record<string, unknown> =
      typeof item === "object" && item !== null
        ? (item as unknown as Record<string, unknown>)
        : {};
    const modul = (typeof rec.modul === "string" ? rec.modul.trim() : "").slice(0, 120);
    if (modul === "" || seen.has(modul)) continue;
    seen.add(modul);
    out.push({
      ppid,
      periode,
      modul_nama: modul,
      jumlah_lembar: parseAmount(rec.lembar),
      fee_per_lembar: parseAmount(rec.feePerLembar),
      total_fee: parseAmount(rec.total),
    });
  }
  return out;
}

/**
 * Normalisasi `profil` + `details` mentah dari payload import menjadi
 * baris DB (dipakai API import server-side; toleran bentuk longgar).
 * Mengembalikan null bila profil tak-valid.
 */
export function normalizeImportProfil(
  item: FeeImportPayloadItem,
  fallbackPeriode: string
): { profil: LoketProfileDbRow; details: LoketDetailDbRow[] } | null {
  if (typeof item !== "object" || item === null) return null;
  const rawProfil = (item as { profil?: unknown }).profil;
  if (typeof rawProfil !== "object" || rawProfil === null) return null;
  const p = rawProfil as Record<string, unknown>;
  const detailsRaw = (item as { details?: unknown }).details;
  const candidate: LoketProfileFull = {
    ppid: String(p.ppid ?? (item.ppid as string) ?? ""),
    namaLoket: String(p.namaLoket ?? p.nama_loket ?? item.nama_loket ?? item.namaLoket ?? ""),
    bank: String(p.bank ?? ""),
    noRekening: String(p.noRekening ?? p.no_rekening ?? ""),
    namaPemilik: String(p.namaPemilik ?? p.nama_pemilik ?? ""),
    rekomender: String(p.rekomender ?? ""),
    elektrikArea: String(p.elektrikArea ?? p.elektrik_area ?? ""),
    periode: fallbackPeriode,
    feeBulanIni: parseAmount(p.feeBulanIni ?? p.fee_bulan_ini),
    feeBulanSebelumnya: parseAmount(p.feeBulanSebelumnya ?? p.fee_bulan_sebelumnya),
    subsidiAntarLoket: parseAmount(p.subsidiAntarLoket ?? p.subsidi_antar_loket),
    totalFee: parseAmount(
      p.totalFee ??
        p.total_fee ??
        (parseAmount(p.feeBulanIni ?? p.fee_bulan_ini) +
          parseAmount(p.feeBulanSebelumnya ?? p.fee_bulan_sebelumnya) +
          parseAmount(p.subsidiAntarLoket ?? p.subsidi_antar_loket))
    ),
    minus: parseAmount(p.minus),
    hold: parseAmount(p.hold),
    potonganLainnya: parseAmount(p.potonganLainnya ?? p.potongan_lainnya),
    potonganOngkir: parseAmount(p.potonganOngkir ?? p.potongan_ongkir),
    totalFeeTransfer: parseAmount(p.totalFeeTransfer ?? p.total_fee_transfer),
    feeKeDeposit: parseAmount(p.feeKeDeposit ?? p.fee_ke_deposit),
    feeTransferRekening: parseAmount(p.feeTransferRekening ?? p.fee_transfer_rekening),
    sisaFee: parseAmount(p.sisaFee ?? p.sisa_fee),
    keterangan: String(p.keterangan ?? ""),
    tanggalTransfer: String(p.tanggalTransfer ?? p.tanggal_transfer ?? ""),
    feeSiapTransfer: parseAmount(p.feeSiapTransfer ?? p.fee_siap_transfer),
    statusPembayaran: normalizeLoketStatusInput(
      p.statusPembayaran ?? p.status_pembayaran
    ),
    details: Array.isArray(detailsRaw)
      ? (detailsRaw as unknown[])
          .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
          .map((d) => ({
            modul: String(d.modul ?? d.modul_nama ?? ""),
            lembar: parseAmount(d.lembar ?? d.jumlah_lembar),
            feePerLembar: parseAmount(d.feePerLembar ?? d.fee_per_lembar),
            total: parseAmount(d.total ?? d.total_fee),
          }))
      : [],
  };
  const profil = toLoketProfileDbRow(candidate, fallbackPeriode);
  if (!profil) return null;
  return { profil, details: toLoketDetailDbRows(candidate, fallbackPeriode) };
}

// ---------------------------------------------------------------------------
// Lookup profil + rincian (meniru sheet `Cari`) — client API
// ---------------------------------------------------------------------------

export interface LoketLookupProfile {
  ppid: string;
  namaLoket: string;
  bank: string;
  noRekening: string;
  namaPemilik: string;
  rekomender: string;
  elektrikArea: string;
  periode: string;
  feeBulanIni: number;
  feeBulanSebelumnya: number;
  subsidiAntarLoket: number;
  totalFee: number;
  minus: number;
  hold: number;
  potonganLainnya: number;
  potonganOngkir: number;
  totalFeeTransfer: number;
  feeKeDeposit: number;
  feeTransferRekening: number;
  sisaFee: number;
  keterangan: string;
  tanggalTransfer: string;
  feeSiapTransfer: number;
  statusPembayaran: LoketPaymentStatus;
}

export interface LoketLookupResult {
  found: boolean;
  profile: LoketLookupProfile | null;
  /** Rincian modul (sparse dari DB; kosong bila loket tanpa aktivitas). */
  details: TransactionBreakdown[];
  /** True bila profil berasal dari tabel legacy fee_loket (tanpa rincian). */
  legacy: boolean;
}

/**
 * Lookup profil loket meniru sheet `Cari`: query dinormalisasi PPID
 * (abaikan spasi/kapital) lalu cocok PPID persis dulu, fallback substring
 * nama loket. Melempar pesan error server yang jelas.
 */
export async function fetchLoketLookup(
  query: string,
  periode = "SEMUA"
): Promise<LoketLookupResult> {
  const params = new URLSearchParams();
  params.set("q", query.trim());
  if (periode !== "" && periode !== "SEMUA") params.set("periode", periode);
  const res = await fetch(`/api/fee-rekap/lookup?${params.toString()}`);
  if (res.status === 404) {
    return { found: false, profile: null, details: [], legacy: false };
  }
  if (!res.ok) throw await readError(res, "Lookup loket gagal");
  const body = (await res.json()) as {
    found?: unknown;
    profile?: Record<string, unknown> | null;
    details?: unknown;
    legacy?: unknown;
  };
  if (!body || body.found !== true || typeof body.profile !== "object" || body.profile === null) {
    return { found: false, profile: null, details: [], legacy: false };
  }
  const pr = body.profile;
  const num = (v: unknown): number => parseAmount(v);
  const feeBulanIni = num(pr.fee_bulan_ini ?? pr.feeBulanIni);
  const feeBulanSebelumnya = num(
    pr.fee_bulan_sebelumnya ?? pr.feeBulanSebelumnya
  );
  const subsidiAntarLoket = num(pr.subsidi_antar_loket ?? pr.subsidiAntarLoket);
  // total_fee tersimpan diutamakan; fallback hitung E14 agar baris lama
  // (pra-migrasi extra) tidak tampil Rp 0.
  const totalFee =
    num(pr.total_fee ?? pr.totalFee) ||
    feeBulanIni + feeBulanSebelumnya + subsidiAntarLoket;
  const profile: LoketLookupProfile = {
    ppid: String(pr.ppid ?? ""),
    namaLoket: String(pr.nama_loket ?? pr.namaLoket ?? ""),
    bank: String(pr.bank ?? ""),
    noRekening: String(pr.no_rekening ?? pr.noRekening ?? ""),
    namaPemilik: String(pr.nama_pemilik ?? pr.namaPemilik ?? ""),
    rekomender: String(pr.rekomender ?? ""),
    elektrikArea: String(pr.elektrik_area ?? pr.elektrikArea ?? ""),
    periode: String(pr.periode ?? ""),
    feeBulanIni,
    feeBulanSebelumnya,
    subsidiAntarLoket,
    totalFee,
    minus: num(pr.minus),
    hold: num(pr.hold),
    potonganLainnya: num(pr.potongan_lainnya ?? pr.potonganLainnya),
    potonganOngkir: num(pr.potongan_ongkir ?? pr.potonganOngkir),
    totalFeeTransfer: num(pr.total_fee_transfer ?? pr.totalFeeTransfer),
    feeKeDeposit: num(pr.fee_ke_deposit ?? pr.feeKeDeposit),
    feeTransferRekening: num(
      pr.fee_transfer_rekening ?? pr.feeTransferRekening
    ),
    sisaFee: num(pr.sisa_fee ?? pr.sisaFee),
    keterangan: String(pr.keterangan ?? ""),
    tanggalTransfer: String(pr.tanggal_transfer ?? pr.tanggalTransfer ?? ""),
    feeSiapTransfer: num(pr.fee_siap_transfer ?? pr.feeSiapTransfer),
    statusPembayaran: normalizeLoketStatusInput(
      pr.status_pembayaran ?? pr.statusPembayaran
    ),
  };
  const details = Array.isArray(body.details)
    ? (body.details as unknown[])
        .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
        .map((d) => ({
          modul: String(d.modul_nama ?? d.modul ?? "").slice(0, 120),
          lembar: num(d.jumlah_lembar ?? d.lembar),
          feePerLembar: num(d.fee_per_lembar ?? d.feePerLembar),
          total: num(d.total_fee ?? d.total),
        }))
        .filter((d) => d.modul !== "")
    : [];
  return { found: true, profile, details, legacy: body.legacy === true };
}

/** Teks slip profil + rincian ala sheet `Cari` (salin WA / cetak). */
export function buildCariSlipText(  profile: LoketLookupProfile,
  details: TransactionBreakdown[]
): string {
  const head = [
    `PPID: ${profile.ppid === "" ? "-" : profile.ppid}`,
    `Nama Loket: ${profile.namaLoket === "" ? "-" : profile.namaLoket}`,
    `Nomor Rekening: ${profile.noRekening === "" ? "-" : profile.noRekening}`,
    `Rekening BANK: ${profile.bank === "" ? "-" : profile.bank}`,
    `Pemilik Rekening: ${profile.namaPemilik === "" ? "-" : profile.namaPemilik}`,
    `Periode: ${profile.periode === "" ? "-" : formatPeriode(profile.periode)}`,
    `Fee Bulan Ini: ${formatRupiah(profile.feeBulanIni)}`,
    `Fee Bulan Sebelumnya: ${formatRupiah(profile.feeBulanSebelumnya)}`,
    `Subsidi Antar Loket: ${formatRupiah(profile.subsidiAntarLoket)}`,
    `Total Fee: ${formatRupiah(profile.totalFee)}`,
    `Minus Loket: ${formatRupiah(profile.minus)}`,
    `Fee di Tahan: ${formatRupiah(profile.hold)}`,
    `Potongan Lainnya: ${formatRupiah(profile.potonganLainnya)}`,
    `Potongan Ongkir: ${formatRupiah(profile.potonganOngkir)}`,
    `Total Fee di Transfer: ${formatRupiah(profile.totalFeeTransfer)}`,
    `Status Fee: ${statusLabelCari(profile.statusPembayaran)}`,
    `Fee ke Deposit: ${formatRupiah(profile.feeKeDeposit)}`,
    `Fee di Transfer ke Rek: ${formatRupiah(profile.feeTransferRekening)}`,
    `Sisa Fee: ${formatRupiah(profile.sisaFee)}`,
    `Keterangan: ${profile.keterangan === "" ? "-" : profile.keterangan}`,
    `Tanggal Transfer: ${profile.tanggalTransfer === "" ? "-" : profile.tanggalTransfer}`,
    `Fee Siap Transfer: ${formatRupiah(profile.feeSiapTransfer)}`,
  ];
  if (details.length === 0) {
    return [...head, `Rincian: belum ada transaksi modul`].join("\n");
  }
  return [
    ...head,
    `------------------------------`,
    ...details.map(
      (d) => `${d.modul}: ${formatNumber(d.lembar)} lbr x ${formatRupiah(d.feePerLembar)} = ${formatRupiah(d.total)}`
    ),
  ].join("\n");
}

/**
 * Nama file unduhan slip PNG: `slip-{PPID}-{periode}.png`.
 * Disanitasi ke `[A-Za-z0-9_-]` agar aman di semua OS/browser.
 */
export function slipImageFilename(ppid: string, periode: string): string {
  const safe = (s: string): string =>
    s.trim().replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "loket";
  return `slip-${safe(ppid)}-${safe(periode)}.png`;
}
