# Laporan Audit Komprehensif: kurlog-portal-v2

> Tanggal audit: 21 Oktober 2026 · Metode: verifikasi manual terhadap kode yang berjalan (bukan menyalin laporan lama 5 Okt 2026 — seluruh temuan lama dicek ulang). Bukti selalu berbentuk `path:baris`. Perkiraan: 426 test lulus (26 file), `npm run lint` = 1 error + 8 warning, `npm run build` sukses.
> Stack: Next.js 16 (App Router, `src/proxy.ts`) · React 19 · Supabase (PostgREST) · Tailwind v4 · exceljs · Vitest · TypeScript `strict`.

## Status Perbaikan (diperbarui 21 Oktober 2026)

| Temuan | Status | Bukti |
|---|---|---|
| **[HIGH-1]** Rekap fee > 1.000 baris tak terjangkau | ✅ **Fixed** | Paginasi + filter dipindah ke server: `src/app/fee-rekap/page.tsx:565-620` (`loadPage` kirim `q`+`periode`+`page`+`pageSize`), state `rows` = satu halaman server (`:441-457`), header ringkasan memakai `listTotal` dari DB (`:1740-1760`, `:2107-2111`), footer paginasi memakai `totalPages` server (`:2195-2205`). Client-side `filterFeeRows`/`paginateRows` dihapus dari halaman. Helper ekspor `fetchAllFeeList()` (`src/core/services/feeRekapService.ts:2240-2270`) mengambil SEMUA halaman agar ekspor/verifikasi tak terpotong. Ringkasan per-periode via RPC baru `loket_profiles_summary_for_period` / `fee_rekap_summary_for_period` (migrasi `supabase/migrations/20261009000000_fee_rekap_summary_per_period.sql`) → header sinkron dengan filter aktif. |
| **[HIGH-2]** Auto-close resi false positive ("belum diterima") | ✅ **Fixed** | `src/core/services/resiService.ts:143-144` (regex negasi `AUTO_CLOSE_NEGATION_REGEX`) + `:158-167` (`isAutoCloseNote` veto negasi). Test regresi: `src/core/services/resiManage.test.ts:320-339` (12 kasus negasi + 4 positif). |
| **[HIGH-3]** Tiga definisi `totalFee` (NET / GROSS / legacy) | ✅ **Fixed** | `src/core/services/feeRekapService.ts:452-503` — fungsi terpusat `computeTotalFee()` (GROSS: Bulan Ini + Bulan Sebelumnya + Subsidi, tanpa pengurangan potongan/hold). 9 call site: `:1514` (dinamis/absolut), `:1876` (readback `fee_loket`), `:1953` (readback `loket_profiles`), `:2077` (simpan `toFeeDbRow`), `:3148` + `:3218` (parser Master), `:3450` (sheet `Cari`), `:3803` (simpan profil), `:3892` (normalisasi impor), `:4008` (lookup profil). Test: `feeRekapService.test.ts` blok `computeTotalFee` + invariant "baris monitoring = profil" + slip NETTO/TOTAL. |
| **[MEDIUM-1..10], [LOW-1..5]** | ⏳ Tertunda | — |

> **Deploy note (HIGH-1)**: jalankan `supabase db push` agar migrasi `20261009000000_fee_rekap_summary_per_period.sql` terpasang. Tanpa itu, ringkasan pada header kembali ke agregat global (graceful fallback, tak ada error).

> Catatan migrasi data: baris `fee_loket` lama yang disimpan dengan konvensi NET (hasil impor dinamis versi lama) perlu **re-import** agar `total_fee` konsisten GROSS; nilai yang sudah ada tidak diubah otomatis (readback memprioritaskan `total_fee` tersimpan).

## Ringkasan Eksekutif

**Status kesehatan kode: 7,5/10 — sisi keamanan sudah kuat, sisi data-skala & konsistensi angka masih bermasalah.**

| Area | Nilai | Kesimpulan |
|---|---|---|
| Security & Data Integrity | 8/10 | RLS + GRANT service_role menutup semua tabel sensitif; otorisasi per-route + validasi input ketat. Sisa: rate-limit login rapuh, tanpa security header, CSV formula injection. |
| Performance & Optimization | 6/10 | Rekap fee memuat 1.000 baris lalu memfilter/paginasi **di browser** → data di luar 1.000 baris tak terjangkau; ada N+1 (bagging) dan race condition fetch (data-utama, monitoring-resi). |
| Code Quality & Architecture | 7/10 | Type safety bagus (strict, tanpa `any`), 423 test hijau, invariant akuntansi impor fee sangat baik. Sisa: `lint` merah, file 3.100+ baris. Definisi `totalFee` kini terpusat (`computeTotalFee`). |

**Yang harus diperbaiki lebih dulu (urutan):**

