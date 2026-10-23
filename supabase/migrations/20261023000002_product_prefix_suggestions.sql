-- Migration: usulan prefix resi baru dari Reconcile Validator.
--
-- Validator mengelompokkan resi PREFIX_MISMATCH berdasarkan produk + 3
-- karakter awal resi. API server (service_role) meng-upsert kelompok itu ke
-- tabel ini; kombinasi produk + prefix bersifat unik dan occurrence_count
-- diakumulasi lintas validasi.
--
-- Status dipertahankan saat upsert: usulan yang sudah approved/rejected tidak
-- kembali menjadi pending hanya karena muncul lagi di berkas berikutnya.

CREATE TABLE IF NOT EXISTS public.product_prefix_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL
    CHECK (
      char_length(product_name) BETWEEN 1 AND 100
      AND product_name = upper(product_name)
    ),
  suggested_prefix varchar(3) NOT NULL
    CHECK (suggested_prefix ~ '^[A-Z0-9]{3}$'),
  sample_resi text,
  occurrence_count integer NOT NULL DEFAULT 1
    CHECK (occurrence_count >= 1),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_prefix_suggestions_product_prefix_key
    UNIQUE (product_name, suggested_prefix)
);

COMMENT ON TABLE public.product_prefix_suggestions IS
  'Usulan prefix resi baru dari temuan PREFIX_MISMATCH Reconcile Validator.';

COMMENT ON COLUMN public.product_prefix_suggestions.occurrence_count IS
  'Akumulasi kemunculan prefix ini lintas validasi (di-increment saat upsert).';

CREATE INDEX IF NOT EXISTS product_prefix_suggestions_status_count_idx
  ON public.product_prefix_suggestions (status, occurrence_count DESC);

ALTER TABLE public.product_prefix_suggestions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_prefix_suggestions FROM anon, authenticated;
GRANT ALL ON public.product_prefix_suggestions TO service_role;
GRANT ALL ON public.product_prefix_suggestions TO postgres;

-- Upsert batch atomik: satu panggilan RPC untuk semua usulan dari satu file.
-- Bila salah satu item invalid, seluruh transaksi dibatalkan sehingga hitungan
-- tidak pernah bertambah sebagian.
CREATE OR REPLACE FUNCTION public.record_product_prefix_suggestions(
  p_suggestions jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  processed integer := 0;
  v_product_name text;
  v_suggested_prefix text;
  v_sample_resi text;
  v_occurrence_count integer;
BEGIN
  IF p_suggestions IS NULL OR jsonb_typeof(p_suggestions) <> 'array' THEN
    RAISE EXCEPTION 'p_suggestions harus berupa array JSON';
  END IF;

  FOR item IN
    SELECT elem FROM jsonb_array_elements(p_suggestions) AS t(elem)
  LOOP
    v_product_name := upper(trim(item->>'product_name'));
    v_suggested_prefix := upper(trim(item->>'suggested_prefix'));
    v_sample_resi := nullif(trim(item->>'sample_resi'), '');
    v_occurrence_count := COALESCE((item->>'occurrence_count')::integer, 1);

    IF v_product_name IS NULL OR v_product_name = '' THEN
      RAISE EXCEPTION 'product_name wajib diisi';
    END IF;
    IF v_suggested_prefix IS NULL
      OR v_suggested_prefix !~ '^[A-Z0-9]{3}$' THEN
      RAISE EXCEPTION 'suggested_prefix harus 3 karakter alfanumerik';
    END IF;
    IF v_occurrence_count < 1 THEN
      RAISE EXCEPTION 'occurrence_count minimal 1';
    END IF;

    INSERT INTO public.product_prefix_suggestions (
      product_name,
      suggested_prefix,
      sample_resi,
      occurrence_count
    )
    VALUES (
      v_product_name,
      v_suggested_prefix,
      v_sample_resi,
      v_occurrence_count
    )
    ON CONFLICT (product_name, suggested_prefix) DO UPDATE
    SET
      occurrence_count = product_prefix_suggestions.occurrence_count
        + EXCLUDED.occurrence_count,
      sample_resi = COALESCE(
        EXCLUDED.sample_resi,
        product_prefix_suggestions.sample_resi
      ),
      updated_at = now();

    processed := processed + 1;
  END LOOP;

  RETURN processed;
END;
$$;

REVOKE ALL ON FUNCTION public.record_product_prefix_suggestions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_product_prefix_suggestions(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_product_prefix_suggestions(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_product_prefix_suggestions(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_product_prefix_suggestions(jsonb) TO postgres;

-- Best-effort: bersihkan policy publik umum bila tabel dibuat manual.
DROP POLICY IF EXISTS "Allow all" ON public.product_prefix_suggestions;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.product_prefix_suggestions;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.product_prefix_suggestions;
DROP POLICY IF EXISTS "Allow public read access" ON public.product_prefix_suggestions;
DROP POLICY IF EXISTS "Public read access" ON public.product_prefix_suggestions;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.product_prefix_suggestions;
