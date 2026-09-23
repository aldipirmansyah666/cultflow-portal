/**
 * Dashboard "CultFlow Ops Workspace" (route /).
 * Server component: statistik dihitung dengan service_role per request.
 */

import Link from "next/link";
import {
  AlertTriangle,
  Database,
  FileSearch,
  Layers,
  Package,
  PackageOpen,
  Scale,
  Wallet,
} from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  getDashboardStats,
  type DashboardStats,
} from "@/core/services/dashboardService";
import { QuickLookupBox } from "@/components/dashboard/QuickLookupBox";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const idFormatter = new Intl.NumberFormat("id-ID");
const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function StatCard({
  title,
  value,
  subtitle,
  href,
  hrefLabel,
  icon,
  accent,
}: {
  title: string;
  value: string;
  subtitle: string;
  href: string;
  hrefLabel: string;
  icon: React.ReactNode;
  accent: "cyan" | "amber" | "emerald" | "slate";
}) {
  const accents = {
    cyan: "border-cyan-200 bg-gradient-to-b from-cyan-50 to-white text-cyan-700",
    amber:
      "border-amber-200 bg-gradient-to-b from-amber-50 to-white text-amber-700",
    emerald:
      "border-emerald-200 bg-gradient-to-b from-emerald-50 to-white text-emerald-700",
    slate: "border-slate-200 bg-white text-slate-900",
  } as const;
  return (
    <div className={cn("cf-card border p-5", accents[accent])}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
          {title}
        </p>
        {icon}
      </div>
      <p className="mt-2 truncate text-3xl font-extrabold tracking-tight">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
      <Link
        href={href}
        className="mt-3 inline-block text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline"
      >
        {hrefLabel} →
      </Link>
    </div>
  );
}

const QUICK_ACTIONS = [
  {
    title: "Bagging Generator",
    desc: "Draft WA pengingat per agen",
    href: "/bagging",
    icon: Package,
  },
  {
    title: "Bailout Generator",
    desc: "Template minus Sunda-formal",
    href: "/bailout",
    icon: PackageOpen,
  },
  {
    title: "Lookup Agen",
    desc: "Profil agenpos PosIND",
    href: "/lookup-agen",
    icon: FileSearch,
  },
  {
    title: "Reconcile Validator",
    desc: "Validasi prefix EC3/PKH",
    href: "/reconcile",
    icon: Scale,
  },
] as const;

export default async function DashboardPage() {
  let stats: DashboardStats | null = null;
  try {
    stats = await getDashboardStats(getSupabaseAdmin());
  } catch {
    stats = null;
  }

  return (
    <div className="space-y-5">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(255 255 255 / 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.25) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Layers className="size-6 text-cyan-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              CultFlow Ops Workspace
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Pusat monitoring agen, bagging, bailout, dan reconcile Kurlog.
            </p>
          </div>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 font-mono text-[11px] text-cyan-200 backdrop-blur">
            Engineered by Aldi Pirmansyah
          </span>
        </div>
      </section>

      {stats === null && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Statistik tak tersedia (database tidak terjangkau). Menu di bawah
          tetap dapat digunakan.
        </div>
      )}

      {/* Kartu statistik */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Agen Registered"
          value={stats ? idFormatter.format(stats.agenTotal) : "—"}
          subtitle="data_lengkap_utama"
          href="/data-utama"
          hrefLabel="Kelola data"
          icon={<Database className="size-5 text-cyan-600" aria-hidden />}
          accent="cyan"
        />
        <StatCard
          title="Pending Bagging"
          value={stats ? idFormatter.format(stats.resiPendingFollowUp) : "—"}
          subtitle="resi perlu follow-up"
          href="/bagging"
          hrefLabel="Buka Bagging"
          icon={<Package className="size-5 text-amber-600" aria-hidden />}
          accent="amber"
        />
        <StatCard
          title="Total Bailout Status"
          value={stats ? idFormatter.format(stats.bailoutCount) : "—"}
          subtitle={
            stats
              ? `${idrFormatter.format(stats.bailoutNominal)}${stats.bailoutCapped ? " (5000 pertama)" : ""}`
              : "bailout tercatat"
          }
          href="/bailout"
          hrefLabel="Buka Bailout"
          icon={<Wallet className="size-5 text-emerald-600" aria-hidden />}
          accent="emerald"
        />
        <div className="cf-card border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
              Quick Lookup Agen
            </p>
            <FileSearch className="size-5 text-blue-700" aria-hidden />
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-800">
            Cari PPID / Nama Loket
          </p>
          <QuickLookupBox />
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold tracking-widest text-slate-500 uppercase">
          Quick Action
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="cf-card group flex items-center gap-3 p-4 hover:border-cyan-300"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-700 to-cyan-600 text-white shadow-sm shadow-blue-600/30 transition-transform group-hover:scale-105">
                <action.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-900">
                  {action.title}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {action.desc}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Widget operasional */}
      <section className="relative overflow-hidden rounded-2xl border border-blue-900/40 bg-gradient-to-br from-slate-900 via-blue-950 to-cyan-900 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-widest text-cyan-300 uppercase">
              Informasi Operasional
            </p>
            <h2 className="mt-1 text-lg font-extrabold tracking-tight">
              Kurlog &amp; PosIND
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-blue-100">
              <li>
                • Bantuan operasional / kendala bagging: +62 822-1756-9689 /
                +62 819-1066-6926
              </li>
              <li>
                • Pelimpahan bailout sebelum pukul 09.00 WIB (hari kerja).
              </li>
              <li>
                • Resi EC3 wajib berprefix SHPE/P260; PKH wajib
                P260/TTSPOS/26MNG — cek via Reconcile Validator.
              </li>
            </ul>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
                <p className="text-lg font-extrabold text-cyan-300">
                  {stats ? idFormatter.format(stats.agenTotal) : "—"}
                </p>
                <p className="text-[10px] tracking-wide text-blue-200 uppercase">Agen</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
                <p className="text-lg font-extrabold text-cyan-300">
                  {stats ? idFormatter.format(stats.resiPendingFollowUp) : "—"}
                </p>
                <p className="text-[10px] tracking-wide text-blue-200 uppercase">FU Resi</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
                <p className="text-lg font-extrabold text-cyan-300">
                  {stats ? idFormatter.format(stats.bailoutCount) : "—"}
                </p>
                <p className="text-[10px] tracking-wide text-blue-200 uppercase">Bailout</p>
              </div>
            </div>
            <p className="font-mono text-[11px] text-slate-400">
              Engineered by{" "}
              <span className="font-semibold text-slate-200">Aldi Pirmansyah</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