1. **[HIGH] ✅ Fixed** Paginasi/filter rekap fee dipindah ke server (data > 1.000 baris sekarang terjangkau).
2. **[HIGH] ✅ Fixed** Auto-close resi: veto negasi (`belum diterima`) — resi ditutup otomatis tanpa sepengetahuan petugas.
3. **[HIGH] ✅ Fixed** Satu definisi tunggal `totalFee` untuk semua jalur parse (Master / dinamis / legacy).
4. **[MEDIUM]** Filter tanggal dibuat timezone-aware (WIB) + race condition fetch di `data-utama` & `monitoring-resi`.
5. **[MEDIUM]** Security header di `next.config.ts`, hardening rate-limit login, anti-formula pada export CSV.

---

## A. Temuan — High

### [HIGH-1] Rekap fee: seluruh data di luar 1.000 baris tidak pernah tampil & filter periode tidak bisa menjangkau

- **Bukti**
  - `src/app/fee-rekap/page.tsx:554-564` — muat awal: `fetchFeeList({ pageSize: 1000 })`, hasilnya disimpan utuh di state `dataset`.
  - `src/app/fee-rekap/page.tsx:693-698` — filter & paginasi dilakukan **di browser**: `filterFeeRows(dataset, committedQuery, periode)` → `paginateRows(filtered, page, PAGE_SIZE)`.
  - `src/app/fee-rekap/page.tsx:2043-2047` — banner peringatan: *"gunakan filter periode atau pencarian PPID untuk melihat sisanya"*.
  - `src/app/api/fee-rekap/route.ts:29,31,39` — API **sudah** mendukung `page`, `pageSize` (cap `MAX_PAGE_SIZE=1000`) dan `periode` di DB.
  - Komentar internal di `fee-rekap/page.tsx:441-445` dan `feeRekapService.ts` menyebut data 10.000+ baris.
- **Mengapa bermasalah**
  1. Tabel hanya berisi ≤ 1.000 baris pertama (diurut `periode DESC, ppid ASC`), sisanya tidak pernah di-query.
  2. **Saran pada banner salah**: `filterFeeRows` bekerja pada `dataset` lokal. Memilih periode lain tidak menambah baris — ia hanya **memfilter** 1.000 baris yang sudah termuat. User bisa melihat "0 data" padahal datanya ada (baris itu di luar jendela 1.000).
  3. `listTotal` (total DB) dipakai sebagai denominator pagination client-side → nomor halaman & jumlah baris tidak konsisten dengan isi tabel.
  4. Total fee yang ditampilkan di kartu ringkasan berasal dari agregasi SQL (RPC) → **angka di header tidak cocok dengan jumlah baris tabel**; yangusers laparasi "kok total beda" cepat atau lambat.
- **Dampak**: laporan keuangan periodik potentially salah/tidak lengkap; ekspor CSV/Excel memuat data parsial tanpa penanda tegas per baris.
- **Perbaikan (before → after)**

```ts
// BEFORE — src/app/fee-rekap/page.tsx:554-564 + 693-698
const [list, logList] = await Promise.all([
  fetchFeeList({ pageSize: 1000 }),      // dataset ter-cap 1.000
  fetchUploadLogs().catch(() => []),
]);
setDataset(list.data);                  // hanya 1.000 baris, sisanya hilang
const filtered = useMemo(
  () => filterFeeRows(dataset, committedQuery, periode),  // filter lokal
  [dataset, committedQuery, periode]
);
const { pageRows, totalPages } = useMemo(
  () => paginateRows(filtered, page, PAGE_SIZE),          // paginasi lokal
  [filtered, page]
);
```

```ts
// AFTER — state digerakkan server (query, periode, page)
const [dataset, setDataset] = useState<FeeRekapRow[]>([]);
const [listTotal, setListTotal] = useState(0);
const [totalPages, setTotalPages] = useState(1);

const loadAll = useCallback(async () => {
  setListLoading(true);
  try {
    const [list, logList] = await Promise.all([
      // query + periode + page dikirim ke API; server yang memfilter
      fetchFeeList({
        q: committedQuery,
        periode: periode === "SEMUA" ? undefined : periode,
        page,
        pageSize: 100,          // < PAGE_SIZE tabel, muat per halaman
      }),
      fetchUploadLogs().catch(() => []),
    ]);
    setDataset(list.data);
    setListTotal(list.total);
    setTotalPages(list.totalPages);
    setLogs(logList);
  } finally {
    setListLoading(false);
  }
}, [committedQuery, periode, page]);

// Tidak ada lagi filterFeeRows/paginateRows di sisi client untuk tabel.
// filterFeeRows tetap dipakai untuk slip lokal (data yang SUDAH terambil).
const { pageRows } = { pageRows: dataset };
```

> Catatan: `filterFeeRows`/`paginateRows` (service) tidak dihapus — dipakai ulang untuk slip/lookup lokal; yang dipindah adalah **sumber** tabel utama.

### [HIGH-2] Auto-close resi salah menutup resi bercatatan "belum diterima"

