/**
 * Skeleton fallback router-level: tampil saat navigasi antar halaman
 * dan saat server component (mis. Dashboard) menjemput data.
 */

function SkeletonCard() {
  return (
    <div aria-hidden className="cf-card animate-pulse p-5">
      <div className="h-3 w-24 rounded bg-slate-200" />
      <div className="mt-3 h-8 w-20 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-32 rounded bg-slate-100" />
    </div>
  );
}

export default function AppLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Memuat halaman">
      <div className="animate-pulse rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 sm:p-8">
        <div className="h-6 w-56 rounded bg-white/20" />
        <div className="mt-2 h-4 w-80 max-w-full rounded bg-white/10" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="cf-card animate-pulse p-4">
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="mt-3 space-y-2">
          <div className="h-4 rounded bg-slate-100" />
          <div className="h-4 rounded bg-slate-100" />
          <div className="h-4 w-2/3 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
