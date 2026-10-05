# Laporan Audit Komprehensif: kurlog-portal-v2

> Tanggal audit: 5 Oktober 2026 · Metode: seluruh temuan diverifikasi dengan membaca file langsung (`read`/`grep`, subagen read-only). Setiap temuan mencantumkan bukti `path:baris`. Stack: Next.js 16 + React 19 + Supabase + Tailwind v4 + exceljs (migrasi dari `xlsx`).

## Ringkasan Eksekutif

**Status kesehatan kode: 6/10 — fungsional tapi belum siap produksi tanpa perbaikan keamanan.**

| Area | Nilai | Kesimpulan |
|---|---|---|
| Keamanan & Database | 4/10 | 3 dari 8 tabel tanpa RLS + halaman browser query langsung via anon key = PII dapat dibaca publik tanpa login |
| Logika bisnis | 6/10 | Perhitungan fee/resi umumnya benar (integer + clamp + audit), tapi ada inkonsistensi NET-vs-GROSS antar parser, auto-close resi over-match, dan aturan tanggal tanpa timezone |
| Kualitas & performa React | 7/10 | Tidak ada memory leak / prop drilling; minus: tanpa `error.tsx` sama sekali, `catch` kosong menelan error sesi, halaman raksasa full-client |

**5 hal yang harus diperbaiki sebelum rilis (urutan prioritas):**

1. Nyalakan RLS + REVOKE untuk `data_lengkap_utama`, `resi`, `bailout` (atau pindahkan query browser ke API ber-sesi).
2. Kunci `DELETE /api/resi` ke ADMIN + beri batas `ids[]` (saat ini USER biasa bisa hapus massal tanpa batas).
3. Perbaiki/konfirmasi makna `totalFee` NET-vs-GROSS antar jalur parser fee.
4. Perketat regex auto-close resi + tambah konfirmasi eksplisit (catatan "belum deliv" ikut menutup resi hari ini).
5. Tambah `error.tsx` / `global-error.tsx` / `not-found.tsx` (saat ini crash = halaman blank).

---

## A. Temuan Kritis / Bug Potensial

### A1. Keamanan & Database

**[KRITIS-1] Tiga tabel tanpa RLS, salah satunya berisi PII (KTP/NPWP/rekening)**

- Bukti: `supabase/migrations/20260921000000_init_schema.sql:10` (`data_lengkap_utama`), `:106` (`resi`), `:123` (`bailout`) — tidak ada `ENABLE ROW LEVEL SECURITY` di file mana pun (terverifikasi via `grep`; hanya 5 tabel lain yang punya: `users` di `20260923000001_users_rls_lockdown.sql:11`, `fee_loket`+`fee_upload_logs` di `20260924000000_fee_loket.sql:54-55`, `loket_profiles`+`loket_transaction_details` di `20261002000000_loket_profiles_details.sql:89-90`). `CREATE POLICY`: nol di seluruh migrasi.
- Dampak: dengan RLS mati, kunci anon publik + URL proyek cukup untuk membaca seluruh NIK (`no_ktp`), NPWP, nomor rekening, alamat, HP, email (`init_schema.sql:26-56`) tanpa login.

**[KRITIS-2] Halaman browser query DB langsung dengan anon key, melewati sesi/role API**

- Bukti: `src/app/data-utama/page.tsx:122-123,156` (`getSupabaseBrowser()` + `getDataUtamaList`), `src/app/lookup-agen/page.tsx:121,161`, `src/app/bagging/page.tsx:176`.
- Dampak: gabungan dengan KRITIS-1 = eksposur publik riil, bukan teoretis. Otorisasi hanya hidup di application layer (`getSupabaseAdmin()` di semua API route — benar, tapi satu route lupa cek = akses penuh).

**[HIGH-1] `DELETE /api/resi` boleh dilakukan role USER mana pun, tanpa batas jumlah**

- Bukti: `src/app/api/resi/route.ts:168-172` (cek `getSession()` saja, tanpa `isAdminSession`); `route.ts:187-197` (`ids[]` tanpa cap). Bandingkan `DELETE /api/fee-rekap` yang ADMIN-only (`src/app/api/fee-rekap/route.ts:440-450`). Service punya `RESI_DELETE_MAX_IDS=2000` (`src/core/services/resiService.ts:638`) tapi route tidak menegakkannya → 500 generik, bukan 400/413.
- Dampak: akun USER curian/rogue bisa menghapus massal data resi + import 500 baris (`route.ts:256-276` juga tanpa role check).