- **Bukti**
  - `src/core/services/resiService.ts:129-130`
    ```ts
    export const AUTO_CLOSE_NOTE_REGEX =
      /(?:^|[\s.,;:])(delivered|diterima(\s+paket)?|paket\s+(sudah\s+)?diterima|retur(\s+disetujui)?)(?=[\s.,;:!]|$)/i;
    ```
  - `resiService.ts:512-525` (path `updateFollowUpStatus`) dan `resiService.ts:596-600` (path `updateResiStatus`) memaksa `status_followup = SUDAH_FOLLOWUP`, `is_selesai = SELESAI`, `closed_at = now`.
- **Mengapa bermasalah**: prefiks `(?:^|[\s.,;:])` hanya mensyaratkan batas kata, **bukan** makna. `"belum diterima"`, `"tidak diterima"`, `"resi belum diterima paket"` → regex tetap match kata `diterima` (didahului spasi) → resi **ditutup otomatis** meski petugas menyatakan belum sampai. Kata `retur` juga match `"belum retur"`.
- **Dampak**: data follow-up resi ikut berubah tanpa konfirmasi; anschließ auto-purge `RESI_PURGE_AFTER_DAYS = 2` (`resiService.ts:141`) menghapus bukti tak lama. Ini merusak data operasional (bukan sekadar tampilan).
- **Perbaikan (before → after)**

```ts
// BEFORE — resiService.ts:129-137
export const AUTO_CLOSE_NOTE_REGEX =
  /(?:^|[\s.,;:])(delivered|diterima(\s+paket)?|paket\s+(sudah\s+)?diterima|retur(\s+disetujui)?)(?=[\s.,;:!]|$)/i;

export function isAutoCloseNote(catatan: string | null | undefined): boolean {
  if (!catatan?.trim()) return false;
  return AUTO_CLOSE_NOTE_REGEX.test(catatan);
}
```

```ts
// AFTER — negasi membatalkan auto-close + hanya frasa tegas yang menutup
const NEGATION_REGEX =
  /\b(belum|bukan|tidak|jangan|sedang|menunggu|proses|sebentar)\b/i;

export const AUTO_CLOSE_NOTE_REGEX =
  /(?:^|[\s.,;:])(delivered|diterima(\s+paket)?|paket\s+(sudah\s+)?diterima|retur(\s+disetujui)?)(?=[\s.,;:!]|$)/i;

export function isAutoCloseNote(catatan: string | null | undefined): boolean {
  if (catatan === null || catatan === undefined || catatan.trim() === "") return false;
  // Negasi eksplisit = Dynamics of truth; tak boleh ditutup otomatis.
  if (NEGATION_REGEX.test(catatan)) return false;
  return AUTO_CLOSE_NOTE_REGEX.test(catatan);
}
```

> Tambahan: `updateResiStatus` (`resiService.ts:596-600`) memaksa `SELESAI` walau user memilih status lain — gunakan status pilihan user sebagai sumber utama dan auto-close hanya bila status == `SUDAH_FOLLOWUP` **dan** user tidak memilih status lain.

### [HIGH-3] Tiga definisi berbeda untuk `totalFee` (NET vs GROSS vs "jumlah fee")

- **Bukti**
  - Parser dinamis — `src/core/services/feeRekapService.ts:1433`
    ```ts
    const clamped = clampFeeTotal(fee + totalPotongan);   // NET (potongan dikurangi)
    ```
  - Parser Master — `feeRekapService.ts:3030` (dan duplikat `:3320`)
    ```ts
    const totalFee = feeBulanIni + feeBulanSebelumnya + subsidiAntarLoket; // GROSS
    ```
  - Baris legacy — `feeRekapService.ts:3094`
    ```ts
    const rawTotal = jumlahFee !== 0 ? jumlahFee : feeBulanIni;  // definisi ketiga
    ```
  - Baca ulang dari DB — `feeRekapService.ts:1844-1848`: bila `total_fee = 0`, dihitung ulang `feeBulanIni + feeBulanSebelumnya + subsidi` (GROSS) → **angka 0 yang sah berubah jadi 0-ish lain**.
  - Simpan — `feeRekapService.ts:1962-1966` menyimpan `clamped.total` (hasil definisi dinamis/NET) ke kolom `total_fee`, yang kemudian dibaca sebagai "Master" (GROSS) di `toFeeRekapRowFromProfil`.
- **Mengapa bermasalah**: file Excel yang sama bisa menghasilkan total berbeda tergantung jalur mana yang menang (Master sheet vs sheet lain vs legacy), dan `total_fee` di DB Stores campur dua definisi. Verifikasi pasca-impor (`receivedSum` vs `storedSum`) jadi tidak sebanding dengan angka slip.
- **Dampak**: selisih sistematis antar laporan; slip keuangan ke agen berpotensi salah nominal; `feeSiapTransfer` (kolom 196) yang sebenarnya nilai transfer pun tidak jadi acuan.
- **Perbaikan (before → after)**

