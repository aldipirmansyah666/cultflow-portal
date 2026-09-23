/**
 * Statistik ringkas Dashboard — dihitung server-side (service_role)
 * agar angka exact tanpa tergantung RLS browser.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError } from "./dataUtamaService";

export interface DashboardStats {
  agenTotal: number;
  /** Resi status_followup = BELUM_FOLLOWUP (alur kerja aktif). */
  resiPendingFollowUp: number;
  /** Total baris tabel resi. */
  resiTotal: number;
  /** Resi is_selesai = SELESAI. */
  resiSelesai: number;
  /** Resi created_at sejak awal hari ini (WIB). */
  resiToday: number;
  bailoutCount: number;
  bailoutNominal: number;
  /** True bila sum nominal hanya dari N baris pertama (tabel > limit). */
  bailoutCapped: boolean;
}

export const PENDING_FOLLOW_UP = "BELUM_FOLLOWUP";
export const RESI_DONE = "SELESAI";
export const BAILOUT_SUM_LIMIT = 5000;

async function exactCount(
  client: SupabaseClient,
  table: string,
  context: string,
  equals?: [string, string],
  gte?: [string, string]
): Promise<number> {
  let query = client.from(table).select("id", { count: "exact", head: true });
  if (equals) query = query.eq(equals[0], equals[1]);
  if (gte) query = query.gte(gte[0], gte[1]);
  const { count, error } = await query;
  if (error) {
    logSupabaseError(context, error);
    throw error;
  }
  return Math.max(0, count ?? 0);
}

/** Awal hari berjalan zona WIB sebagai ISO (untuk filter created_at). */
export function jakartaDayStartIso(now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${day}T00:00:00+07:00`).toISOString();
}

export async function getDashboardStats(
  client: SupabaseClient
): Promise<DashboardStats> {
  // Hitungan independen -> paralel, satu ronde network.
  const [agenTotal, resiPendingFollowUp, resiTotal, resiSelesai, resiToday, bailoutCount] =
    await Promise.all([
      exactCount(client, "data_lengkap_utama", "dashboard-agen"),
      exactCount(client, "resi", "dashboard-resi-pending", [
        "status_followup",
        PENDING_FOLLOW_UP,
      ]),
      exactCount(client, "resi", "dashboard-resi-total"),
      exactCount(client, "resi", "dashboard-resi-selesai", [
        "is_selesai",
        RESI_DONE,
      ]),
      exactCount(
        client,
        "resi",
        "dashboard-resi-today",
        undefined,
        ["created_at", jakartaDayStartIso()]
      ),
      exactCount(client, "bailout", "dashboard-bailout-count"),
    ]);

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
    resiTotal,
    resiSelesai,
    resiToday,
    bailoutCount,
    bailoutNominal,
    bailoutCapped,
  };
}
