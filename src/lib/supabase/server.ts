import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client with service_role key.
// ONLY import this in Route Handlers / Server Actions / server-only code.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase server env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Convenience singleton for server routes that don't need per-request scoping.
export function getSupabaseAdmin(): SupabaseClient {
  return createServerSupabaseClient();
}
