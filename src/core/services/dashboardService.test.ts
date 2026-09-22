import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardStats } from "./dashboardService";

/** Fake antrean hasil per panggilan terminal (then/limit). */
function fakeDashClient(
  results: { count: number | null; data: unknown[]; error?: unknown }[]
): { client: SupabaseClient; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const terminal = (label: string) => {
    const r = results[Math.min(n, results.length - 1)] ?? {
      count: 0,
      data: [],
    };
    n += 1;
    calls.push(label);
    return Promise.resolve({
      count: r.count,
      data: r.data,
      error: r.error ?? null,
    });
  };
  const chain: Record<string, unknown> = {};
  chain.eq = (c: string, v: unknown) => {
    calls.push(`eq:${c}=${String(v)}`);
    return chain;
  };
  chain.limit = (m: number) => {
    calls.push(`limit:${m}`);
    return terminal("rows");
  };
  chain.then = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void
  ) => {
    try {
      resolve(terminal("head"));
    } catch (e) {
      reject?.(e);
    }
  };
  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return { select: () => chain };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("getDashboardStats", () => {
  it("angka exact + sum nominal + filter follow-up", async () => {
    const { client, calls } = fakeDashClient([
      { count: 1463, data: [] },
      { count: 90, data: [] },
      { count: 3, data: [] },
      { count: null, data: [{ nominal: 100 }, { nominal: 250 }, { nominal: null }] },
    ]);
    const stats = await getDashboardStats(client);
    expect(stats).toEqual({
      agenTotal: 1463,
      resiPendingFollowUp: 90,
      bailoutCount: 3,
      bailoutNominal: 350,
      bailoutCapped: false,
    });
    expect(calls).toContain("eq:status_fu=PERLU FOLLOW UP");
    expect(calls).toContain("limit:5000");
  });

  it("bailout kosong -> nominal 0 tanpa query sum", async () => {
    const { client, calls } = fakeDashClient([
      { count: 10, data: [] },
      { count: 0, data: [] },
      { count: 0, data: [] },
    ]);
    const stats = await getDashboardStats(client);
    expect(stats.bailoutNominal).toBe(0);
    expect(stats.bailoutCapped).toBe(false);
    expect(calls.some((c) => c.startsWith("limit:"))).toBe(false);
  });

  it("capped bila baris melebihi limit + error log+throw", async () => {
    const { client } = fakeDashClient([
      { count: 5, data: [] },
      { count: 1, data: [] },
      { count: 6000, data: [] },
      { count: null, data: [{ nominal: 10 }] },
    ]);
    const stats = await getDashboardStats(client);
    expect(stats.bailoutCapped).toBe(true);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = fakeDashClient([
        { count: null, data: [], error: { code: "42501", message: "denied" } },
      ]);
      await expect(getDashboardStats(failing.client)).rejects.toEqual({
        code: "42501",
        message: "denied",
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
