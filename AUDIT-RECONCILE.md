# Audit Mendalam — Reconcile Validator (`src/app/reconcile/` + `src/core/parsers/reconcile*`)

> Tanggal audit: 21 Oktober 2026 · Metode: baca kode + **eksekusi benchmark & probe program** (bukan asumsi). Semua angka performa diukur di repo ini (Node 24, jsdom/Chromium-equivalent).
> Cakupan: `src/app/reconcile/page.tsx` (453 baris), `src/core/parsers/reconcileHeader.ts` (232), `src/core/parsers/reconcileValidator.ts` (493), `src/lib/excel.ts` (1.008), `src/lib/fileValidation.ts` (74), test `__tests__/reconcileHeader.test.ts` (161) + `reconcileValidator.test.ts` (593).
> **Skor: 7,5/10** — logika pencocokan & penanganan file korup kuat; [H1] & [H3] sudah diperbaiki (lihat tabel status).

## Status Perbaikan (21 Oktober 2026)

| Temuan | Status | Bukti |
|---|---|---|
| **[H1]** Nomor baris laporan ≠ baris Excel | ✅ **Fixed** | `sourceRow` kini dibawa end-to-end: `src/core/parsers/reconcileHeader.ts:170-181` (`ReconcileInputRow.sourceRow`), `:198-213` (`extractReconcileInputRows` → `sourceRow: r + 1`), `:229-247` (`normalizeReconcileRowsFromObjects` → `sourceRow: i + 2`); `src/core/parsers/reconcileValidator.ts:13-21` (`ReconcileInputRow.sourceRow?`), `:28-42` (`ReconcileRowResult.sourceRow`), `:207-250` (`validateRow` + fallback `index + 1`); `src/app/reconcile/page.tsx:31-42` (state `resiCol`), `:148` (`setResiCol`), `:400-455` (tabel: kolom "Baris Excel" + alamat sel `D412`). Verifikasi: header baris 3 → UI `C4`, `C6`, `C7` (sebelumnya `#1`,`#2`,`#3`). |
| **[H2]** Render semua baris (freeze) | ✅ **Fixed** | Render bertahap + paginasi: `src/app/reconcile/page.tsx:37` (`RESULT_PAGE_SIZE = 100`), `:67-91` (`filteredRows` + `pageData`), `:105-117` (`pageNumbers()`), `:480-520` (dropdown filter produk + checkbox "hanya invalid" → reset halaman ke 1), `:533` (tabel merender `pageRows`, bukan seluruh `result.rows`), `:585-625` (footer: rentang baris + tombol prev/next/jendela nomor). Helper murni + uji: `src/core/parsers/reconcileValidator.ts:520-565` (`paginateReconcileRows`) + 6 test baru. Ringkasan total tetap dari `result.summary` (seluruh data hasil validasi — `page.tsx:310/:318/:380`), jadi filter/paginasi tak pernah menggeser angka valid/error. |
| **[H3]** Tidak ada batas ukuran berkas | ✅ **Fixed** | `src/lib/fileValidation.ts:16-25` — `MAX_RECONCILE_FILE_SIZE_BYTES = 15 MB`; `src/app/reconcile/page.tsx:49-62` — `validateFileSize(file, MAX_RECONCILE_FILE_SIZE_BYTES)` dijalankan **sebelum** `file.arrayBuffer()`. |
| **[M1..M6], [L1..L8]** | ⏳ Tertunda | — |

> Test: 437 lulus (26 file) · `tsc --noEmit` bersih · `npm run build` sukses · `npm run lint` 1 error (pre-existing [L1] `react/no-unescaped-entities` di `page.tsx:297`).

## Ringkasan Eksekutif

| Pilar | Nilai | Kesimpulan |
|---|---|---|
| 1. Logika pencocokan | 7/10 | Normalisasi case/whitespace/NBSP/zero-width sudah benar & prefix longest-match avoided. Kekurangan: nilai produk terlalu kaku, resi kosong salah pesan, resi tak divalidasi panjang. |
| 2. Error & edge case | 8/10 | Deteksi format korup (OLE2, CSV-teks, HTML, SpreadsheetML, sel kepanjangan) sangat baik. Kekurangan: limit matriks salah sasaran (per-file, bukan per-sheet terpilih), `hint` error tak tampil, tak ada batas ukuran berkas. |
| 3. Validasi tipe & feedback UI | 6/10 | Pesan alasan cukup informatif, tapi **nomor baris di laporan ≠ nomor baris di Excel**, angka breakdown tak menjumlah, dan masih ada 1 error lint (`react/no-unescaped-entities`). |
| 4. Performa data besar | 5/10 | Parser & validator O(n) aman (≤ 0,6 s untuk 20k×200). Penyebab freeze: **render 20.000 baris tanpa virtualisasi** + parsing Excel di main thread + seluruh sheet dimuat ke memori. |

**Temuan per severity**

