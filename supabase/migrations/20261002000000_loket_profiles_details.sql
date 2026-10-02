-- Migration: profil loket + rincian transaksi per modul (meniru Excel Master).
--
-- Latar: file "Fee Loket CUM_Agustus 2026.xlsx" sheet `Loket BSB` memuat
-- ±10.000 baris dengan struktur multi-level:
--   - Identitas (kolom A-H): No, PPID, Nama Loket, BANK, No.Rekening,
--     Nama Pemilik, Rekomender, Elektrik Area.
--   - Blok tarif per modul (indeks 11-81, header di baris Excel ke-4).
--   - Blok LEMBAR transaksi (indeks 82-160).
--   - Blok TOTAL FEE per modul (indeks 161-187).
--   - Ringkasan keuangan (indeks 189-196): JUMLAH FEE BULAN INI,
--     FEE BULAN SEBELUMNYA, JUMLAH FEE, MINUS, HOLD, Potongan lainnya,
--     Potongan Ongkir, Fee Siap Transfer.
-- Sheet `Cari` mem-VLOOKUP satu PPID menjadi Slip Profil + tabel
-- RINCIAN TRANSAKSI (MODUL | LEMBAR | FEE/LEMBAR | TOTAL FEE).
--
-- Tabel `fee_loket` lama (satu baris = total fee + rincian jsonb) tetap
-- dipertahankan untuk kompatibilitas; dua tabel baru ini menyimpan
-- struktur relasional yang persis meniru Excel Master.
-- Idempoten, tanpa hapus data. RLS lockdown mengikuti pola
-- users_rls_lockdown: hanya service_role/postgres (via API routes).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabel: loket_profiles (satu baris = satu loket x satu periode)
-- ---------------------------------------------------------------------------
create table if not exists public.loket_profiles (
  id uuid primary key default gen_random_uuid(),
  ppid text not null,
  nama_loket text not null default '',
  bank text not null default '',
  no_rekening text not null default '',
  nama_pemilik text not null default '',
  rekomender text not null default '',
  elektrik_area text not null default '',
  periode text not null,
  fee_bulan_ini bigint not null default 0,
  fee_bulan_sebelumnya bigint not null default 0,
  minus bigint not null default 0,
  hold bigint not null default 0,
  potongan_lainnya bigint not null default 0,
  fee_siap_transfer bigint not null default 0,
  status_pembayaran text not null default 'PENDING'
    check (status_pembayaran in ('TERBAYAR', 'PENDING', 'BELUM_TRANSFER', 'KE_DEPOSIT', 'TRANSFER_REKENING')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint unique_loket_profile unique (ppid, periode)
);

create index if not exists idx_loket_profiles_ppid
  on public.loket_profiles(ppid);

create index if not exists idx_loket_profiles_periode
  on public.loket_profiles(periode desc);

create index if not exists idx_loket_profiles_nama
  on public.loket_profiles(nama_loket);

-- ---------------------------------------------------------------------------
-- Tabel: loket_transaction_details (satu baris = satu modul x loket x periode)
-- Meniru tabel RINCIAN TRANSAKSI sheet `Cari`:
-- MODUL | LEMBAR | FEE/LEMBAR | TOTAL FEE
-- ---------------------------------------------------------------------------
create table if not exists public.loket_transaction_details (
  id uuid primary key default gen_random_uuid(),
  ppid text not null,
  periode text not null,
  modul_nama text not null,
  jumlah_lembar bigint not null default 0,
  fee_per_lembar bigint not null default 0,
  total_fee bigint not null default 0,
  created_at timestamptz default now(),
  constraint unique_loket_detail unique (ppid, periode, modul_nama)
);

create index if not exists idx_loket_details_ppid_periode
  on public.loket_transaction_details(ppid, periode);

create index if not exists idx_loket_details_periode
  on public.loket_transaction_details(periode desc);

create index if not exists idx_loket_details_modul
  on public.loket_transaction_details(modul_nama);

-- ---------------------------------------------------------------------------
-- RLS lockdown (pola yang sama dengan public.fee_loket):
-- kunci dari anon/authenticated, hanya service_role/postgres yang akses.
-- ---------------------------------------------------------------------------
alter table public.loket_profiles enable row level security;
alter table public.loket_transaction_details enable row level security;

revoke all on public.loket_profiles from anon, authenticated;
revoke all on public.loket_transaction_details from anon, authenticated;
grant all on public.loket_profiles to service_role;
grant all on public.loket_profiles to postgres;
grant all on public.loket_transaction_details to service_role;
grant all on public.loket_transaction_details to postgres;

-- Best-effort: hapus policy publik bila template pernah membuatnya.
drop policy if exists "Allow all" on public.loket_profiles;
drop policy if exists "Enable all access for all users" on public.loket_profiles;
drop policy if exists "Enable read access for all users" on public.loket_profiles;
drop policy if exists "Allow public read access" on public.loket_profiles;
drop policy if exists "Allow all" on public.loket_transaction_details;
drop policy if exists "Enable all access for all users" on public.loket_transaction_details;
drop policy if exists "Enable read access for all users" on public.loket_transaction_details;
drop policy if exists "Allow public read access" on public.loket_transaction_details;
