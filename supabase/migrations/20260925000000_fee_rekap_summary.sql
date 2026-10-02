-- Migration: agregasi ringkasan fee loket di SQL.
--
-- Latar: GET /api/fee-rekap sebelumnya mengambil s/d 5000 baris mentah
-- (`.limit(5000)`) lalu menghitung manual via JS `reduce` — hasilnya
-- terpotong diam-diam di atas 5000 baris dan memakai `Number(x) || 0`
-- yang menelan NaN. Fungsi ini menghitung semuanya di database:
-- daftar periode unik (desc), periode terbaru, COUNT(DISTINCT ppid),
-- dan SUM(total_fee) status TERBAYAR pada periode terbaru.
-- API memakai via `admin.rpc("fee_rekap_summary")` dengan fallback
-- paginasi bila fungsi belum dimigrasi. Idempoten, tanpa hapus data.

create or replace function public.fee_rekap_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with distinct_periods as (
    select distinct periode
    from public.fee_loket
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
        from public.fee_loket f
        cross join latest l
        where f.periode = l.periode
      ),
      0
    ),
    'totalTerbayarAktif',
    coalesce(
      (
        select sum(f.total_fee)
        from public.fee_loket f
        cross join latest l
        where f.periode = l.periode
          and f.status = 'TERBAYAR'
      ),
      0
    )
  );
$$;

-- RLS lockdown (fungsi executable oleh PUBLIC secara default di Postgres):
-- kunci dari anon/authenticated, hanya service_role/postgres.
revoke all on function public.fee_rekap_summary() from public, anon, authenticated;
grant execute on function public.fee_rekap_summary() to service_role;
grant execute on function public.fee_rekap_summary() to postgres;
