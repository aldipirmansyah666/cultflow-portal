-- Migration: ringkasan rekap fee PER PERIODE (sinkron dengan filter UI).
--
-- Latar (audit HIGH-1 — rekap fee): kartu ringkasan pada header harus
-- mencerminkan filter yang sedang aktif. RPC lama
-- `loket_profiles_summary()` / `fee_rekap_summary()` bersifat GLOBAL
-- (seluruh periode + periode terbaru), sehingga saat user memfilter
-- satu periode, angka header tetap "seluruh periode" — tidak sinkron
-- dengan isi tabel.
--
-- Fungsi baru menerima parameter periode:
--   loket_profiles_summary_for_period(text) -> Master (loket_profiles)
--   fee_rekap_summary_for_period(text)      -> legacy (fee_loket)
-- Status terbayar mengikuti isPaidStatus() di feeRekapService.ts:
-- TERBAYAR, KE_DEPOSIT, TRANSFER_REKENING, TOPUP_SISA (legacy: TERBAYAR).
--
-- Idempotent (CREATE OR REPLACE), tidak menghapus/mengubah data.
-- RLS lockdown: hanya service_role + postgres (seperti RPC sebelumnya).

create or replace function public.loket_profiles_summary_for_period(p_periode text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'periods',
    coalesce(
      (
        select jsonb_agg(p order by p desc)
        from (
          select distinct periode p
          from public.loket_profiles
          where periode is not null and periode <> ''
        ) s
      ),
      '[]'::jsonb
    ),
    'latestPeriode',
    coalesce(p_periode, ''),
    'totalLoket',
    coalesce(
      (
        select count(distinct f.ppid)
        from public.loket_profiles f
        where f.periode = p_periode
      ),
      0
    ),
    'totalTerbayarAktif',
    coalesce(
      (
        select sum(f.total_fee)
        from public.loket_profiles f
        where f.periode = p_periode
          and upper(btrim(coalesce(f.status_pembayaran, ''))) in
              ('TERBAYAR', 'KE_DEPOSIT', 'TRANSFER_REKENING', 'TOPUP_SISA')
      ),
      0
    )
  );
$$;

create or replace function public.fee_rekap_summary_for_period(p_periode text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'periods',
    coalesce(
      (
        select jsonb_agg(p order by p desc)
        from (
          select distinct periode p
          from public.fee_loket
          where periode is not null and periode <> ''
        ) s
      ),
      '[]'::jsonb
    ),
    'latestPeriode',
    coalesce(p_periode, ''),
    'totalLoket',
    coalesce(
      (
        select count(distinct f.ppid)
        from public.fee_loket f
        where f.periode = p_periode
      ),
      0
    ),
    'totalTerbayarAktif',
    coalesce(
      (
        select sum(f.total_fee)
        from public.fee_loket f
        where f.periode = p_periode
          and upper(btrim(coalesce(f.status, ''))) = 'TERBAYAR'
      ),
      0
    )
  );
$$;

-- RLS lockdown (fungsi executable oleh PUBLIC secara default di Postgres):
-- kunci dari anon/authenticated, hanya service_role/postgres.
revoke all on function public.loket_profiles_summary_for_period(text) from public, anon, authenticated;
grant execute on function public.loket_profiles_summary_for_period(text) to service_role;
grant execute on function public.loket_profiles_summary_for_period(text) to postgres;

revoke all on function public.fee_rekap_summary_for_period(text) from public, anon, authenticated;
grant execute on function public.fee_rekap_summary_for_period(text) to service_role;
grant execute on function public.fee_rekap_summary_for_period(text) to postgres;
