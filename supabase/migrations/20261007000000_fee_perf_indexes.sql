-- Migration: indeks performa halaman Rekap Fee Loket + RPC ringkasan Master.
--
-- Latar (audit performa):
-- 1. GET /api/fee-rekap menghitung ringkasan Master (`summarizeProfiles`)
--    dengan paginasi penuh via PostgREST (2x full-table scan tiap request).
--    Fungsi `loket_profiles_summary()` di bawah memindahkan agregasi ke SQL
--    (1 round-trip), meniru pola `fee_rekap_summary()` yang sudah ada.
-- 2. Pencarian `ilike '%...%'` tidak bisa memakai indeks btree yang ada
--    (idx_loket_profiles_ppid/periode/nama, idx_fee_loket_*); indeks trigram
--    GIN (pg_trgm) membuat substring search tetap memakai indeks.
-- 3. Indeks komposit (periode, ppid) melayani pola query daftar:
--    filter periode + ORDER BY periode DESC, ppid ASC + range paginasi.
-- Idempoten (IF NOT EXISTS / OR REPLACE), tanpa hapus data.

create extension if not exists "pg_trgm";

-- Komposit untuk pola list + order + paginasi.
create index if not exists idx_loket_profiles_periode_ppid
  on public.loket_profiles(periode desc, ppid asc);
create index if not exists idx_fee_loket_periode_ppid
  on public.fee_loket(periode desc, ppid asc);

-- Trigram untuk pencarian substring (ilike '%kata%') ppid/nama.
create index if not exists idx_loket_profiles_ppid_trgm
  on public.loket_profiles using gin (ppid gin_trgm_ops);
create index if not exists idx_loket_profiles_nama_trgm
  on public.loket_profiles using gin (nama_loket gin_trgm_ops);
create index if not exists idx_fee_loket_ppid_trgm
  on public.fee_loket using gin (ppid gin_trgm_ops);
create index if not exists idx_fee_loket_nama_trgm
  on public.fee_loket using gin (nama_loket gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- RPC ringkasan Master: periode unik (desc), periode terbaru,
-- COUNT(DISTINCT ppid) + SUM(total_fee) status terbayar pada periode terbaru.
-- Status terbayar = isPaidStatus() di feeRekapService.ts:
-- TERBAYAR, KE_DEPOSIT, TRANSFER_REKENING, TOPUP_SISA.
-- ---------------------------------------------------------------------------

create or replace function public.loket_profiles_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with distinct_periods as (
    select distinct periode
    from public.loket_profiles
    where periode is not null and periode <> ''
  ),
  latest as (
    select max(periode) as periode from distinct_periods
  )
  select jsonb_build_object(
    'periods',
    coalesce(
      (
        select jsonb_agg(p order by p desc)
        from (select periode as p from distinct_periods) s
      ),
      '[]'::jsonb
    ),
    'latestPeriode',
    coalesce((select periode from latest), ''),
    'totalLoket',
    coalesce(
      (
        select count(distinct f.ppid)
        from public.loket_profiles f
        cross join latest l
        where f.periode = l.periode
      ),
      0
    ),
    'totalTerbayarAktif',
    coalesce(
      (
        select sum(f.total_fee)
        from public.loket_profiles f
        cross join latest l
        where f.periode = l.periode
          and f.status_pembayaran in (
            'TERBAYAR', 'KE_DEPOSIT', 'TRANSFER_REKENING', 'TOPUP_SISA'
          )
      ),
      0
    )
  );
$$;

-- RLS lockdown (fungsi executable oleh PUBLIC secara default di Postgres):
revoke all on function public.loket_profiles_summary()
  from public, anon, authenticated;
grant execute on function public.loket_profiles_summary() to service_role;
grant execute on function public.loket_profiles_summary() to postgres;