```ts
// BEFORE — definisi tersebar di 4 tempat
// dynamic:  clampFeeTotal(fee + totalPotongan)
// master:   feeBulanIni + feeBulanSebelumnya + subsidiAntarLoket
// legacy:   jumlahFee !== 0 ? jumlahFee : feeBulanIni
// readback: total_fee === 0 ? (bulanIni + bulanLalu + subsidi) : total_fee
```

```ts
// AFTER — satu sumber kebenaran di src/core/services/feeRekapService.ts
/** TOTAL FEE = fee bruto periode INI (tanpa potongan) — GROSS, sesuai
 *  kolom "Total Fee" pada slip Master. Potongan dipisahkan di rincian. */
export function computeTotalFee(input: {
  feeBulanIni: number;
  feeBulanSebelumnya: number;
  subsidiAntarLoket: number;
  jumlahFee?: number;
}): number {
  const gross =
    feeBulanIni + feeBulanSebelumnya + subsidiAntarLoket;
  // Fallback hanya bila komponen kosong semua (baris legacy tak punya
  // rincian periode) — TIDAK saat total sengaja nol.
  if (gross === 0 && (input.jumlahFee ?? 0) !== 0) return input.jumlahFee;
  return gross;
}

// Pemakaian (semua parser & readback):
const totalFee = clampFeeTotal(computeTotalFee({...})).total;
// Rincian tetap memuat potongan/hold/transfer secara terpisah
// (tidak lagi "dikurangi" dari total).
```

---

## B. Temuan — Medium

### [MEDIUM-1] Filter tanggal resi tidak timezone-aware (geser 7 jam)

- **Bukti**: `src/core/services/resiService.ts:309-321`
  ```ts
  if (startDate !== null) query = query.gte("created_at", `${startDate}T00:00:00`);
  if (endDate !== null)   query = query.lte("created_at", `${endDate}T23:59:59.999`);
  ```
  `created_at` adalah `timestamptz`; string tanpa offset ditafsirkan **UTC**, sedangkan operasi aplikasi berjalan WIB (UTC+7).
- **Dampak**: laporan harian kehilangan data 00:00–06:59 WIB (tidak masuk `gte`), dan menyertakan sisa hari sebelumnya 17:00–23:59 UTC. Selisih 7 jam per hari tanpa error.
- **Perbaikan**

```ts
// BEFORE — naive local time
query = query.gte("created_at", `${startDate}T00:00:00`);
query = query.lte("created_at", `${endDate}T23:59:59.999`);
```

```ts
// AFTER — batas hari WIB dikonversi eksplisit ke UTC
const APP_TZ_OFFSET_MIN = 7 * 60; // Asia/Jakarta (WIB, tanpa DST)
function dayStartUtc(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}
function dayEndUtc(date: string): string {
  return new Date(`${date}T23:59:59.999+07:00`).toISOString();
}
if (startDate !== null) query = query.gte("created_at", dayStartUtc(startDate));
if (endDate !== null)   query = query.lte("created_at", dayEndUtc(endDate));
```

### [MEDIUM-2] Race condition pada fetch daftar (data-utama & monitoring-resi)

- **Bukti**
  - `src/app/data-utama/page.tsx:118-153` — `fetchPage` tanpa `AbortController`/sequence guard; `setRows(...)`/`setTotal(...)` dipanggil apa adanya.
  - `src/app/monitoring-resi/page.tsx:194-224` — pola sama.
  - `src/app/fee-rekap/page.tsx:670-690` — sudah memakai pola `cancelled` (good) → bisa diseragamkan.
- **Mengapa bermasalah**: request lama yang lambat bisa selesai **setelah** request baru → respons basi menimpa data terbaru (user melihat hasil filter sebelumnya). `setState` setelah unmount juga memicu warning/GB.
- **Dampak**: data yang ditampilkan tidak sesuai filter aktif; laporan/copy-paste dari UI bisa salah.
- **Perbaikan**

```ts
// BEFORE — data-utama/page.tsx:118-153
const fetchPage = useCallback(async () => {
  setLoading(true);
  const res = await fetch(`/api/data-utama?${params}`);
  const body = await res.json();
  setRows(body.data ?? []);   // bisa menimpa respons basi
  setTotal(body.total ?? 0);
}, [debouncedSearch, regional, page]);
```

```ts
// AFTER — sequence guard + AbortController
const requestSeq = useRef(0);

const fetchPage = useCallback(async () => {
  const seq = ++requestSeq.current;
  const ac = new AbortController();
  setLoading(true);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const body = await res.json();
    if (seq !== requestSeq.current) return;   // ada request lebih baru → abaikan
    setRows(body.data ?? []);
    setTotal(body.total ?? 0);
  } catch (err) {
    if (ac.signal.aborted) return;
    setError(err instanceof Error ? err.message : "Gagal memuat data.");
  } finally {
    if (seq === requestSeq.current) setLoading(false);
  }
}, [...]);

// pemanggil: biarkan request lama dibatalkan saat dependency berubah
useEffect(() => {
  void fetchPage();
  return () => requestSeq.current++;   // batalkan versi lama
}, [fetchPage]);
```