**[HIGH-2] Rate-limit login in-memory + IP dari header yang bisa dipalsukan**

- Bukti: `src/app/api/auth/login/route.ts:20-34` (`Map` per instance, tanpa eviksi, hilang saat restart/scale serverless); `route.ts:36-40` (`x-forwarded-for` dipercaya mentah). Tidak ada rate limit di route lain.
- Dampak: bypass trivial dengan rotasi header; Map tumbuh tak terbatas (kebocoran memori lambat).

**[MEDIUM-1] Tanpa CSRF token; satu-satunya pertahanan `SameSite=Lax`; GET ber-efek-samping**

- Bukti: `src/lib/session.ts:88-97` (`httpOnly`, `sameSite:"lax"`, `secure` hanya produksi, tanpa prefix `__Host-`); tidak ada cek `Origin/Referer` di route mutasi; `GET /api/resi` memicu hapus data (`purgeExpiredResi` fire-and-forget, `src/app/api/resi/route.ts:63-68`) — navigasi top-level cross-site mengirim cookie Lax.
- Dampak: CSRF klasik teredam Lax tapi tidak tertutup; token curian valid 24 jam penuh karena logout hanya hapus cookie (`src/app/api/auth/logout/route.ts:5-7`, tanpa revokasi server-side; `verifySessionToken` stateless di `session.ts:75-85`).

**[MEDIUM-2] Inkonsistensi cek role + JWT secret lemah tetap dipakai**

- Bukti: `src/app/api/data-utama/import/route.ts:21` (`session.role !== "ADMIN"` mentah) vs `isAdminSession()` di route lain; praktis aman karena normalisasi di `session.ts:81`, tapi rapuh. `getJwtSecret` (`session.ts:40-53`) hanya `console.warn` bila secret <32 char lalu tetap dipakai.
- Dampak: rendah saat ini; risiko regresi saat token lama/format berubah.

**[LOW] Sanitasi LIKE tidak setara standar antar service; info disclosure**

- Bukti: fee punya `escapeFeeLike` lengkap (`src/core/services/feeRekapService.ts:126-135`), sedangkan resi (`resiService.ts:228-234`) dan data-utama hanya strip `[%_,()]` tanpa escape backslash/quotes. Pesan error membocorkan nama tabel/kode mesin (`MIGRATION_MISSING`, `fee-rekap/route.ts:200-208`).

### A2. Logika Bisnis & Fitur

**[HIGH-3] `totalFee` berarti NET di parser dinamis, GROSS di parser Master**

- Bukti: `src/core/services/feeRekapService.ts:1326-1330` (`clampFeeTotal(fee + potongan)` = NET) vs `:2619-2684` (`parseLoketBsbFull`: `totalFee = feeBulanIni+feeBulanSebelumnya+subsidi` = GROSS) dan `:1643-1651`.
- Dampak: loket `fee=1jt, minus=200rb` tersimpan `800rb` via jalur dinamis tapi `1jt` via Master; `receivedSum/storedSum` tidak sebanding antar jalur; laporan keuangan bisa selisih sistematis.

**[HIGH-4] Prioritas kolom fee berbeda antar parser (absolut vs dinamis)**

- Bukti: `feeRekapService.ts:869` (`[189,191,196]`) vs `:1113` (`[191,189]`, tanpa 196 = NET siap-transfer).
- Dampak: file yang sama bisa menghasilkan angka berbeda tergantung jalur yang menang (`src/app/fee-rekap/page.tsx:909-919` fallback absolut→dinamis).

**[HIGH-5] Regex auto-close resi over-match dan meng-override pilihan user diam-diam**

- Bukti: `src/core/services/resiService.ts:126` (`/deliv|delivered|retur/i`), diterapkan di `:507-520,592-594`.
- Dampak: catatan `"belum deliv, jangan tutup"`, `"tidak ada retur"`, bahkan `"return to sender"` (mengandung `retur`) dipaksa `SUDAH_FOLLOWUP + SELESAI + closed_at` tanpa pesan. Ini bug operasional nyata, bukan edge case.

**[HIGH-6] API `upsert(onConflict:'ppid')` vs indeks parsial + CLI yang justru benar**

