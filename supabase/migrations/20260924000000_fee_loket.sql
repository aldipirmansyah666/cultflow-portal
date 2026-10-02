-- Migration: rekapitulasi fee loket/agen (fitur /fee-rekap).
--
-- Latar: Tab Upload mem-parse file Excel menjadi baris {ppid, nama_loket,
-- periode YYYY-MM, total_fee, status, rincian[]}. Tabel ini menyimpan hasil
-- parse secara riil (upsert unik per ppid+periode), menggantikan mock
-- in-memory. Pola RLS mengikuti users_rls_lockdown: aplikasi v2 SELALU
-- mengakses via service_role (API routes), tanpa policy baca anon.
-- Idempoten, tanpa hapus data.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabel: fee_loket (satu baris = satu loket x satu periode)
-- ---------------------------------------------------------------------------
create table if not exists public.fee_loket (
  id uuid primary key default gen_random_uuid(),
  ppid text not null,
  nama_loket text not null default '',
  periode text not null,
  total_fee bigint not null default 0,
  status text not null default 'PENDING' check (status in ('TERBAYAR', 'PENDING')),
  rincian jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint unique_fee_loket unique (ppid, periode)
);

create index if not exists idx_fee_loket_periode
  on public.fee_loket(periode desc);

create index if not exists idx_fee_loket_ppid
  on public.fee_loket(ppid);

-- ---------------------------------------------------------------------------
-- Tabel: fee_upload_logs (riwayat upload admin)
-- ---------------------------------------------------------------------------
create table if not exists public.fee_upload_logs (
  id uuid primary key default gen_random_uuid(),
  tanggal_upload timestamptz default now(),
  nama_file text not null,
  jumlah_baris integer not null default 0,
  periode text not null,
  diunggah_oleh text not null default '',
  created_at timestamptz default now()
);

create index if not exists idx_fee_upload_logs_tanggal
  on public.fee_upload_logs(tanggal_upload desc);

-- ---------------------------------------------------------------------------
-- RLS lockdown (pola yang sama dengan public.users):
-- kunci dari anon/authenticated, hanya service_role/postgres yang akses.
-- ---------------------------------------------------------------------------
alter table public.fee_loket enable row level security;
alter table public.fee_upload_logs enable row level security;

revoke all on public.fee_loket from anon, authenticated;
revoke all on public.fee_upload_logs from anon, authenticated;
grant all on public.fee_loket to service_role;
grant all on public.fee_loket to postgres;
grant all on public.fee_upload_logs to service_role;
grant all on public.fee_upload_logs to postgres;

-- Best-effort: hapus policy publik bila template pernah membuatnya.
drop policy if exists "Allow all" on public.fee_loket;
drop policy if exists "Enable all access for all users" on public.fee_loket;
drop policy if exists "Enable read access for all users" on public.fee_loket;
drop policy if exists "Allow public read access" on public.fee_loket;
drop policy if exists "Allow all" on public.fee_upload_logs;
drop policy if exists "Enable all access for all users" on public.fee_upload_logs;
drop policy if exists "Enable read access for all users" on public.fee_upload_logs;
drop policy if exists "Allow public read access" on public.fee_upload_logs;
