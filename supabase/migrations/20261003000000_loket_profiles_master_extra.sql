-- Migration: kolom Master tambahan meniru Slip sheet `Cari` (C6:E27).
--
-- Latar: sheet `Cari` mem-VLOOKUP satu PPID menjadi slip lengkap:
--   E13 Subsidi Antar Loket  = kolom 165 (SUBSIDI PLN Antar Loket)
--   E14 Total Fee             = E11+E12+E13 (dihitung saat parse)
--   E19 Total Fee di Transfer = E14-E17-E18 (dihitung saat parse)
--   E22 Fee ke Deposit        = SUM kolom 198,200,202,204
--   E23 Fee di Transfer ke Rek= SUM kolom 199,201,203,205
--   E24 Sisa Fee              = E19-E22-E23 (dihitung saat parse)
--   E26 Keterangan            = kolom 197 (KET)
--   E27 Transfer Tanggal      = kolom 208 (Ket Trf, mis. "Transfer 05 Agustus 2026")
-- Potongan dipisah dua kolom (194 lainnya, 195 ongkir) agar slip
-- menampilkan keduanya seperti Excel. Status diperkaya mengikuti logika
-- J20 Excel (BELUM_TRANSFER / KE_DEPOSIT / TRANSFER_REKENING /
-- TOPUP_SISA) dengan nilai lama tetap valid untuk kompatibilitas.
-- Idempoten, tanpa hapus data.

alter table public.loket_profiles
  add column if not exists subsidi_antar_loket bigint not null default 0;
alter table public.loket_profiles
  add column if not exists total_fee bigint not null default 0;
alter table public.loket_profiles
  add column if not exists total_fee_transfer bigint not null default 0;
alter table public.loket_profiles
  add column if not exists potongan_ongkir bigint not null default 0;
alter table public.loket_profiles
  add column if not exists fee_ke_deposit bigint not null default 0;
alter table public.loket_profiles
  add column if not exists fee_transfer_rekening bigint not null default 0;
alter table public.loket_profiles
  add column if not exists sisa_fee bigint not null default 0;
alter table public.loket_profiles
  add column if not exists keterangan text not null default '';
alter table public.loket_profiles
  add column if not exists tanggal_transfer text not null default '';

-- Perluas status mengikuti J20 sheet `Cari` (0/1/2/3). Nama constraint
-- bawaan Postgres untuk CHECK inline adalah
-- `loket_profiles_status_pembayaran_check`; keduanya di-drop-if-exists
-- agar migrasi aman di-apply ulang maupun setelah migrasi pertama.
alter table public.loket_profiles
  drop constraint if exists loket_profiles_status_pembayaran_check;
alter table public.loket_profiles
  drop constraint if exists loket_profiles_status_check;
alter table public.loket_profiles
  add constraint loket_profiles_status_check
  check (status_pembayaran in (
    'TERBAYAR', 'PENDING',
    'BELUM_TRANSFER', 'KE_DEPOSIT', 'TRANSFER_REKENING', 'TOPUP_SISA'
  ));