| Sev | Temuan | Lokasi |
|---|---|---|
| **High** | H1 — Nomor baris di laporan tidak bisa dipetakan ke baris Excel ✅ FIXED | `reconcileHeader.ts:181-205`, `reconcileValidator.ts:182-209`, `page.tsx:419` |
| **High** | H2 — Tabel hasil merender SEMUA baris (20k+ DOM) → browser freeze ✅ FIXED | `page.tsx:33-38, 393-447` |
| **High** | H3 — Tidak ada batas ukuran berkas → `arrayBuffer()` tanpa rem → OOM/crash tab ✅ FIXED | `page.tsx:57` (bandingkan `fee-rekap/page.tsx` yang pakai `validateFileSize`) |
| **Medium** | M1 — Nilai produk terlalu kaku → false-negative massal | `reconcileValidator.ts:142-144, 182-195` |
| **Medium** | M2 — Nomor resi kosong memberi alasan menyesatkan | `reconcileValidator.ts:197-206` |
| **Medium** | M3 — Batas matriks di-throw untuk sheet mana pun; `hint` tak ditampilkan | `page.tsx:73-84, 127-130` |
| **Medium** | M4 — Rincian invalid tak menjumlah dengan `summary.invalid`; produk tak dikenal tak ditampilkan | `reconcileValidator.ts:411-420`, `page.tsx:292-340` |
| **Medium** | M5 — Parsing Excel di main thread, seluruh sheet dimuat ke memori | `page.tsx:51-93` |
| **Medium** | M6 — `findReconcileHeader` memindai seluruh matriks (baris×kolom) | `reconcileHeader.ts:139-166` |
| **Low** | L1 — Error lint: tanda kutip tak di-escape di JSX | `page.tsx:211` |
| **Low** | L2 — Kode mati: `catch` dua cabang identik; `columnLetter` tak dipakai produksi | `page.tsx:80-84`, `reconcileHeader.ts:88-96` |
| **Low** | L3 — Tips error selalu muncul (tak kontekstual) | `page.tsx:209-214` |
| **Low** | L4 — `ReconcileInputRow` diduplikasi di 2 file; batas 20030/200 di-hardcode | `reconcileHeader.ts:170`, `reconcileValidator.ts:13`, `page.tsx:76-77` |
| **Low** | L5 — `countResiOccurrences` dibangun dua kali per validasi | `reconcileValidator.ts:233, 404` |
| **Low** | L6 — Tidak ada ekspor hasil validasi (daftar mismatch tak bisa diserahkan) | `page.tsx:378-448` |
| **Low** | L7 — Resi tak divalidasi panjang/format ("P26" doang sah) | `reconcileValidator.ts:151-153` |
| **Low** | L8 — Tidak ada pembatalan parsing yang berjalan | `page.tsx:45-134` |

---

## A. Temuan — High

### [H1] Nomor baris di laporan ≠ nomor baris di berkas Excel (traceability hilang)

- **Bukti**
  - `src/core/parsers/reconcileHeader.ts:181-205` — `extractReconcileInputRows()` membuang posisi baris: `out.push({ produk, nomor_resi })`.
  - `src/core/parsers/reconcileValidator.ts:478` — `rows.map((row, index) => validateRow(row, index))` → `index` = indeks **di dalam array hasil ekstraksi**, bukan baris Excel.
  - `src/app/reconcile/page.tsx:419` — UI merender `{row.index + 1}` sebagai kolom "#".
- **Dampak (terverifikasi eksekusi)**
  ```
  header row (0-based): 2   →  UI "#1" = baris Excel 4,  UI "#2" = baris Excel 5
  ```
  Karena baris kosong *juga* dibuang saat ekstraksi (`:194`),序号 meleset **semphit**. User tidak bisa melompat ke baris salah di Excel — harus membaca satu per satu. Untuk berkas 20.000 baris ini brutal.
- **Perbaikan (before → after)**

```ts
// BEFORE — src/core/parsers/reconcileHeader.ts:170-173 & 202
export interface ReconcileInputRow {
  produk: string;
  nomor_resi: string;
}
...
    out.push({ produk, nomor_resi });

// AFTER — src/core/parsers/reconcileHeader.ts
export interface ReconcileInputRow {
  produk: string;
  nomor_resi: string;
  /** Nomor baris di berkas asal (1-based, termasuk baris header). */
  sourceRow: number;
}
...
    // r adalah indeks matriks 0-based → baris Excel = r + 1
    out.push({ produk, nomor_resi, sourceRow: r + 1 });
```

```ts
// AFTER — src/core/parsers/reconcileValidator.ts
export interface ReconcileInputRow {
  produk?: string;
  nomor_resi?: string;
  /** Nomor baris di berkas asal (1-based) — diteruskan ke UI. */
  sourceRow?: number;
}

export interface ReconcileRowResult {
  index: number;
  /** Nomor baris Excel (1-based) bila tersedia; fallback = index + 1. */
  sourceRow: number;
  produk: string;
  nomorResi: string;
  isValid: boolean;
  reason?: string;
  code?: ReconcileRowCode;
}

function validateRow(row: ReconcileInputRow, index: number): ReconcileRowResult {
  const sourceRow = typeof row.sourceRow === "number" && row.sourceRow > 0
    ? row.sourceRow
    : index + 1;
  ...
  return { index, sourceRow, produk, nomorResi, isValid: false, reason, code };
}
```