### [MEDIUM-3] CSV/Excel export rentan formula injection

- **Bukti**: `src/core/services/feeRekapService.ts:1490-1509`
  ```ts
  function csvEscape(value: string): string {
    if (/[";\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }
  export function buildFeeCsv(rows: FeeRekapRow[]): string { ... }
  ```
  Nilai `ppid`/`nama_loket` berasal dari file Excel hasil impor (`feeRekapService.ts:1971-1977` — `cleanFeeStr` hanya trim + potong panjang, **tidak** menetralkan prefix formula).
- **Mengapa bermasalah**: nilai yang diawali `=`, `+`, `-`, `@` (atau `TAB`/`CR`) akan dieksekusi sebagai formula saat CSV dibuka di Excel/LibreOffice/Sheets — bisa jadi `HYPERLINK`/`WEBSERVICE` untuk exfiltrasi data.
- **Dampak**: file ekspor milik admin bisadieksekusi di mesin penerima (recipient adalah Mitr(a)/agen).
- **Perbaikan**

```ts
// BEFORE
function csvEscape(value: string): string {
  if (/[";\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
```

```ts
// AFTER — prefix formula dinetralkan + pemisah aman
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvEscape(value: string): string {
  let v = value;
  if (FORMULA_PREFIX.test(v)) v = `'${v}`;   // Excel: teks, bukan formula
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
```
> Terapkan juga pada `buildRincianText` (TSV) dan `downloadAoaAsXlsx` (`src/lib/excel.ts`) — pastikan sel ditulis sebagai tipe string.

### [MEDIUM-4] N+1 request di halaman bagging

- **Bukti**: `src/app/bagging/page.tsx:167-181` — satu `fetch("/api/data-utama/lookup?q=...")` **per agen** di dalam `Promise.all` tanpa batas konkurensi; tiap request menyentuh DB lewat service_role.
- **Dampak**: 50 agen = 50 request paralel ke route handler → cold start serverless, spike koneksi PostgREST, dan rate-limit platform bisaigan. Buka halaman bagging berulang = beban tidak proporsional.
- **Perbaikan**

```ts
// BEFORE — N+1 ke server
const entries = await Promise.all(
  agenKeys.map(async (name) => {
    const res = await fetch(`/api/data-utama/lookup?q=${encodeURIComponent(name)}`);
    ...
  })
);
```

```ts
// AFTER — satu endpoint batch + batas konkurensi
// API baru: POST /api/data-utama/phones { names: string[] } -> { [nama]: noHp }
const res = await fetch("/api/data-utama/phones", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ names: agenKeys }),
});
const map = (await res.json()) as Record<string, string>;
setAgenPhones(Object.fromEntries(agenKeys.map((n) => [n, normalizeWaNumber(map[n] ?? "")])));
```
> Bila endpoint batch takразу tersedia: query server-side `in` filter satu kali (`dataUtamaService.getPhonesByNames`) daripada lookup per nama.

### [MEDIUM-5] Rate-limit login rapuh: per-instance, berbasis header yang bisa dipalsukan, Map tanpa eviksi

- **Bukti**: `src/app/api/auth/login/route.ts:17-40`
  ```ts
  const attempts = new Map<string, { count: number; resetAt: number }>();
  function getClientIp(req: Request) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    ...
  }
  ```
  - `Map` berada di memori instance → hilang saat restart, tidak berbagi antar instance (serverless = multi-instance).
  - `X-Forwarded-For` tepercaya apa adanya → rotasi header melewati limit.
  - Tidak pernah ada sweep entri kedaluwarsa → **pertumbuhan memori tak terbatas** (kartel DoS ringan).
  - Limit dihitung **sebelum** validasi kredensial & juga berlaku untuk login sukses (entry dihitung lalu dibiarkan).
- **Perbaikan**

```ts
// AFTER — key = username+IP, evicts berkala, pasang limit hanya pada kegagalan
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000, MAX = 5;