- Bukti: `src/core/services/dataUtamaService.ts:795` vs indeks `WHERE ppid IS NOT NULL AND ppid <> ''` (`20260923000000_align_data_lengkap_utama_v2.sql:179-181`); CLI sadar masalah ini dan upsert manual (`src/scripts/importAgenCum.ts:12-16,461-516`). Komentar API (`data-utama/import/route.ts:4`) mengklaim "UNIQUE penuh di remote" — klaim ini tidak didukung migrasi.
- Dampak: impor browser gagal `42P10` dengan pesan generik `"Impor gagal di server"`, sementara CLI sukses — membingungkan dan tampak seperti bug acak.

**[HIGH-7] Dedup PPID case-sensitive + API buang tanpa-PPID sementara CLI insert**

- Bukti: `agenCumMapper.ts:523-542` (tanpa normalisasi); `dataUtamaService.ts:781-786` (buang) vs `importAgenCum.ts:437-448` (insert).
- Dampak: `"sbpos-001"` + `"SBPOS-001"` dianggap beda → violation/duplikat; impor ulang via CLI menggandakan baris tanpa-PPID yang via UI dibuang.

**[MEDIUM-3] Filter tanggal resi naive-timezone vs dashboard yang benar (+07:00)**

- Bukti: `resiService.ts:310-315` (`00:00:00`/`23:59:59.999` tanpa zona) vs `dashboardService.ts:48-56` (dengan `+07:00`).
- Dampak: baris WIB `2026-09-22 06:00` (= `21T23:00Z`) hilang dari filter `startDate=2026-09-22`, atau sebaliknya bocor sehari.

**[MEDIUM-4] Bailout: tidak ada `Asia/Jakarta` sama sekali; H-1 pakai zona lokal + input invalid jadi "kemarin" diam-diam**

- Bukti: `bailoutMessage.ts:68-76,90-97` (local `setDate/getDay`), `bailoutParser.ts:360-361,367-371` (`toISOString` UTC); tidak ada cutoff jam — hanya teks `"sebelum pukul 09.00 WIB"` (`:120`). Input invalid jatuh ke `today-1` (`:95`) tanpa error.
- Dampak: tengah malam WIB vs UTC bisa mundur sehari (`WIB 00:30` → tanggal UTC kemarin); redaksi Senin mencetak Minggu dengan template weekday (kontraintuitif tapi by-design — wajib didokumentasikan ke user).

**[MEDIUM-5] Parser tanggal copas resi loloskan `30/02`, tahun `<2000` jadi "hari ini"**

- Bukti: `resiService.ts:775-812` (cek `1-31` saja; `null` → DB default `current_date`).
- Dampak: tanggal salah tersimpan sebagai hari ini tanpa warning; `"15/01/99"` jadi 2099.

**[MEDIUM-6] Inkonsistensi kecil tapi nyata**

- Dedup copas first-wins (parser `:862-866`) vs last-wins (service `:939-944`): preview tampil Agen A, tersimpan Agen B.
- `toAbsoluteAmount` tanpa rounding vs `parseAmount` dengan rounding (`feeRekapService.ts:313-315` vs `:1090-1107`): drift Rp1 terakumulasi.
- `parseAmount("1,000.00")` → `1` (salah 1000x, `:339-358`); desimal koma `,50` dibulatkan naik Rp1.
- `buildModuleBreakdown` `Math.round(total/lembar)` (`:2556,2564`): `1000/3=333`, `333×3=999≠1000` di slip.
- Reconcile: file hanya EC3/SHPE divonis invalid karena aturan cakupan mewajibkan `P26` juga; duplikat+prefix salah berbagi satu `code` (`reconcileValidator.ts:243-252,279-291`), filter UI kehilangan baris.
- Bagging `"Belum  Dibagging"` (2 spasi) tidak dikenali (`baggingParser.ts:126-134` vs `:40-46`); alias `"STATUS"` generik false-positive (`:52-60`).
- Dashboard `BAILOUT_SUM_LIMIT=5000` (`dashboardService.ts:27`) + `Number()||0` (`:87-100`) vs `parseAmount` fee (format `"1.500.000"` → `NaN` → 0).
- Purge `<=cutoff` vs komentar `>2 hari` (`resiService.ts:136-190`); baris `closed_at=null AND followed_up_at=null` tak pernah terpurge; setiap GET memicu delete.