```tsx
// AFTER — src/app/reconcile/page.tsx (kolom "#" + alasan)
<td className="px-4 py-2 text-slate-400">
  {row.sourceRow}
</td>
...
<td className="px-4 py-2 text-xs text-slate-500">
  {row.reason ?? "—"}
  {/* Alamat sel agar bisa langsung dituju di Excel */}
  {row.code === "PREFIX_MISMATCH" && row.sourceRow > 0 && (
    <span className="ml-1 font-mono text-[10px] text-slate-400">
      (baris {row.sourceRow})
    </span>
  )}
</td>
```
> Tambahkan juga header tabel: **"Baris #"** (bukan "#") + keterangan *"angka = baris di berkas Excel"*.

---

### [H2] Tabel hasil merender seluruh baris → browser freeze pada data besar

- **Bukti**: `src/app/reconcile/page.tsx:33-38` (`visibleRows` = semua baris) dan `:414-443` (`visibleRows.map(...)` → satu `<tr>` + 5 `<td>` per baris, **tanpa** pagination/virtualisasi).
- **Dampak**: berkas 20.000 baris → ±100.000 node DOM. Chrome篷 untuk membuat + layout tabel besar bisa **3–10 detik** (UI beku, tak bisa scroll/responsif),accompanied memory naik ratusan MB. Validasi murni sendiri cepat (terukur: 31–52 ms untuk 20.000 baris) — **yang beku adalah render, bukan kalkulasi**.
- **Perbaikan (before → after)**

```tsx
// BEFORE — src/app/reconcile/page.tsx:33-38
const visibleRows = useMemo(() => {
  if (!result) return [];
  return invalidOnly
    ? result.rows.filter((r) => !r.isValid)
    : result.rows;
}, [result, invalidOnly]);

// AFTER — render bertahap (windowing) + filter produk
const ROW_WINDOW = 200;                 // baris yang dirender per batch
const [windowSize, setWindowSize] = useState(ROW_WINDOW);
const [produkFilter, setProdukFilter] = useState<string>("ALL");

const filteredRows = useMemo(() => {
  if (!result) return [];
  return result.rows.filter(
    (r) =>
      (!invalidOnly || !r.isValid) &&
      (produkFilter === "ALL" || r.produk === produkFilter)
  );
}, [result, invalidOnly, produkFilter]);

const visibleRows = useMemo(
  () => filteredRows.slice(0, windowSize),
  [filteredRows, windowSize]
);
```
```tsx
{/* AFTER — footer tabel: tombol "tampilkan lagi" */}
<div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
  <span>
    Menampilkan {visibleRows.length} dari {filteredRows.length} baris
    {filteredRows.length > visibleRows.length &&
      ` (sisa ${filteredRows.length - visibleRows.length} baris belum ditampilkan)`}
  </span>
  {visibleRows.length < filteredRows.length && (
    <button
      type="button"
      onClick={() => setWindowSize((n) => n + ROW_WINDOW)}
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
    >
      Tampilkan {Math.min(ROW_WINDOW, filteredRows.length - visibleRows.length)} baris berikutnya
    </button>
  )}
</div>
```
> Alternatif tanpa menambah dependensi: `content-visibility: auto` pada `<tr>` (browser melompati layout baris di luar viewport):
> ```tsx
> <tr style={{ contentVisibility: "auto", containIntrinsicSize: "0 48px" }} …>
> ```
> Untuk > 50.000 baris,正解nya Web Worker + render worker, atau virtualizer (`@tanstack/react-virtual` — repo sudah punya `@tanstack/react-query`, tinggal menambah paket virtualizer).

---

### [H3] Tidak ada batas ukuran berkas → risiko OOM / crash tab

- **Bukti**: `src/app/reconcile/page.tsx:57` — `const buffer = await file.arrayBuffer();` **tanpa** `validateFileSize()`. Bandingkan modul lain: `src/app/fee-rekap/page.tsx` memanggil `validateFileSize(file, MAX_FEE_EXCEL_SIZE_BYTES)` sebelum membaca buffer; `src/lib/fileValidation.ts:16-25` sudah menyediakan helper-nya.
  Dampak: file 500 MB → `arrayBuffer()` alokasi 500 MB di heap + exceljs membuat matriks kedua (berlipat) → tab crash ("Aw, Snap") tanpa pesan.
- **Perbaikan (before → after)**

