import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (anon key only) — lazy singleton.
 * Dibuat malas (bukan saat import) agar aman diimpor oleh halaman yang
 * di-prerender saat `next build` tanpa env. Error baru dilempar saat
 * benar-benar dipanggil tanpa env.
 *
 * Usage (Client Component):
 *   const supabase = getSupabaseBrowser();
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase browser env. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  cached = createClient(url, anonKey);
  return cached;
}
