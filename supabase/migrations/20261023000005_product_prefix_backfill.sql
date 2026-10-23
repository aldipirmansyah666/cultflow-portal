-- Migration: backfill prefix approved lama ke master prefix.
--
-- Sebelum migrasi 20261023000004, approval hanya mengubah status di
-- product_prefix_suggestions. Migrasi ini memastikan semua approval lama
-- ikut aktif di product_prefixes agar unggahan berikutnya langsung valid.
-- Idempoten: aman dijalankan ulang; baris master yang sudah ada diaktifkan.

INSERT INTO public.product_prefixes (
  product_name,
  prefix,
  is_active,
  source
)
SELECT
  product_name,
  suggested_prefix,
  true,
  'approved_suggestion'
FROM public.product_prefix_suggestions
WHERE status = 'approved'
ON CONFLICT (product_name, prefix) DO UPDATE
SET is_active = true,
    updated_at = now();