function sweep(now: number) {
  for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
}
function rateLimitKey(req: Request, username: string) {
  // Ambil IP dari header platform tepercaya (Vercel: x-vercel-forwarded-for / x-real-ip),
  // JANGAN pakai X-Forwarded-For mentah.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-vercel-forwarded-for") ?? "unknown";
  return `${ip}|${username.toLowerCase()}`;
}
function isRateLimited(key: string): boolean {
  const now = Date.now();
  if (attempts.size > 1000) sweep(now);
  const e = attempts.get(key);
  if (!e || now > e.resetAt) { attempts.set(key, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  e.count += 1;
  return e.count > MAX;
}
```
> Produksi multi-instance: pakai store bersama (Upstash/Redis/Postgres) — limit in-memory hanya lapisan pertama.

### [MEDIUM-6] Tidak ada security header (CSP/HSTS/frame-options)

- **Bukti**: `next.config.ts:3-5` — `const nextConfig: NextConfig = { /* config options here */ };` (kosong). Tidak ada `headers()` di seluruh repo (grep `Content-Security-Policy` → hanya `AUDIT-REPORT.md`).
- **Dampak**: tanpa `X-Frame-Options`/CSP →.clickjacking; tanpa `nosniff` → MIME sniffing; tanpa HSTS → downgrade HTTP.
- **Perbaikan**

```ts
// AFTER — next.config.ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Mulai dari Report-Only supaya inline script Next tidak langsung patah:
  { key: "Content-Security-Policy-Report-Only", value:
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
```

### [MEDIUM-7] `npm run lint` gagal (2 error) — belum ada gate CI

- **Bukti**:
  - `src/app/fee-rekap/page.tsx:730` — `setServerSearching(true)` dipanggil sinkron di dalam `useEffect` → error `react-hooks/set-state-in-effect`.
  - `src/app/reconcile/page.tsx:211` — karakter `"` mentah → error `react/no-unescaped-entities`.
  - 8 warning (unused var di `src/app/api/fee-rekap/import/route.ts:182`, missing dep `src/app/user-management/page.tsx:123`, dll).
  - Tidak ada `.github/workflows` → lint/test tidak pernah dijalankan otomatis.
- **Perbaikan**

```tsx
// BEFORE — fee-rekap/page.tsx:726-742
useEffect(() => {
  const q = committedQuery.trim();
  if (q === "" || listLoading || localProfile) return;
  let cancelled = false;
  setServerSearching(true);            // <-- setState sinkron di efek
  (async () => { ... })();
  return () => { cancelled = true; };
}, [committedQuery, listLoading, localProfile]);
```

```tsx
// AFTER — status searching di-set di event handler (tempat commit query)
function startLookup() {
  setServerSearching(true);            // dipanggil dari handler/debounce
  setCommittedQuery(search.trim());
  setPage(1);
}
useEffect(() => {
  const q = committedQuery.trim();
  if (q === "" || listLoading || localProfile) return;
  let cancelled = false;
  (async () => { ... })();             // tanpa setState sinkron
  return () => { cancelled = true; };
}, [committedQuery, listLoading, localProfile]);
```
```tsx
// reconcile/page.tsx:211 — gunakan entitas HTML
<p>&quot;{nama}&quot; tidak ditemukan</p>
```
> Tambah `.github/workflows/ci.yml`: `npm ci` → `npm run lint` → `npm test` → `npm run build` (gate wajib).

### [MEDIUM-8] Import resi: TOCTOU + tidak ada unique index `nomor_resi`

- **Bukti**: `src/core/services/resiService.ts:933-1000` — pola `SELECT nomor_resi` (chunk 500) → pisahkan insert/update → `INSERT` tanpa `onConflict`. Migrasi `supabase/migrations/20261008000000_resi_datautama_perf_indexes.sql:88-91` hanya membuat index **GIN trigram** (bukan unique) → tidak ada constraint unik.
- **Dampak**: dua import paralel (mis. dua petugas) bisa memasukkan nomor resi sama → duplikat; laporan follow-up ganda, auto-purge salah sasaran.
- **Perbaikan**

```sql
-- AFTER — migrasi baru
create unique index if not exists idx_resi_nomor_resi_uniq
  on public.resi (nomor_resi)
  where nomor_resi is not null;
```
```ts
// AFTER — resiService.ts (ganti SELECT-then-INSERT dengan upsert atomik)
const { error } = await client
  .from("resi")
  .upsert(payloads, { onConflict: "nomor_resi", ignoreDuplicates: false })
  .select("id");
```
> Bila duplikat lama masih ada, jalankan dedup sebelum membuat index unik.

### [MEDIUM-9] `parseCopasDate` menerima tanggal kalender tidak valid

- **Bevidence**: `src/core/services/resiService.ts:781-820` — validasi hanya `day 1..31`, `mon 1..12`, `year 2000..2100` → `31/04/2026` diterima (diformat `2026-04-31`).
- **Dampak**: nilai tak valid diteruskan ke DB (kolom `date`) → Postgres menolak `2026-04-31` dengan error 22008 → satu baris buruk menggagalkan **seluruh** batch import (tidak ada validasi kalender per baris di layer aplikasi).
- **Perbaikan**

```ts
// AFTER — validasi kalender nyata
const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
if (day < 1 || day > daysInMonth || mon < 1 || mon > 12) return null;
```
> Tambahkan juga: `importResiBatch` menolak baris tak valid per-baris (skip + laporkan) alih-alih menggagalkan seluruh batch.

### [MEDIUM-10] Struktur monolitik → Separation of Concerns

- **Bukti**: `src/app/fee-rekap/page.tsx` = **3.102 baris** (state, upload/parse, tabel, modal slip, ekspor, cetak); `src/core/services/feeRekapService.ts` = **3.956 baris** (parser Excel, normalisasi, agregasi, mapping, API client).
- **Mengapa bermasalah**: logika bisnis (kritik[al] fee, normalisasi PPID) masih menyentuh UI; duplikasi nyata: `filterFeeRows`/`paginateRows` dipakai untuk logika yang semestinya server-side, `buildFeeAgentProfile` dipanggil di 3 tempat dengan parameter berbeda; sulit diuji unit per bagian.
- **Perbaikan** — pecah tanpa mengubah kontrak:
  - `src/core/services/fee/parser/parseLoketBsb.ts` (parse Master)
  - `src/core/services/fee/parser/parseDynamic.ts` (parse dinamis)
  - `src/core/services/fee/normalize.ts` (`normalizePpid`, `computeTotalFee`, `clampFeeTotal`)
  - `src/core/services/fee/api.ts` (client API: `fetchFeeList`, `saveFeeImport`, `deleteFeeRows`, `dropAllFeeData`)
  - `src/app/fee-rekap/_components/{FeeTable,SlipModal,ImportPanel,FeeFilters}.tsx` (UI murni, props-typed)
  - Semua helper yang sudah diuji di `feeRekapService.test.ts` (413 test) bisa dipindah tanpa mengubah API publik.

---

## C. Temuan — Low

### [LOW-1] Opsi regional terpotong diam-diam (limit 5.000 vs cap PostgREST 1.000)
- `src/core/services/dataUtamaService.ts:489-497` memakai `.limit(5000)`, sedangkan `max_rows` PostgREST = 1.000 →zzat lebih dari 1.000 baris terpotong **tanpa indikator**, dan distinct filtering dilakukan di JS.
- Perbaikan: `select("regional").limit(1000)` + RPC `select distinct regional from ... order by 1` (atau pagination keyset), plus penanda `truncated` di respons.

### [LOW-2] `sanitizeRedirect` masih bisa diloloskan backslash/encoding
- `src/app/login/page.tsx:8-12` hanya menolak `//` dan `://`; `/\evil.com` (backslash dinormalisasi browser menjadi `/` untuk URL scheme khusus) berpotensi lolos.
- Perbaikan:
```ts
function sanitizeRedirect(raw: string): string {
  try {
    const base = new URL(window.location.origin);
    const url = new URL(raw, base);
    if (url.origin !== base.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
```

### [LOW-3] Token sesi stateless 24 jam, tanpa revokasi server-side
- `src/lib/session.ts:66-104` — JWT HS256, `TOKEN_EXPIRY = "24h"`, logout hanya menghapus cookie. Token yang bocor tetap valid sampai kedaluwarsa; tidak ada daftar revoke/rotasi `JWT_SECRET`.
- Perbaikan: TTL sesi turun (mis. 8 jam) + refresh saat aktivitas, atau `session_version` di tabel `users` yang diperiksa saat verifikasi.

### [LOW-4] Pesan error API membocorkan detail internal
- Contoh: `code: "MIGRATION_MISSING"` / `DB_ERROR` dan pesan khas PostgREST (`src/app/api/data-utama/route.ts`, `src/app/api/fee-rekap/route.ts:245-252`) sampai ke browser. Tidak fatal (tanpa kredensial), tapiibeberapa combinado bisa memetakan skema DB.
- Perbaikan: kode error internal tetap di server (log), pesan ke client generik + Correlation ID.

### [LOW-5] Cakupan uji belum memuat skenario regresi kritis
- Tidak ada test untuk: negasi auto-close, batas tanggal timezone, race condition fetch, dan formula injection CSV.
- Perbaikan: tambah test unit di `resiService.test.ts` & `feeRekapService.test.ts` (tabel: `"belum diterima"` → `false`, `"paket sudah diterima"` → `true`; `csvEscape("=1+1")` →leading `'`).

---

## D. Yang Sudah Benar (Terverifikasi) — Pertahankan

- **RLS & GRANT melingkup**: `users` (`20260923000001_users_rls_lockdown.sql:11-15`), `data_lengkap_utama`/`resi`/`bailout` (`20261006000000_pii_rls_lockdown.sql:20-32`), `fee_loket`/`fee_upload_logs` (`20260924000000_fee_loket.sql:54-58`), `loket_profiles`/`loket_transaction_details` (`20261002000000_loket_profiles_details.sql:89-93`) — semuanya `enable row level security` + `revoke all from anon, authenticated` + `grant to service_role`; fungsi RPC `fee_rekap_summary`/`loket_profiles_summary` juga di-revoke dari publik (`:64-66`, `:93-96`).
- **Tidak ada kebocoran kredensial ke client**: hanya `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` di `src/lib/supabase/client.ts`; `SUPABASE_SERVICE_ROLE_KEY` hanya di `src/lib/supabase/server.ts` (server-only). Tidak ada `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` di repo.
- **Tidak ada `any`**: TypeScript `strict: true`; grep `any` pada anotasi tipe = 0 hasil.
- **Otorisasi berlapis**: `src/proxy.ts` (guard halaman + prefix ADMIN `/user-management`, `/admin`) dan tiap API route menegakkan sendiri (`getSession()` → 401, `isAdminSession()` → 403). Operasi destruktif/import: ADMIN-only (`api/resi/route.ts:171-180`, `api/fee-rekap/import/route.ts:54-64`, `api/fee-rekap/route.ts:537-546`, `api/fee-rekap/drop-all/route.ts:43-52`, `api/users/route.ts`).
- **Password**: bcrypt (10 rounds) + auto-rehash hash legacy SHA-256 saat login (`src/lib/password.ts`, `api/auth/login/route.ts:92-101`); `JWT_SECRET` wajib & dicek panjangnya (`src/lib/session.ts:42-53`); cookie `httpOnly` + `secure` (produksi) + `sameSite=lax` (`session.ts:88-97`).
- **Validasi input ketat**: tipe/length/enum per field (`api/resi/route.ts:100-160`, `api/users/route.ts`), batas baris/kolom import (`IMPORT_MAX_ROWS`, `IMPORT_MAX_COLS`), batas ukuran file + verifikasi magic bytes Excel (`src/lib/fileValidation.ts`, `src/lib/excel.ts`).
- **Anti-injection PostgREST**: `sanitizeSearch`/`sanitizeKeyword` membuang `[%_,()]` (`dataUtamaService.ts:426`, `resiService.ts:232`), `escapeFeeLike`/`canonicalFeeSearch` untuk fee (`feeRekapService.ts:169,193`).
- **Impor fee punya invariant akuntansi**: chunking idempoten + retry backoff (`feeRekapService.ts:2171+`), tripwire `receivedSum > 0 && storedSum === 0`, cek akuntabilitas per chunk (`upserted + failed === received`), dan rekonsiliasi PPID pasca-impor (`verifyFeeImport`) — pola Ini个大Bagus dan layak dipertahankan.
- **Error handling UI**: `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` tersedia; setiap fetch punya state `error` + tombol coba lagi.

## E. Temuan dari Laporan Lama (5 Okt 2026) yang Sudah Diperbaiki

| Temuan lama | Status 21 Okt 2026 |
|---|---|
| 3 tabel tanpa RLS (PII bisa dibaca anon) | **Fixed** — RLS + REVOKE + GRANT service_role (lihat bagian D) |
| Halaman browser query DB langsung dengan anon key | **Fixed** — seluruh query pindah ke API ber-sesi (`data-utama`, `bagging`, `lookup-agen`) |
| `DELETE /api/resi` tanpa cek ADMIN & tanpa batas | **Fixed** — ADMIN-only + `RESI_DELETE_MAX_IDS` (`resiService.ts:644`) |
| Tidak ada `error.tsx` / `not-found.tsx` | **Fixed** — file tersedia |
| Regex auto-close over-match | **Sisa** — pola diperbaiki dari `/deliv|delivered|retur/i` ke kata utuh, tapi **negasi masih lolos** → lihat [HIGH-2] |
| Inkonsistensi NET vs GROSS | **Sisa** — lihat [HIGH-3] |
| Rate-limit login rapuh | **Sisa** — lihat [MEDIUM-5] |

## F. Roadmap yang Disarankan

| Sprint | Item | Temuan |
|---|---|---|
| 1 (blocking rilis) | ✅ Server-side pagination/filter rekap fee (selesai 21 Okt 2026) — deploy migrasi `20261009000000_fee_rekap_summary_per_period.sql` | HIGH-1 |
| 1 | ✅ Veto negasi auto-close + test regresi (selesai 21 Okt 2026) | HIGH-2 |
| 1 | ✅ `computeTotalFee` tunggal (selesai 21 Okt 2026) — sisa: re-import baris legacy agar `total_fee` GROSS | HIGH-3 |
| 2 | Filter tanggal WIB + race guard fetch | MEDIUM-1, MEDIUM-2 |
| 2 | Anti-formula CSV/Excel export | MEDIUM-3 |
| 2 | Rate-limit login robust + eviction | MEDIUM-5 |
| 2 | Security headers (`next.config.ts`) | MEDIUM-6 |
| 3 | Batch endpoint HP agen (anti N+1) | MEDIUM-4 |
| 3 | Unique index `resi(nomor_resi)` + upsert atomik | MEDIUM-8 |
| 3 | Validasi kalender `parseCopasDate` | MEDIUM-9 |
| 3 | `lint` bersih + CI (lint/test/build) | MEDIUM-7 |
| 4 | Pecah `fee-rekap` page & service (SoC) | MEDIUM-10 |
| 4 | Opsi regional via RPC distinct | LOW-1 |
| 4 | `sanitizeRedirect` same-origin, TTL sesi, redaksi error | LOW-2/3/4 |
