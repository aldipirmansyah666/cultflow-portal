-- Migration: retensi otomatis riwayat Reconcile + usulan prefix.
--
-- Sumber data:
--   reconcile_runs             — audit operasional, disimpan 30 hari.
--   product_prefix_suggestions — pending/rejected 30 hari, approved 365 hari.
--
-- Catatan: approval juga menulis ke product_prefixes (migrasi berikutnya).
-- Baris master tidak ikut dibersihkan oleh retensi ini; prefix yang sudah
-- disetujui tetap aktif walau baris usulannya sudah dihapus.
--
-- Pembersihan berjalan dua lapis:
--   1. API audit memanggil prune_reconcile_history() setelah insert run
--      (sekali per validasi, tanpa mengubah jalur insert utama).
--   2. pg_cron harian bila extension tersedia. Bila pg_cron tidak tersedia,
--      cleanup saat insert baru tetap menjaga tabel tetap ramping.

CREATE INDEX IF NOT EXISTS product_prefix_suggestions_updated_at_idx
  ON public.product_prefix_suggestions (updated_at);

CREATE OR REPLACE FUNCTION public.prune_reconcile_history(
  p_run_retention_days integer DEFAULT 30,
  p_suggestion_retention_days integer DEFAULT 30,
  p_approved_retention_days integer DEFAULT 365
)
RETURNS TABLE (
  deleted_reconcile_runs integer,
  deleted_prefix_suggestions integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_runs integer := 0;
  v_deleted_suggestions integer := 0;
BEGIN
  IF p_run_retention_days < 1 OR p_run_retention_days > 3650
    OR p_suggestion_retention_days < 1 OR p_suggestion_retention_days > 3650
    OR p_approved_retention_days < 1 OR p_approved_retention_days > 3650 THEN
    RAISE EXCEPTION 'retensi harus di antara 1 dan 3650 hari';
  END IF;

  DELETE FROM public.reconcile_runs
  WHERE created_at < now() - make_interval(days => p_run_retention_days);
  GET DIAGNOSTICS v_deleted_runs = ROW_COUNT;

  DELETE FROM public.product_prefix_suggestions
  WHERE
    (
      status = 'approved'
      AND updated_at < now() - make_interval(days => p_approved_retention_days)
    )
    OR (
      status IN ('pending', 'rejected')
      AND updated_at < now() - make_interval(days => p_suggestion_retention_days)
    );
  GET DIAGNOSTICS v_deleted_suggestions = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_runs, v_deleted_suggestions;
END;
$$;

COMMENT ON FUNCTION public.prune_reconcile_history(integer, integer, integer) IS
  'Hapus audit Reconcile dan usulan prefix yang melewati masa retensi.';

-- Aktifkan pg_cron bila tersedia. Kegagalan extension tidak menggagalkan
-- migration karena cleanup pasca-insert API tetap menjadi fallback.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron tidak dapat diaktifkan: %', SQLERRM;
    END;
  END IF;
END;
$$;

-- Jadwalkan harian; unschedule dulu agar migration idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    BEGIN
      EXECUTE 'GRANT USAGE ON SCHEMA cron TO postgres';
      EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres';

      IF EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'prune-reconcile-history'
      ) THEN
        PERFORM cron.unschedule('prune-reconcile-history');
      END IF;
      PERFORM cron.schedule(
        'prune-reconcile-history',
        '20 2 * * *',
        'SELECT public.prune_reconcile_history();'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Gagal menjadwalkan prune-reconcile-history: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron tidak tersedia; cleanup mengandalkan API pasca-insert.';
  END IF;
END;
$$;