```ts
// BEFORE — src/app/reconcile/page.tsx:45-58
async function handleFile(file: File) {
  setParsing(true);
  setParseError(null);
  setResult(null);
  try {
    const { loadWorkbookFromBuffer, ... } = await import("@/lib/excel");
    const buffer = await file.arrayBuffer();   // tanpa batas ukuran

// AFTER — src/app/reconcile/page.tsx
import { validateFileSize, MAX_RECONCILE_FILE_SIZE_BYTES } from "@/lib/fileValidation";

async function handleFile(file: File) {
  setParsing(true);
  setParseError(null);
  setResult(null);
  try {
    // 1) Ukuran berkas (cegah OOM sebelum alokasi buffer)
    const sizeErr = validateFileSize(file, MAX_RECONCILE_FILE_SIZE_BYTES);
    if (sizeErr) {
      setParseError(sizeErr);
      return;
    }
    const { loadWorkbookFromBuffer, ... } = await import("@/lib/excel");
    const buffer = await file.arrayBuffer();
```
```ts
// AFTER — src/lib/fileValidation.ts
/** Batas Reconcile Validator: 15 MB (berkas rekon 20k baris ≈ 2–4 MB). */
export const MAX_RECONCILE_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
```
> `validateFileSize` sudah mendeteksi `file.size === 0` ("File kosong") → Covers edge case "berkas korup/0 byte" tanpa kode tambahan.

---

## B. Temuan — Medium

### [M1] Nilai produk terlalu kaku → false-negative massal

- **Bukti**: `src/core/parsers/reconcileValidator.ts:142-144, 182-195` — produk dinormalisasi hanya `stripInvisible + trim + UPPER`, lalu **harus sama persis** dengan `SUPPORTED_PRODUCTS`.
- **Dampak (terverifikasi eksekusi)**

  | Nilai produk di file | Hasil |
  |---|---|
  | `"EC3 SHPE"` | ❌ `UNKNOWN_OR_INVALID_PRODUCT` (padahal resi `SHPE123` valid) |
  | `"pkh."` | ❌ `UNKNOWN_OR_INVALID_PRODUCT` |
  | `"PKH/SHPE"` | ❌ `UNKNOWN_OR_INVALID_PRODUCT` |
  | `" pjb "` | ✅ valid (sudah di-trim) |
  | `312` (angka) | ✅ valid |

 够了 — satu baris "EC3 SHPE" di kolom produk membuat **seluruh baris** produk itu reported invalid; user bisa salah mengira file lama/"salah format".
- **Perbaikan (before → after)**

```ts
// BEFORE — src/core/parsers/reconcileValidator.ts:142-144 & 186
function normalize(value: unknown): string {
  return stripInvisible(String(value ?? "")).trim().toUpperCase();
}
...
  if (!isSupportedProduct(produk)) { … }

// AFTER — src/core/parsers/reconcileValidator.ts
/** Alias nilai produk → kode kanonik (toleran dekorasi/label gabungan). */
const PRODUCT_ALIASES: Record<string, SupportedProduct> = {
  EC3: "EC3",
  "EC3 SHPE": "EC3",
  PKH: "PKH",
  "PKH SHPE": "PKH",
  "PPB PKT": "PPB_PKT",
  PPB: "PPB_PKT",
  "POS EKSPOR": "3PE",
  EMS: "312",
};

/**
 * Kanonik nilai produk:_upper + trim → coba nama persis → coba token
 * pertama (buang dekorasi "EC3 (SHPE)", "PKH/SHPE", "pkh.") → alias.
 * Mengembalikan null bila produk tak dikenal.
 */
function canonicalProduct(raw: unknown): SupportedProduct | null {
  const norm = normalize(raw);
  if (norm === "") return null;
  if (isSupportedProduct(norm)) return norm;
  const alias = PRODUCT_ALIASES[norm];
  if (alias) return alias;
  // Token pertama sebelum spasi/slash/parentheses/tanda baca.
  const token = norm.split(/[\s/()[\]{}.,;|_-]+/).filter(Boolean)[0] ?? "";
  if (token !== "") {
    if (isSupportedProduct(token)) return token;
    const tokenAlias = PRODUCT_ALIASES[token];
    if (tokenAlias) return tokenAlias;
  }
  return null;
}
```
```ts
// AFTER — validateRow memakai kanonik; alasan tetap menyebut nilai ASLI
function validateRow(row: ReconcileInputRow, index: number): ReconcileRowResult {
  const produkRaw = normalize(row.produk);
  const produk = canonicalProduct(row.produk);
  const nomorResi = normalizeResi(row.nomor_resi);
  if (produk === null) {
    return {
      index, sourceRow, produk: produkRaw, nomorResi, isValid: false,
      reason: produkRaw === ""
        ? `${UNKNOWN_PRODUCT_REASON} (produk kosong)`
        : `${UNKNOWN_PRODUCT_REASON} (nilai produk: "${produkRaw}")`,
      code: "UNKNOWN_OR_INVALID_PRODUCT",
    };
  }
  …
}
```
> Catatan: `row.produk` yang ditampilkan di UI sebaiknya **nilai asal** (agar user melihat apa yang tertulis di file), sedangkan pencocokan memakai kode kanonik.

---

### [M2] Nomor resi kosong memberi alasan yang menyesatkan

