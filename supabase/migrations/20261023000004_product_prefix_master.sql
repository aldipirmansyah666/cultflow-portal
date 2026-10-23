-- Migration: master prefix aktif + sinkronisasi keputusan usulan.
--
-- Validator tetap memiliki daftar prefix bawaan di TypeScript. Tabel ini
-- menyimpan prefix TAMBAHAN hasil approval admin; API akan menggabungkannya
-- saat validasi. Menolak usulan tidak menghapus baris master (jejak tetap
-- tersimpan) tetapi menonaktifkannya lewat is_active = false.

CREATE TABLE IF NOT EXISTS public.product_prefixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL
    CHECK (
      char_length(product_name) BETWEEN 1 AND 100
      AND product_name = upper(product_name)
    ),
  prefix varchar(16) NOT NULL
    CHECK (
      prefix = upper(prefix)
      AND prefix ~ '^[A-Z0-9]{2,16}$'
    ),
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'approved_suggestion'
    CHECK (source IN ('approved_suggestion', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_prefixes_product_prefix_key
    UNIQUE (product_name, prefix)
);

COMMENT ON TABLE public.product_prefixes IS
  'Prefix resi tambahan yang aktif dipakai Reconcile Validator (di luar hardcoded).';
COMMENT ON COLUMN public.product_prefixes.is_active IS
  'false = prefix tidak lagi dipakai validator; baris tetap disimpan sebagai histori.';

CREATE INDEX IF NOT EXISTS product_prefixes_active_product_idx
  ON public.product_prefixes (product_name, prefix)
  WHERE is_active;

ALTER TABLE public.product_prefixes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_prefixes FROM anon, authenticated;
GRANT ALL ON public.product_prefixes TO service_role;
GRANT ALL ON public.product_prefixes TO postgres;

-- Satu transaksi: update status usulan + sinkronkan master aktif.
-- Return jsonb baris usulan agar API bisa mengembalikan id/status terbaru.
CREATE OR REPLACE FUNCTION public.decide_product_prefix_suggestion(
  p_product_name text,
  p_suggested_prefix text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text := upper(trim(p_product_name));
  v_suggested_prefix text := upper(trim(p_suggested_prefix));
  v_row public.product_prefix_suggestions;
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'status harus approved atau rejected';
  END IF;
  IF v_product_name IS NULL OR v_product_name = ''
    OR char_length(v_product_name) > 100 THEN
    RAISE EXCEPTION 'product_name tidak valid';
  END IF;
  IF v_suggested_prefix IS NULL
    OR v_suggested_prefix !~ '^[A-Z0-9]{2,16}$' THEN
    RAISE EXCEPTION 'suggested_prefix tidak valid';
  END IF;

  UPDATE public.product_prefix_suggestions
  SET status = p_status,
      updated_at = now()
  WHERE product_name = v_product_name
    AND suggested_prefix = v_suggested_prefix
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_status = 'approved' THEN
    INSERT INTO public.product_prefixes (
      product_name,
      prefix,
      is_active,
      source
    )
    VALUES (
      v_product_name,
      v_suggested_prefix,
      true,
      'approved_suggestion'
    )
    ON CONFLICT (product_name, prefix) DO UPDATE
    SET is_active = true,
        updated_at = now();
  ELSE
    UPDATE public.product_prefixes
    SET is_active = false,
        updated_at = now()
    WHERE product_name = v_product_name
      AND prefix = v_suggested_prefix;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_product_prefix_suggestion(text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_product_prefix_suggestion(text, text, text)
  FROM anon;
REVOKE ALL ON FUNCTION public.decide_product_prefix_suggestion(text, text, text)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.decide_product_prefix_suggestion(text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_product_prefix_suggestion(text, text, text)
  TO postgres;

-- Best-effort: bersihkan policy publik umum bila tabel dibuat manual.
DROP POLICY IF EXISTS "Allow all" ON public.product_prefixes;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.product_prefixes;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.product_prefixes;
DROP POLICY IF EXISTS "Allow public read access" ON public.product_prefixes;
DROP POLICY IF EXISTS "Public read access" ON public.product_prefixes;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.product_prefixes;
