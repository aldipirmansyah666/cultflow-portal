-- Migration: selaraskan public.data_lengkap_utama (remote lawas) ke skema v2.
--
-- Latar: remote dibuat oleh migrasi lawas dengan nama kolom berbeda
-- (tgl_*, pos_ppob/pos_only/sicepat text, alamat_loket, kelurahan/kecamatan/
-- kab_kota, ktp/npwp, no_hp, kbli). Skema v2 (20260921000000_init_schema.sql)
-- memakai pengajuan_*, kurlog_* boolean, alamat_lengkap_loket, kel_desa/kec/
-- kab_kot, no_ktp/no_npwp, no_hp_pemilik, no_kbli + kolom dokumen/perangkat/
-- pengganti/kurir. Tanpa migrasi ini, upsert script gagal PGRST204
-- (kolom tak dikenal schema cache) untuk kolom-kolom baru.
--
-- Prinsip: idempoten, tanpa hapus data. Kolom lawas tanpa padanan v2
-- (waktu_update, no_hp, pos_ppob, pos_only, sicepat) DIPERTAHANKAN.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) Rename kolom lawas -> v2 (hanya bila lama ada & baru belum ada)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  renames text[][] := ARRAY[
    ARRAY['tgl_pengajuan_survey', 'pengajuan_survey'],
    ARRAY['tgl_pengajuan_pos', 'pengajuan_pos'],
    ARRAY['tgl_pendaftaran_kurlog', 'pendaftaran_kurlog'],
    ARRAY['tgl_kelengkapan_perangkat', 'kelengkapan_perangkat'],
    ARRAY['tgl_aktivasi_kurlog', 'aktivasi_kurlog'],
    ARRAY['tgl_aktivasi_sicepat', 'aktivasi_sicepat'],
    ARRAY['tgl_training', 'training'],
    ARRAY['tgl_transaksi', 'transaksi'],
    ARRAY['alamat_loket', 'alamat_lengkap_loket'],
    ARRAY['kelurahan', 'kel_desa'],
    ARRAY['kecamatan', 'kec'],
    ARRAY['kab_kota', 'kab_kot'],
    ARRAY['ktp', 'no_ktp'],
    ARRAY['npwp', 'no_npwp'],
    ARRAY['kbli', 'no_kbli']
  ];
  r text[];
  has_old boolean;
  has_new boolean;