- **Bukti**: `src/core/parsers/reconcileValidator.ts:197-206` — resi kosong jatuh ke `startsWithAny("", prefixes)` = false → reason `"Resi PKH harus diawali P26, TTSPOS, …"`.
- **Dampak (terverifikasi)**: `produk=PKH, resi=""` → *"Resi PKH harus diawali P26, TTSPOS, 26MNG, 26KOM, 26EVP, 26ASD, atau 26"*. User akan mengganti format resi, padahal masalahnya **sel resi tidak terisi** (defek paling sering di file real).
- **Perbaikan (before → after)**

```ts
// BEFORE — src/core/parsers/reconcileValidator.ts:19-22 & 197-206
export type ReconcileRowCode =
  | "PREFIX_MISMATCH"
  | "UNKNOWN_OR_INVALID_PRODUCT"
  | "DUPLICATE_RESI";
...
  if (!startsWithAny(nomorResi, PRODUCT_PREFIXES[produk])) { … }

// AFTER
export type ReconcileRowCode =
  | "PREFIX_MISMATCH"
  | "UNKNOWN_OR_INVALID_PRODUCT"
  | "DUPLICATE_RESI"
  | "EMPTY_RESI";

const EMPTY_RESI_REASON =
  "EMPTY_RESI: nomor resi kosong — sel kolom resi tidak terisi (atau baris ini bukan data transaksi)";

function validateRow(row: ReconcileInputRow, index: number): ReconcileRowResult {
  …
  // Resi kosong = cacat data, BUKAN prefix salah → pesan terpisah.
  if (nomorResi === "") {
    return {
      index, sourceRow, produk, nomorResi, isValid: false,
      reason: EMPTY_RESI_REASON,
      code: "EMPTY_RESI",
    };
  }
  if (!startsWithAny(nomorResi, PRODUCT_PREFIXES[produk])) { … }
```
> Test regresi yang perlu ditambahkan: `validateReconcileRows([{produk:"PKH", nomor_resi:""}])` → `code === "EMPTY_RESI"` (bukan `PREFIX_MISMATCH`).

---

### [M3] Batas matriks di-throw untuk sheet mana pun + `hint` tak pernah tampil

- **Bukti**
  - `src/app/reconcile/page.tsx:73-84` — `validateMatrixLimits()` dipanggil untuk **setiap** sheet dan langsung `throw` (dua cabang catch identik = kode mati). Workbook dengan sheet "raw" 30.000 baris + sheet "rekap" 500 baris → **seluruh file ditolak**, padahal sheet rekap-nya valid.
  - `src/app/reconcile/page.tsx:127-130` — error ditampilkan lewat `err.message` saja; `MatrixLimitError.hint` (field terpisah, `src/lib/excel.ts:83`) **tidak pernah** dirender. Untuk `TOO_MANY_ROWS`/`TOO_MANY_COLS`/`TOTAL_TOO_LARGE`, hint memuat instruksi perbaikan yang justru paling dibutuhkan user.
- **Perbaikan (before → after)**

```ts
// BEFORE — src/app/reconcile/page.tsx:70-93
for (const name of workbook.sheetNames) {
  const m = workbook.matrices.get(name) ?? [];
  if (m.length === 0) continue;
  try {
    validateMatrixLimits(m, { maxRows: 20030, maxCols: 200, fileName: file.name, sheetName: name });
  } catch (e) {
    if (e instanceof MatrixLimitError) throw e;   // cabang identik → kode mati
    throw e;
  }
  const h = findReconcileHeader(m);
  …
}

// AFTER — limit dipakai sebagai FILTER sheet, bukan penolak file
const limitWarnings: string[] = [];
let limitError: MatrixLimitError | null = null;
for (const name of workbook.sheetNames) {
  const m = workbook.matrices.get(name) ?? [];
  if (m.length === 0) continue;
  try {
    validateMatrixLimits(m, {
      maxRows: RECONCILE_MAX_ROWS,
      maxCols: RECONCILE_MAX_COLS,
      fileName: file.name,
      sheetName: name,
    });
  } catch (e) {
    if (e instanceof MatrixLimitError) {
      // Sheet ini terlalu besar → lewati, bukan tolak seluruh file.
      limitWarnings.push(`Sheet "${name}" dilewati: ${e.message}`);
      limitError ??= e;
      continue;
    }
    throw e;
  }
  const h = findReconcileHeader(m);
  …
}
```
```tsx
{/* AFTER — src/app/reconcile/page.tsx:203-216 (panel error) */}
{parseError && (
  <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
    <p className="flex items-start gap-2 text-sm text-red-700">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="break-words whitespace-pre-wrap">{parseError}</span>
    </span>
    {/* Hint dari MatrixLimitError (instruksi perbaikan) — sebelumnya hilang */}
    {parseHint && (
      <p className="mt-2 pl-6 text-xs text-red-600">{parseHint}</p>
    )}
    <p className="mt-2 pl-6 text-xs text-red-600">Tips: …</p>
  </div>
)}
```
```ts
// AFTER — simpan hint saat menangkap error
catch (err) {
  setParseError(err instanceof Error ? err.message : "Gagal membaca berkas.");
  setParseHint(err instanceof MatrixLimitError ? err.hint : "");
}
```
> Tambahkan state `parseHint` + reset di `reset()`.

