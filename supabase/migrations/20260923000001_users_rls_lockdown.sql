-- Migration: kunci tabel public.users dari akses anon/authenticated.
--
-- Temuan: RLS nonaktif/kebijakan longgar membuat SELECT anon atas tabel
-- users BERHASIL (hash password terbaca publik). Migrasi ini:
-- 1. Mengaktifkan RLS (tanpa policy baca untuk anon/authenticated).
-- 2. Mencabut GRANT anon/authenticated + memberi ke service_role/postgres.
-- 3. Best-effort menghapus policy publik umum (IF EXISTS = aman bila absen).
-- Aplikasi v2 SELALU mengakses users via service_role (API routes),
-- sehingga tidak ada fungsionalitas yang hilang. Tanpa data dihapus.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.users FROM anon, authenticated;
GRANT ALL ON public.users TO service_role;
GRANT ALL ON public.users TO postgres;

-- Best-effort: hapus policy publik yang umum dipakai template.
DROP POLICY IF EXISTS "Allow all" ON public.users;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Allow public read access" ON public.users;
DROP POLICY IF EXISTS "Public read access" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.users;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.users;
