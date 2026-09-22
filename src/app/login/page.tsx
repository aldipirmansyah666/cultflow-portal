"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Layers, Loader2, Lock, User } from "lucide-react";
import { cn } from "@/lib/utils";

function sanitizeRedirect(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("://")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = sanitizeRedirect(searchParams.get("redirect") || "/");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Username atau Password salah");
        return;
      }
      router.push(redirect);
      router.refresh();
    } catch {
      setError("Terjadi kesalahan jaringan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tech-grid flex min-h-screen items-center justify-center bg-[#f8fafc] p-4">
      <div className="w-full max-w-sm">
        <div className="cf-card p-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="relative mb-4 flex size-14 items-center justify-center">
              <span
                aria-hidden
                className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-2xl bg-slate-200"
              />
              <span
                aria-hidden
                className="absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] rounded-2xl bg-blue-200"
              />
              <span className="relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm shadow-blue-600/30">
                <Layers className="size-7" aria-hidden />
              </span>
            </span>
            <h1 className="bg-gradient-to-r from-blue-700 to-cyan-600 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
              CultFlow
            </h1>
            <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Ops Workspace — Masuk
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Username
              </span>
              <span className="relative block">
                <User
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="nama pengguna"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Password
              </span>
              <span className="relative block">
                <Lock
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </span>
            </label>

            {error !== "" && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "w-full rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-opacity hover:opacity-90 disabled:opacity-60",
                loading && "cursor-wait"
              )}
            >
              <span className="inline-flex items-center gap-2">
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {loading ? "Memeriksa…" : "Masuk"}
              </span>
            </button>
          </form>
        </div>
        <p className="mt-4 text-center font-mono text-[11px] text-slate-400">
          © 2026 CultFlow Workspace
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
