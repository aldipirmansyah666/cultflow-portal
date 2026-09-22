-- Migration: init_schema (sheet 'Agen CUM')
-- Generated: 2026-09-21

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabel: data_lengkap_utama
-- ---------------------------------------------------------------------------
create table if not exists public.data_lengkap_utama (
  id uuid primary key default gen_random_uuid(),
  no numeric null,
  status_syarat text null,
  pengajuan_survey text null,
  pengajuan_pos text null,
  pendaftaran_kurlog text null,
  kelengkapan_perangkat text null,
  aktivasi_kurlog text null,
  aktivasi_sicepat text null,
  training text null,
  transaksi text null,
  catatan text null,
  kurlog_pos_ppob boolean default false,
  kurlog_pos_only boolean default false,
  kurlog_sicepat boolean default false,
  ppid text null,
  nama_loket_onpays text null,
  nama_loket_kurlog text null,
  nama_pemilik text null,
  alamat_pemilik_ktp text null,
  alamat_lengkap_loket text null,
  rt_rw text null,
  kel_desa text null,
  kec text null,
  kab_kot text null,
  propinsi text null,
  kode_pos text null,
  no_ktp text null,
  no_npwp text null,
  electric_area text null,
  rekomendasi text null,
  no_hp_pemilik text null,
  no_hp_loket text null,
  email text null,
  no_dirian text null,
  location_id text null,
  user_mile text null,
  password_mile text null,
  regional text null,
  kcu_kc text null,
  nib text null,
  no_kbli text null,
  nomor_rekening text null,
  nama_bank text null,
  nama_pemilik_rekening text null,
  latitude text null,
  longitude text null,
  kelengkapan_admin_formulir text null,
  form_ajuan_pos text null,
  pks text null,
  doc_ktp text null,
  doc_npwp text null,
  doc_nib text null,
  doc_kbli text null,
  foto_tampak_depan_loket text null,
  perangkat_komputer_laptop text null,
  perangkat_hp_android text null,
  perangkat_printer_sticker text null,
  perangkat_timbangan_digital text null,
  perangkat_kertas_sticker text null,
  perangkat_atk_dari_pos text null,
  pola_dana text null,
  pengganti_nama text null,
  pengganti_alamat text null,
  pengganti_no_ktp text null,
  pengganti_tgl_lahir text null,
  pengganti_npwp text null,
  pengganti_telp text null,
  pengganti_email text null,
  pengganti_status text null,
  pengganti_catatan text null,
  jenis_usaha_kategori text null,
  courier_pos text null,
  courier_spx text null,
  courier_lion_parcel text null,
  courier_wahana text null,
  courier_jnt_cargo text null,
  courier_jnt_express text null,
  courier_sicepat text null,
  courier_jne text null,
  courier_tiki text null,
  courier_sap text null,
  courier_id_express text null,
  courier_anteraja text null,
  courier_lex_id text null,
  created_at timestamptz default now()
);

create unique index if not exists idx_data_utama_ppid
  on public.data_lengkap_utama(ppid)
  where ppid is not null and ppid <> '';

-- ---------------------------------------------------------------------------
-- Tabel: resi
-- ---------------------------------------------------------------------------
create table if not exists public.resi (
  id uuid primary key default gen_random_uuid(),
  no_resi text unique not null,
  agen text not null,
  petugas text not null,
  layanan text default 'PE',
  status_resi text default 'PERJALANAN',
  status_fu text default 'PERLU FOLLOW UP',
  tgl_tiket date default current_date,
  closed_at timestamptz null,
  catatan text null,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Tabel: bailout
-- ---------------------------------------------------------------------------
create table if not exists public.bailout (
  id uuid primary key default gen_random_uuid(),
  kode_loket text not null,
  nama_loket text null,
  periode date not null,
  nominal bigint default 0,
  raw_payload jsonb null,
  created_at timestamptz default now(),
  constraint unique_bailout unique (kode_loket, periode)
);

-- ---------------------------------------------------------------------------
-- Tabel: users
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text unique not null,
  password text not null,
  role text default 'USER' check (role in ('ADMIN', 'USER')),
  created_at timestamptz default now()
);
