-- Migration: token_version untuk revokasi sesi JWT.
--
-- Setiap token membawa token_version user. Saat logout, role berubah, atau
-- password diubah, token_version dinaikkan sehingga token lama langsung
-- ditolak oleh getSession() di server.
--
-- CATATAN DEPLOY: setelah migrasi ini, token lama yang belum memiliki klaim
-- tokenVersion akan ditolak. Semua user perlu login ulang sekali.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.users.token_version IS
  'Versi sesi JWT. Dinaikkan untuk mencabut semua token lama user ini.';

-- Naikkan versi secara atomik; dipakai logout dan perubahan role/password.
CREATE OR REPLACE FUNCTION public.bump_user_token_version(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.users
     SET token_version = token_version + 1
   WHERE id = p_user_id
  RETURNING token_version;
$$;

REVOKE ALL ON FUNCTION public.bump_user_token_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_user_token_version(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_user_token_version(uuid) TO service_role;
