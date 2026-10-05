-- Migration: kunci tabel public.data_lengkap_utama, public.resi, dan
-- public.bailout dari akses anon/authenticated.
--
-- Temuan (AUDIT-REPORT.md KRITIS-1): ketiga tabel ini tidak memiliki
-- ENABLE ROW LEVEL SECURITY di migrasi mana pun, sehingga kunci anon
-- publik + URL proyek cukup untuk membaca seluruh isinya tanpa login —
-- termasuk PII sensitif di data_lengkap_utama (no_ktp, no_npwp,
-- nomor_rekening, alamat, no_hp, email). Migrasi ini:
-- 1. Mengaktifkan RLS (tanpa policy baca untuk anon/authenticated).
-- 2. Mencabut GRANT anon/authenticated + memberi ke service_role/postgres.
-- 3. Best-effort menghapus policy publik umum (IF EXISTS = aman bila absen).
-- Pola identik dengan 20260923000001_users_rls_lockdown.sql dan
-- 20260924000000_fee_loket.sql. Tanpa data dihapus.
--
-- PERHATIAN: setelah migrasi ini, query browser langsung via anon key
-- (src/app/data-utama/page.tsx, src/app/lookup-agen/page.tsx,
-- src/app/bagging/page.tsx) akan DITOLAK (RLS) sampai dipindahkan ke
-- API route ber-sesi (service_role). Lihat AUDIT-REPORT.md R1.

ALTER TABLE public.data_lengkap_utama ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bailout ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.data_lengkap_utama FROM anon, authenticated;
REVOKE ALL ON public.resi FROM anon, authenticated;
REVOKE ALL ON public.bailout FROM anon, authenticated;
GRANT ALL ON public.data_lengkap_utama TO service_role;
GRANT ALL ON public.data_lengkap_utama TO postgres;
GRANT ALL ON public.resi TO service_role;
GRANT ALL ON public.resi TO postgres;
GRANT ALL ON public.bailout TO service_role;
GRANT ALL ON public.bailout TO postgres;

-- Best-effort: hapus policy publik yang umum dipakai template.
DROP POLICY IF EXISTS "Allow all" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Allow public read access" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Public read access" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.data_lengkap_utama;
DROP POLICY IF EXISTS "Allow all" ON public.resi;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.resi;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.resi;
DROP POLICY IF EXISTS "Allow public read access" ON public.resi;
DROP POLICY IF EXISTS "Public read access" ON public.resi;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.resi;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.resi;
DROP POLICY IF EXISTS "Allow all" ON public.bailout;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.bailout;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.bailout;
DROP POLICY IF EXISTS "Allow public read access" ON public.bailout;
DROP POLICY IF EXISTS "Public read access" ON public.bailout;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.bailout;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.bailout;