---

### [M4] Rincian invalid tidak menjumlah dengan `summary.invalid`; produk tak dikenal tak terlihat

- **Bukti**
  - `src/core/parsers/reconcileValidator.ts:411-420` — produk tak dikenal di-`continue` **sebelum** masuk `byProduct`; hanya dihitung di `breakdown.unknownInvalid`.
  - `src/app/reconcile/page.tsx:292-340` — kartu "Resi Invalid" menampilkan PKH/EC3/PE/PJB + produk pendukung dari `byProduct`; **`unknownInvalid` tidak pernah dirender**.
- **Dampak (terverifikasi eksekusi)**
  ```
  input  : 11 baris (3 produk tak dikenal) → summary.invalid = 5
  byProduct: {"312":{1,0},"PKH":{4,1},"EC3":{0,1},"PJB":{1,0}}
  tak dikenal (unknownInvalid) = 3   ← TIDAK tampil di UI
  jumlah yang tampil = 3 ≠ 5 (selisih 2... karena 3 tak dikenal, 1 duplikat)
  ```
  User melihat angka-angka yang tidak menjumlah → menduga laporan salah.
- **Perbaikan (before → after)**

```ts
// BEFORE — src/core/parsers/reconcileValidator.ts:411-420
for (const row of rows) {
  if (!isSupportedProduct(row.produk)) {
    breakdown.unknownInvalid += 1;
    continue;                       // produk tak dikenal tak masuk byProduct
  }
  const stat = (breakdown.byProduct[row.produk] ??= { valid: 0, invalid: 0 });
  …
}

// AFTER — produk tak dikenal tetap masuk byProduct (agar menjumlah)
const productKey = isSupportedProduct(row.produk)
  ? row.produk
  : `LAIN-LAIN (${row.produk || "kosong"})`;
const stat = (breakdown.byProduct[productKey] ??= { valid: 0, invalid: 0 });
if (row.isValid) stat.valid += 1;
else stat.invalid += 1;
if (!isSupportedProduct(row.produk)) {
  breakdown.unknownInvalid += 1;
  continue;                          // tak ada prefix/breakdown per prefix
}
```
```tsx
{/* AFTER — src/app/reconcile/page.tsx:292-340 (kartu Resi Invalid) */}
{breakdown.unknownInvalid > 0 && (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="font-semibold text-slate-600">Produk tak dikenal</dt>
    <dd className="font-extrabold text-red-700">
      {breakdown.unknownInvalid} resi
    </dd>
  </div>
)}
{/* + ringkasan duplikat yang sudah dihitung tapi tak tampil */}
{breakdown.duplicateResiGroups > 0 && (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="font-semibold text-slate-600">Resi ganda</dt>
    <dd className="font-extrabold text-red-700">
      {breakdown.duplicateResiGroups} nomor / {breakdown.duplicateResiRows} baris
    </dd>
  </div>
)}
```
> `breakdown.duplicateResiRows` & `duplicateResiGroups` sudah dihitung (`:405-410`) tapi belum pernah ditampilkan — data siap pakai, tinggal dirender.

---

### [M5] Parsing Excel di main thread & seluruh sheet dimuat ke memori

- **Bukti**: `src/app/reconcile/page.tsx:51-93` — `await import("@/lib/excel")` → `loadWorkbookFromBuffer()` mem-parse **semua** sheet ke matriks (`:920-927` `src/lib/excel.ts`), lalu halaman memindai semuanya di loop.
- **Dampak**: exceljs (ZIP + XML) adalah proses CPU-bound sinkron di thread utama → UI beku selama beberapa detik untuk file besar (tanda "Membaca…" tak sempat ter-render). Setelah itu, semua sheet ada di memori (2× ukuran file).
- **Perbaikan (before → after)**

```ts
// BEFORE — src/app/reconcile/page.tsx:51-93 (semuanya sinkron di main thread)
const { loadWorkbookFromBuffer, matrixToObjects, validateMatrixLimits, MatrixLimitError } =
  await import("@/lib/excel");
const buffer = await file.arrayBuffer();
const workbook = await loadWorkbookFromBuffer(buffer, { defval: null, fileName: file.name });
for (const name of workbook.sheetNames) { … }   // blocking, tanpa yield

// AFTER (langkah minimal: beri jeda + progres per sheet; ideal: Web Worker)
// src/app/reconcile/page.tsx
const [progress, setProgress] = useState<string>("");

for (const name of workbook.sheetNames) {
  setProgress(`Memindai sheet "${name}"…`);
  await new Promise((r) => setTimeout(r, 0));   // yield → UI tetap responsif
  const m = workbook.matrices.get(name) ?? [];
  …
}
```
```ts
// AFTER (ideal) — src/app/reconcile/reconcile.worker.ts
/// <reference lib="webworker" />
import { loadWorkbookFromBuffer, validateMatrixLimits } from "@/lib/excel";
import { findReconcileHeader, extractReconcileInputRows } from "@/core/parsers/reconcileHeader";

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  const { buffer, fileName } = e.data;
  const wb = await loadWorkbookFromBuffer(buffer, { defval: null, fileName });
  for (const name of wb.sheetNames) {
    const m = wb.matrices.get(name) ?? [];
    const h = findReconcileHeader(m);
    if (!h) continue;
    const rows = extractReconcileInputRows(m, h);
    (self as unknown as Worker).postMessage({ type: "sheet", name, rows });
  }
  (self as unknown as Worker).postMessage({ type: "done" });
};
```
```ts
// AFTER — src/app/reconcile/page.tsx (pemakaian worker)
const worker = new Worker(new URL("./reconcile.worker.ts", import.meta.url));
worker.onmessage = (e) => { if (e.data.type === "sheet") { /* kumpulkan */ } };
worker.postMessage({ buffer, fileName: file.name });
```
> Alternatif tanpa worker: pecah `loadWorkbookFromBuffer` agar menerima callback per sheet, sehingga sheet bisa dilepas dari memori setelah dipindai (hemat memori, tidak mengurai freeze).