BEGIN
  FOREACH r SLICE 1 IN ARRAY renames
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'data_lengkap_utama'
        AND column_name = r[1]
    ) INTO has_old;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'data_lengkap_utama'
        AND column_name = r[2]
    ) INTO has_new;
    IF has_old AND NOT has_new THEN
      EXECUTE format(
        'ALTER TABLE public.data_lengkap_utama RENAME COLUMN %I TO %I',
        r[1], r[2]
      );
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Tambah kolom v2 yang belum ada (IF NOT EXISTS = aman di semua env)
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_lengkap_utama
  ADD COLUMN IF NOT EXISTS no numeric null,
  ADD COLUMN IF NOT EXISTS status_syarat text null,
  ADD COLUMN IF NOT EXISTS pengajuan_survey text null,
  ADD COLUMN IF NOT EXISTS pengajuan_pos text null,
  ADD COLUMN IF NOT EXISTS pendaftaran_kurlog text null,
  ADD COLUMN IF NOT EXISTS kelengkapan_perangkat text null,
  ADD COLUMN IF NOT EXISTS aktivasi_kurlog text null,
  ADD COLUMN IF NOT EXISTS aktivasi_sicepat text null,
  ADD COLUMN IF NOT EXISTS training text null,
  ADD COLUMN IF NOT EXISTS transaksi text null,
  ADD COLUMN IF NOT EXISTS catatan text null,
  ADD COLUMN IF NOT EXISTS kurlog_pos_ppob boolean default false,
  ADD COLUMN IF NOT EXISTS kurlog_pos_only boolean default false,
  ADD COLUMN IF NOT EXISTS kurlog_sicepat boolean default false,
  ADD COLUMN IF NOT EXISTS ppid text null,
  ADD COLUMN IF NOT EXISTS nama_loket_onpays text null,
  ADD COLUMN IF NOT EXISTS nama_loket_kurlog text null,
  ADD COLUMN IF NOT EXISTS nama_pemilik text null,
  ADD COLUMN IF NOT EXISTS alamat_pemilik_ktp text null,
  ADD COLUMN IF NOT EXISTS alamat_lengkap_loket text null,
  ADD COLUMN IF NOT EXISTS rt_rw text null,
  ADD COLUMN IF NOT EXISTS kel_desa text null,
  ADD COLUMN IF NOT EXISTS kec text null,
  ADD COLUMN IF NOT EXISTS kab_kot text null,
  ADD COLUMN IF NOT EXISTS propinsi text null,
  ADD COLUMN IF NOT EXISTS kode_pos text null,
  ADD COLUMN IF NOT EXISTS no_ktp text null,
  ADD COLUMN IF NOT EXISTS no_npwp text null,
  ADD COLUMN IF NOT EXISTS electric_area text null,
  ADD COLUMN IF NOT EXISTS rekomendasi text null,
  ADD COLUMN IF NOT EXISTS no_hp_pemilik text null,
  ADD COLUMN IF NOT EXISTS no_hp_loket text null,
  ADD COLUMN IF NOT EXISTS email text null,
  ADD COLUMN IF NOT EXISTS no_dirian text null,
  ADD COLUMN IF NOT EXISTS location_id text null,
  ADD COLUMN IF NOT EXISTS user_mile text null,
  ADD COLUMN IF NOT EXISTS password_mile text null,
  ADD COLUMN IF NOT EXISTS regional text null,
  ADD COLUMN IF NOT EXISTS kcu_kc text null,
  ADD COLUMN IF NOT EXISTS nib text null,
  ADD COLUMN IF NOT EXISTS no_kbli text null,
  ADD COLUMN IF NOT EXISTS nomor_rekening text null,
  ADD COLUMN IF NOT EXISTS nama_bank text null,
  ADD COLUMN IF NOT EXISTS nama_pemilik_rekening text null,
  ADD COLUMN IF NOT EXISTS latitude text null,
  ADD COLUMN IF NOT EXISTS longitude text null,
  ADD COLUMN IF NOT EXISTS kelengkapan_admin_formulir text null,
  ADD COLUMN IF NOT EXISTS form_ajuan_pos text null,
  ADD COLUMN IF NOT EXISTS pks text null,
  ADD COLUMN IF NOT EXISTS doc_ktp text null,
  ADD COLUMN IF NOT EXISTS doc_npwp text null,
  ADD COLUMN IF NOT EXISTS doc_nib text null,
  ADD COLUMN IF NOT EXISTS doc_kbli text null,
  ADD COLUMN IF NOT EXISTS foto_tampak_depan_loket text null,
  ADD COLUMN IF NOT EXISTS perangkat_komputer_laptop text null,
  ADD COLUMN IF NOT EXISTS perangkat_hp_android text null,
  ADD COLUMN IF NOT EXISTS perangkat_printer_sticker text null,
  ADD COLUMN IF NOT EXISTS perangkat_timbangan_digital text null,
  ADD COLUMN IF NOT EXISTS perangkat_kertas_sticker text null,
  ADD COLUMN IF NOT EXISTS perangkat_atk_dari_pos text null,
  ADD COLUMN IF NOT EXISTS pola_dana text null,
  ADD COLUMN IF NOT EXISTS pengganti_nama text null,
  ADD COLUMN IF NOT EXISTS pengganti_alamat text null,
  ADD COLUMN IF NOT EXISTS pengganti_no_ktp text null,
  ADD COLUMN IF NOT EXISTS pengganti_tgl_lahir text null,
  ADD COLUMN IF NOT EXISTS pengganti_npwp text null,
  ADD COLUMN IF NOT EXISTS pengganti_telp text null,
  ADD COLUMN IF NOT EXISTS pengganti_email text null,
  ADD COLUMN IF NOT EXISTS pengganti_status text null,
  ADD COLUMN IF NOT EXISTS pengganti_catatan text null,
  ADD COLUMN IF NOT EXISTS jenis_usaha_kategori text null,
  ADD COLUMN IF NOT EXISTS courier_pos text null,
  ADD COLUMN IF NOT EXISTS courier_spx text null,
  ADD COLUMN IF NOT EXISTS courier_lion_parcel text null,
  ADD COLUMN IF NOT EXISTS courier_wahana text null,
  ADD COLUMN IF NOT EXISTS courier_jnt_cargo text null,
  ADD COLUMN IF NOT EXISTS courier_jnt_express text null,
  ADD COLUMN IF NOT EXISTS courier_sicepat text null,
  ADD COLUMN IF NOT EXISTS courier_jne text null,
  ADD COLUMN IF NOT EXISTS courier_tiki text null,
  ADD COLUMN IF NOT EXISTS courier_sap text null,
  ADD COLUMN IF NOT EXISTS courier_id_express text null,
  ADD COLUMN IF NOT EXISTS courier_anteraja text null,
  ADD COLUMN IF NOT EXISTS courier_lex_id text null;

-- ---------------------------------------------------------------------------
-- 3) Backfill: no_hp lawas -> no_hp_pemilik bila masih kosong
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'data_lengkap_utama'
      AND column_name = 'no_hp'
  ) THEN
    EXECUTE $q$
      UPDATE public.data_lengkap_utama
      SET no_hp_pemilik = no_hp
      WHERE (no_hp_pemilik IS NULL OR no_hp_pemilik = '')
        AND no_hp IS NOT NULL AND no_hp <> ''
    $q$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Index unik parsial PPID (syarat upsert script)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_utama_ppid
  ON public.data_lengkap_utama(ppid)
  WHERE ppid IS NOT NULL AND ppid <> '';

-- ---------------------------------------------------------------------------
-- 5) Tabel pendukung v2 (idempoten; dilewati bila sudah ada)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no_resi text UNIQUE NOT NULL,
  agen text NOT NULL,
  petugas text NOT NULL,
  layanan text DEFAULT 'PE',
  status_resi text DEFAULT 'PERJALANAN',
  status_fu text DEFAULT 'PERLU FOLLOW UP',
  tgl_tiket date DEFAULT CURRENT_DATE,
  closed_at timestamptz NULL,
  catatan text NULL,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bailout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_loket text NOT NULL,
  nama_loket text NULL,
  periode date NOT NULL,
  nominal bigint DEFAULT 0,
  raw_payload jsonb NULL,
  created_at timestamptz DEFAULT NOW(),
  CONSTRAINT unique_bailout UNIQUE (kode_loket, periode)
);

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  username text UNIQUE NOT NULL,
  password text NOT NULL,
  role text DEFAULT 'USER' CHECK (role IN ('ADMIN', 'USER')),
  created_at timestamptz DEFAULT NOW()
);
