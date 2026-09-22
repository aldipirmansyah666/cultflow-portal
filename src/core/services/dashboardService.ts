/**
 * Statistik ringkas Dashboard — dihitung server-side (service_role)
 * agar angka exact tanpa tergantung RLS browser.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError } from "./dataUtamaService";

export interface DashboardStats {
  agenTotal: number;
  /** Resi status_fu = PERLU FOLLOW UP. */
  resiPendingFollowUp: number;
  bailoutCount: number;
  bailoutNominal: number;
  /** True bila sum nominal hanya dari N baris pertama (tabel > limit). */
  bailoutCapped: boolean;
}

export const PENDING_FOLLOW_UP = "PERLU FOLLOW UP";
export const BAILOUT_SUM_LIMIT = 5000;

async function exactCount(
  client: SupabaseClient,
  table: string,
  context: string,
  equals?: [string, string]
): Promise<number> {
  let query = client.from(table).select("id", { count: "exact", head: true });
  if (equals) query = query.eq(equals[0], equals[1]);
  const { count, error } = await query;
  if (error) {
    logSupabaseError(context, error);
    throw error;
  }
  return Math.max(0, count ?? 0);
}

export async function getDashboardStats(
  client: SupabaseClient
): Promise<DashboardStats> {
  const agenTotal = await exactCount(
    client,
    "data_lengkap_utama",
    "dashboard-agen"
  );
  const resiPendingFollowUp = await exactCount(
    client,
    "resi",
    "dashboard-resi",
    ["status_fu", PENDING_FOLLOW_UP]
  );
  const bailoutCount = await exactCount(
    client,
    "bailout",
    "dashboard-bailout-count"
  );

  let bailoutNominal = 0;
  let bailoutCapped = false;
  if (bailoutCount > 0) {
    const { data, error } = await client
      .from("bailout")
      .select("nominal")
      .limit(BAILOUT_SUM_LIMIT);
    if (error) {
      logSupabaseError("dashboard-bailout-sum", error);
      throw error;
    }
    const rows = data ?? [];
    bailoutNominal = rows.reduce(
      (sum, r) => sum + (Number((r as { nominal: unknown }).nominal) || 0),
      0
    );
    bailoutCapped = bailoutCount > rows.length;
  }

  return {
    agenTotal,
    resiPendingFollowUp,
    bailoutCount,
    bailoutNominal,
    bailoutCapped,
  };
}
