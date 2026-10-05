-- Migration: indeks performa Data Lengkap Utama + Monitoring Resi.
--
-- Latar (audit performa):
-- - GET /api/data-utama mencari via `ilike '%...%'` pada ppid /
--   nama_loket_kurlog / nama_loket_onpays / nama_pemilik + filter
--   `regional` + ORDER BY created_at — tanpa indeks pendukung selain
--   partial-unique ppid (hanya membantu bila predikat cocok).
-- - GET /api/resi mencari via `ilike '%...%'` pada no_resi / agen +
--   filter status_followup / is_selesai + filter rentang created_at +
--   ORDER BY created_at DESC, id DESC — tanpa indeks sama sekali
--   (hanya PK + UNIQUE no_resi dari DDL).
-- - Pencarian substring `%...%` tidak bisa memakai btree: dipakai
--   indeks trigram GIN (pg_trgm), meniru pola migrasi fee
--   20261007000000_fee_perf_indexes.sql.
-- Idempoten (IF NOT EXISTS / pengecekan information_schema untuk kolom
-- live yang tidak ada di migrasi: nomor_resi, status_followup,
-- is_selesai), tanpa hapus data.

create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- data_lengkap_utama: pencarian + filter + urutan list
-- ---------------------------------------------------------------------------

-- Trigram untuk pencarian substring (ilike '%kata%').
create index if not exists idx_data_utama_ppid_trgm
  on public.data_lengkap_utama using gin (ppid gin_trgm_ops);
create index if not exists idx_data_utama_nama_kurlog_trgm
  on public.data_lengkap_utama using gin (nama_loket_kurlog gin_trgm_ops);
create index if not exists idx_data_utama_nama_onpays_trgm
  on public.data_lengkap_utama using gin (nama_loket_onpays gin_trgm_ops);
create index if not exists idx_data_utama_pemilik_trgm
  on public.data_lengkap_utama using gin (nama_pemilik gin_trgm_ops);

-- Filter dropdown regional + urutan daftar terbaru.
create index if not exists idx_data_utama_regional
  on public.data_lengkap_utama(regional);
create index if not exists idx_data_utama_created
  on public.data_lengkap_utama(created_at desc);

-- ---------------------------------------------------------------------------
-- resi: pencarian + filter status/tanggal + urutan list
-- ---------------------------------------------------------------------------

-- Urutan daftar (ORDER BY created_at DESC, id DESC) + filter rentang tanggal.
create index if not exists idx_resi_created_id
  on public.resi(created_at desc, id desc);

-- Filter tab status (belum/sudah/selesai). Kolom status_followup /
-- is_selesai hanya ada di DB live (tidak ada di file migrasi),
-- sehingga indeksnya dibuat kondisional seperti nomor_resi.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resi'
      and column_name = 'status_followup'
  ) then
    create index if not exists idx_resi_status_followup
      on public.resi(status_followup)
      where status_followup is not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resi'
      and column_name = 'is_selesai'
  ) then
    create index if not exists idx_resi_is_selesai
      on public.resi(is_selesai)
      where is_selesai is not null;
  end if;
end
$$;

-- Trigram untuk pencarian substring (ilike '%kata%') no_resi / agen.
create index if not exists idx_resi_no_resi_trgm
  on public.resi using gin (no_resi gin_trgm_ops);
create index if not exists idx_resi_agen_trgm
  on public.resi using gin (agen gin_trgm_ops);

-- Kolom live yang tidak ada di file migrasi (ditambah langsung di DB):
-- buat indeksnya hanya bila kolomnya benar-benar ada.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resi'
      and column_name = 'nomor_resi'
  ) then
    create index if not exists idx_resi_nomor_resi_trgm
      on public.resi using gin (nomor_resi gin_trgm_ops);
  end if;
end
$$;