### A3. Kualitas Kode & Performa

**[HIGH-8] Tanpa `error.tsx` / `global-error.tsx` / `not-found.tsx` di seluruh app**

- Bukti: `glob src/**/error.tsx` → tidak ada (terverifikasi). `layout.tsx:25` dan `page.tsx:122` tanpa pendamping; hanya `loading.tsx:16` yang ada.
- Dampak: crash RSC/client = halaman blank/digest default; user tidak bisa recover.

**[MEDIUM-7] `catch` kosong menelan kegagalan sesi di 6+ titik**

- Bukti: `LayoutShell.tsx:45-47`, `Header.tsx:105-107`, `fee-rekap/page.tsx:384-386`, `data-utama/page.tsx:160-162,180-182`, `bagging/page.tsx:182-184`, `lookup-agen/page.tsx:125-128`.
- Dampak: menu/token gagal tanpa sinyal; sulit debug; role bisa basi.

**[MEDIUM-8] Bug role mentah di data-utama + `useEffect`/`setTimeout` tanpa cleanup**

- Bukti: `data-utama/page.tsx:177` (`setRole` mentah) dicek `role==="ADMIN"` di `:327` → `"admin"` gagal buka Import (bandingkan normalisasi di `LayoutShell.tsx:43`). `setTimeout` tanpa ID di `fee-rekap/page.tsx:642`, `lookup-agen/page.tsx:196,239`, `bagging/page.tsx:161`, `bailout/page.tsx:141` → `setState` after unmount. Race suggest tanpa guard di `lookup-agen/page.tsx:116-134` (bandingkan pola `cancelled` di `fee-rekap:512-532`).
- Dampak: sedang; tidak ada memory leak kronis (`grep setInterval` kosong; semua subscription ada cleanup; fetch hanya di efek/handler — baik).

**[LOW] Lainnya (kebersihan)**

- `feeRekapService.ts` ±3115 baris god-file + mock di kode produksi; `fee-rekap/page.tsx` ±2393 baris full-client (tanpa SSR tabel awal); `globals.css:22` menimpa font Geist dari `layout.tsx:6-13`; logo Sidebar unduh 1213px untuk tampil ±100px (`Sidebar.tsx:122-129`); `next.config.ts:3-5` kosong (tanpa header keamanan/CSP); file biner 7 file (±11 MB: 2 `.xlsx` + diagram) terlacak git tanpa di-ignore.

---

## B. Rekomendasi Perbaikan (dengan snippet)

**R1 — Tutup KRITIS-1 + KRITIS-2 (migrasi baru, pola sama seperti `users_rls_lockdown`):**

```sql
-- supabase/migrations/20261006000000_pii_rls_lockdown.sql
ALTER TABLE public.data_lengkap_utama ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bailout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_lengkap_utama, public.resi, public.bailout FROM anon, authenticated;
GRANT ALL ON public.data_lengkap_utama, public.resi, public.bailout TO service_role;
GRANT ALL ON public.data_lengkap_utama, public.resi, public.bailout TO postgres;
```

Lalu pindahkan `getDataUtamaList`/`lookup-agen`/`bagging` dari `getSupabaseBrowser()` ke API route ber-sesi (pola `fee-rekap/route.ts:148`). Jika query browser harus tetap, buat `CREATE POLICY` selektif per `auth.uid()`, bukan akses service_role dari browser.

**R2 — Kunci resi (HIGH-1): tambah guard + cap di `src/app/api/resi/route.ts:168`:**

```ts
import { getSession, isAdminSession } from "@/lib/session";
import { RESI_DELETE_MAX_IDS } from "@/core/services/resiService";
const session = await getSession();
if (!session) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
if (!isAdminSession(session)) return NextResponse.json({ error: "Hanya ADMIN" }, { status: 403 });
if (list.length > RESI_DELETE_MAX_IDS) return NextResponse.json({ error: `Maksimal ${RESI_DELETE_MAX_IDS} id` }, { status: 413 });
```

Samakan `data-utama/import/route.ts:21` menjadi `if (!isAdminSession(session))`.