---

### [M6] `findReconcileHeader` memindai seluruh matriks (baris × kolom)

- **Bukti**: `src/core/parsers/reconcileHeader.ts:139-166` — untuk **setiap** baris, `raw.map(normalizeHeaderCell)` (alokasi array + string baru per sel) lalu `findBestCol` (loop alias × kolom).
- **Ukur (benchmark di repo ini)**

  | Matriks | `findReconcileHeader` | `extract…` | `validate…` | `breakdown` |
  |---|---|---|---|---|
  | 20.000 × 60 | 219 ms | 6 ms | 52 ms | 19 ms |
  | 20.000 × 200 | **516 ms** | 7 ms | 31 ms | 14 ms |
  | 20.000 × 200 (tanpa header) | 457 ms | — | — | — |

  Dominan: 4 juta pemanggilan `normalizeHeaderCell` (toLowerCase + regex) → alokasi garbage tinggi → GC pressure di browser.
- **Perbaikan (before → after)**

```ts
// BEFORE — src/core/parsers/reconcileHeader.ts:139-145
for (let r = 0; r < limit; r += 1) {
  const raw: unknown[] = matrix[r] ?? [];
  const normalized = raw.map((c) => normalizeHeaderCell(c));
  const produkCol = findBestCol(normalized, PRODUK_ALIASES);
  const resiCol = findBestCol(normalized, RESI_ALIASES);
  if (produkCol === -1 || resiCol === -1 || produkCol === resiCol) continue;

// AFTER — pra-filter murah: baris tanpa jejak alias dilewati sebelum normalisasi
/** Jejak alias di teks mentah (lowercase) — semua alias ter|posisi di sini. */
const ALIAS_HINT_REGEX =
  /produk|product|jenis|layanan|service|tipe|resi|awb|connote|tracking|airwaybill|nomor/;

for (let r = 0; r < limit; r += 1) {
  const raw: unknown[] = matrix[r] ?? [];
  // (1) pre-check murah: satu join + satu regex per baris (bukan per sel)
  const hint = raw.map(cellText).join(" ").toLowerCase();
  if (!ALIAS_HINT_REGEX.test(hint)) continue;
  // (2) normalisasi penuh hanya untuk kandidat header
  const normalized = raw.map((c) => normalizeHeaderCell(c));
  const produkCol = findBestCol(normalized, PRODUK_ALIASES);
  const resiCol = findBestCol(normalized, RESI_ALIASES);
  if (produkCol === -1 || resiCol === -1 || produkCol === resiCol) continue;
```
> Alternatif lebih ketat: batasi pemindaian ke 200 baris pertama + fallback ke pemindaian penuh hanya bila tak ada header (header laporan realistis di baris < 50). Perlu diuji terhadap fixture "header di baris 13" (`reconcileHeader.test.ts:65`).

---

## C. Temuan — Low

### [L1] Error lint: tanda kutip tak di-escape di JSX
- `src/app/reconcile/page.tsx:211` — `tanda kutip (") liar` → `react/no-unescaped-entities` (**satu-satunya error lint yang tersisa di repo**).
```tsx
// BEFORE
Tips: buka file di Excel → periksa sel yang dilaporkan → hapus
tanda kutip (") liar / teks tempelan panjang → simpan ulang
// AFTER
Tips: buka file di Excel → periksa sel yang dilaporkan → hapus
tanda kutip (&quot;) liar / teks tempelan panjang → simpan ulang
```

### [L2] Kode mati
- `src/app/reconcile/page.tsx:80-84` — `if (e instanceof MatrixLimitError) throw e; throw e;` (dua cabang identik).
- `src/core/parsers/reconcileHeader.ts:88-96` — `columnLetter()` hanya dipakai test; **idealnya dipakai di UI** untuk menyebut alamat sel ("kolom D, baris 412"). Gabungkan dengan [H1].

