-- Migration: audit trail eksekusi Reconcile Validator.
--
-- Setiap validasi yang selesai dicatat oleh API server (service_role) agar
-- ada rekam jejak operasional: siapa, file apa, hash isi file, dan hasil
-- ringkasannya.
--
-- user_id sengaja TANPA foreign key agar riwayat audit tidak hilang saat
-- akun user dihapus. Aplikasi tetap menyimpan UUID asli user saat run dibuat.

CREATE TABLE IF NOT EXISTS public.reconcile_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL
    CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_sha256 text NOT NULL
    CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  valid_rows integer NOT NULL CHECK (valid_rows >= 0),
  invalid_rows integer NOT NULL CHECK (invalid_rows >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconcile_runs_count_check
    CHECK (total_rows = valid_rows + invalid_rows)
);

COMMENT ON TABLE public.reconcile_runs IS
  'Audit trail hasil Reconcile Validator (client-reported, dikaitkan ke file hash).';

CREATE INDEX IF NOT EXISTS reconcile_runs_created_at_idx
  ON public.reconcile_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS reconcile_runs_user_created_idx
  ON public.reconcile_runs (user_id, created_at DESC);

ALTER TABLE public.reconcile_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reconcile_runs FROM anon, authenticated;
GRANT ALL ON public.reconcile_runs TO service_role;
GRANT ALL ON public.reconcile_runs TO postgres;

-- Best-effort: hapus policy publik umum bila tabel pernah dibuat manual.
DROP POLICY IF EXISTS "Allow all" ON public.reconcile_runs;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.reconcile_runs;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.reconcile_runs;
DROP POLICY IF EXISTS "Allow public read access" ON public.reconcile_runs;
DROP POLICY IF EXISTS "Public read access" ON public.reconcile_runs;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.reconcile_runs;