**R3 — Rate limit + JWT (HIGH-2, MEDIUM-1):** pindah ke store persisten (Upstash/Supabase) dengan kunci `IP+username`, hanya percaya `x-forwarded-for` dari proxy tepercaya; tolak `JWT_SECRET` <32 char (throw, bukan warn); tambah tabel `revoked_tokens(jti)` + cek di `verifySessionToken`; tambah cek `Origin/Referer` untuk mutasi; pindahkan `purgeExpiredResi` dari `GET` ke cron/endpoint ADMIN eksplisit.

**R4 — Samakan makna uang fee (HIGH-3, HIGH-4, MEDIUM-6):** tetapkan kontrak tunggal — mis. `totalFee` = NET setelah potongan; perbaiki `parseLoketBsbFull` (`feeRekapService.ts:2619`) memakai `clampFeeTotal` seperti `:1329`; samakan prioritas kolom `[189,191,196]` di kedua parser; bulatkan di satu tempat (`parseAmount`); ganti `Math.round(total/lembar)` dengan pembagian sisa (`feeDasar=floor`, sisa dialokasikan ke baris pertama) agar `lembar×fee=total` persis; validasi `total == sum(rincian)` di `toFeeDbRow`.

**R5 — Auto-close resi (HIGH-5): persempit regex + wajibkan konfirmasi:**

```ts
export const AUTO_CLOSE_NOTE_REGEX = /(^|[\s.,;:])(delivered|diterima(\s+paket)?|paket\s+(sudah\s+)?diterima|retur(\s+disetujui)?)(?=[\s.,;:!]|$)/i;
```

dan jangan override diam-diam — kembalikan `needsConfirm: true` ke klien bila auto-close terpicu, atau catat `autoClosedByRule` di respons.

**R6 — Data-utama vs CLI (HIGH-6, HIGH-7):** buat `UNIQUE(ppid)` penuh (non-parsial) bila memungkinkan, atau samakan API ke pola CLI (SELECT→UPDATE+INSERT); normalisasi PPID (`trim().toUpperCase()`, collapse spasi) sebelum `dedupeByPpid`; samakan kebijakan tanpa-PPID (buang di keduanya + laporkan `skippedNoPpid`).

**R7 — Tanggal (MEDIUM-3, MEDIUM-4, MEDIUM-5): gunakan satu helper zona:**

```ts
const dayStartWib = (d: string) => `${d}T00:00:00+07:00`;
query = query.gte("created_at", dayStartWib(startDate)).lte("created_at", `${endDate}T23:59:59.999+07:00`);
```

untuk bailout: `sanitizePeriodeOrToday` pakai `Asia/Jakarta` (`Intl.DateTimeFormat` + `timeZone`, pola yang sudah benar di `resiService.ts:393-409`), dan throw untuk input invalid alih-alih fallback kemarin. Validasi kalender nyata untuk `parseCopasDate` (tolak `30/02`, putuskan aturan tahun 2-digit secara eksplisit).

**R8 — Error boundaries + catch kosong (HIGH-8, MEDIUM-7):** tambah `src/app/error.tsx` (`"use client"` + tombol `reset()`), `global-error.tsx`, `not-found.tsx`; ganti `catch {}` dengan `console.warn("[auth/me] failed", err)` + state error terlihat; normalisasi role di `data-utama/page.tsx:177` (`setRole(body.user.role.trim().toUpperCase())`); beri `requestIdRef`/flag `cancelled` pada suggest `lookup-agen` dan cleanup `setTimeout` via `useRef`.

**R9 — Kebersihan rilis:** keluarkan 7 file biner dari git (`git rm --cached *.xlsx diagram.*` + tambahkan ke `.gitignore`, putar data PII yang terlanjur ter-push); tambah header keamanan di `next.config.ts` (CSP/HSTS/`X-Frame-Options`); pecah `feeRekapService.ts` dan halaman fee-rekap menjadi island client; netralisasi awalan `=,+,-,@` saat export Excel (CSV-formula injection).

---

## Pertanyaan klarifikasi

1. Apakah `DELETE/POST/PATCH /api/resi` memang boleh untuk USER, atau harus ADMIN seperti fee?
2. Kontrak `totalFee`: NET setelah potongan, atau GROSS komponen? Ini menentukan arah perbaikan HIGH-3.
3. Apakah aturan H-1 bailout + template weekend/weekday yang mengikuti tanggal *redaksi* (bukan tanggal cetak) sudah disepakati bisnis?
4. Target deploy (VPS Docker vs Vercel serverless)? Menentukan desain rate-limit dan `maxDuration` impor.
