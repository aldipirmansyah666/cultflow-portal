"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** Search box cepat -> lempar ke /lookup-agen?query=. */
export function QuickLookupBox() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q === "") return;
    router.push(`/lookup-agen?query=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <label className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="PPID / Nama Loket…"
          aria-label="Pencarian cepat agen"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-200 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={value.trim() === ""}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Cari
      </button>
    </form>
  );
}