### [L3] Tips error selalu muncul, tak kontekstual
- `src/app/reconcile/page.tsx:209-214` — blok "Tips: …" muncul untuk semua error, termasuk "Kolom Produk dan Nomor Resi ber-data tidak ditemukan" (tips kutip liar tak relevan). Syaratkan pada jenis error.

### [L4] Duplikasi tipe & konstanta hardcode
- `ReconcileInputRow` ada di `reconcileHeader.ts:170` **dan** `reconcileValidator.ts:13` (beda optionality; kompatibilitas hanya karena structural typing).
- Batas `maxRows: 20030` / `maxCols: 200` di-hardcode di `page.tsx:76-77` (bandingkan `IMPORT_MAX_ROWS`/`IMPORT_MAX_COLS` di `dataUtamaService.ts`). Pindahkan ke konstanta bersama di `src/lib/fileValidation.ts`.

### [L5] `countResiOccurrences` dibangun dua kali
- `reconcileValidator.ts:233` (`markDuplicateResi`) dan `:404` (`buildReconcileBreakdown`) → dua Map 20.000 entri per validasi. Hitung sekali, teruskan ke keduanya (atau turunkan ke service yang mengembalikan breakdown + flag duplikat sekaligus).

### [L6] Tidak ada ekspor hasil validasi
- User tak bisa menyerahkan daftar mismatch ke orang lain. Tambahkan tombol "Ekspor invalid (CSV)" memakai helper baru di `src/core/parsers/reconcileValidator.ts`:
```ts
export function buildReconcileCsv(rows: ReconcileRowResult[]): string {
  const esc = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = "Baris;Produk;Nomor Resi;Status;Alasan";
  const lines = rows.map((r) =>
    [String(r.sourceRow), esc(r.produk), esc(r.nomorResi), r.isValid ? "VALID" : "INVALID", esc(r.reason ?? "")].join(";")
  );
  return [header, ...lines].join("\n");
}
```
> Jangan lupa prefix anti-formula (`=`, `+`, `-`, `@`) seperti pada audit [MEDIUM-3] modul fee.

### [L7] Resi tak divalidasi panjang/format
- `startsWithAny` (`:151-153`) hanya cek awalan → `"P26"` (tanpa nomor) sah; `"P26<catatan panjang>"` sah. Tambahkan batas panjang minimum (mis. ≥ 8 karakter) & karakter valid (A-Z0-9-) agar seliesen/tertempel terdeteksi.

### [L8] Tidak ada pembatalan parsing yang sedang berjalan
- `handleFile` tidak bisa dibatalkan; user harus reload halaman. Tambahkan `AbortController` + tombol "Batalkan".

---

## D. Yang Sudah Bagus (pertahankan)

- **Normalisasi berlapis sudah benar**: `stripInvisible` (NBSP/zero-width/CR) → trim → UPPER; resi juga丢掉 semua spasi (`reconcileValidator.ts:131-149`). Terbukti: `"P26 00123"` → valid, `"26kom"` → valid.
- **Longest-match saat breakdown** (`PKH_PREFIXES_BY_LENGTH`, `:160-162`) mencegah prefix generik `"26"` menelan `"26MNG"` — bug klasik yang sudah dihandling.
- **Cakupan prefix dihitung PER PRODUK** (`checkFileCoverage`, `:248-269`) — menutup false-negative berkas campuran.
- **Deteksi file korup berlapis & pesannya sangat baik** (`src/lib/excel.ts`): magic-byte sniffing (bukan percaya ekstensi), OLE2 ditolak eksplisit, CSV-teks ber-ekstensi `.xlsx` ditolak, Spreadsheet HTML & SpreadsheetML 2003 diekstrak, kutip CSV tak berpasangan dipulihkan +_SEL +_cell guard (mencegah "1 sel 2,8 juta karakter").
- **Kode murni & terisolasi** (`reconcileHeader.ts` / `reconcileValidator.ts` tanpa import React) → mudah diuji; 754 baris test sudah ada.
- **Data tak pernah keluar dari browser** — seluruh validasi client-side, tidak ada upload ke server → tidak ada risiko PII bocor.
- **Struktur breakdown sudah kaya** (`byProduct`, `duplicateResiGroups`, `unknownInvalid`) — tinggal dirender (lihat M4).

---

## E. Prioritas perbaikan yang disarankan

| Prioritas | Item | Temuan | Estimasi |
|---|---|---|---|
| 1 | Nomor baris Excel dibawa sampai UI | H1 | S |
| 1 | Batas ukuran berkas | H3 | S |
| 1 | Render bertahap + filter produk | H2, M4 | M |
| 2 | Kanonik nilai produk (toleran dekorasi) | M1 | M |
| 2 | Pesan khusus resi kosong | M2 | S |
| 2 | Limit per-sheet + tampilkan `hint` | M3 | M |
| 3 | Yield/Worker untuk parsing | M5 | L |
| 3 | Pre-filter murah di deteksi header | M6 | S |
| 4 | Escape kutip, hapus kode mati, ekspor CSV, konstanta bersama | L1–L8 | S–M |
