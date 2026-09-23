import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getResiList,
  isFollowedUp,
  normalizeFollowUpStatus,
  RESI_LIST_COLUMNS,
  updateFollowUpStatus,
} from "./resiService";

interface Captured {
  table?: string;
  select?: [unknown, unknown?];
  eqs: [string, unknown][];
  or?: string;
  order?: [string, unknown];
  range?: [number, number];
  updatePayload?: unknown;
  singleCalled?: boolean;
}

/** Fake rantai query dengan antrean hasil terminal. */
function fakeClient(
  results: { data: unknown; count?: number | null; error?: unknown }[],
  captured: Captured
): SupabaseClient {
  let n = 0;
  const next = () => {
    const r = results[Math.min(n, results.length - 1)] ?? { data: [] };
    n += 1;
    return { data: r.data, count: r.count ?? null, error: r.error ?? null };
  };
  const chain: Record<string, unknown> = {};
  chain.eq = (c: string, v: unknown) => {
    captured.eqs.push([c, v]);
    return chain;
  };
  chain.or = (s: string) => {
    captured.or = s;
    return chain;
  };
  chain.select = () => chain;
  chain.order = (c: string, o: unknown) => {
    captured.order = [c, o];
    return chain;
  };
  chain.range = (a: number, b: number) => {
    captured.range = [a, b];
    return Promise.resolve(next());
  };
  chain.limit = () => Promise.resolve(next());
  chain.single = () => {
    captured.singleCalled = true;
    return Promise.resolve(next());
  };
  chain.update = (payload: unknown) => {
    captured.updatePayload = payload;
    return chain;
  };
  chain.then = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void
  ) => {
    try {
      resolve(next());
    } catch (e) {
      reject?.(e);
    }
  };
  return {
    from: (table: string) => {
      captured.table = table;
      return {
        select: (cols?: unknown, opts?: unknown) => {
          captured.select = [cols, opts];
          return chain;
        },
        insert: () => chain,
        update: (payload: unknown) => {
          captured.updatePayload = payload;
          return chain;
        },
        delete: () => chain,
      };
    },
  } as unknown as SupabaseClient;
}

const ROW = {
  id: 491,
  no_resi: "P2607180093715",
  agen: "MUC SWEET",
  status_followup: "BELUM_FOLLOWUP",
};

describe("isFollowedUp / normalizeFollowUpStatus", () => {
  it("deteksi SUDAH_FOLLOWUP case-insensitive", () => {
    expect(isFollowedUp({ status_followup: "SUDAH_FOLLOWUP" })).toBe(true);
    expect(isFollowedUp({ status_followup: " sudah_followup " })).toBe(true);
    expect(isFollowedUp({ status_followup: "BELUM_FOLLOWUP" })).toBe(false);
    expect(isFollowedUp({ status_followup: null })).toBe(false);
  });

  it("normalisasi status + tolak asing", () => {
    expect(normalizeFollowUpStatus("sudah_followup")).toBe("SUDAH_FOLLOWUP");
    expect(normalizeFollowUpStatus("BELUM_FOLLOWUP")).toBe("BELUM_FOLLOWUP");
    expect(() => normalizeFollowUpStatus("SELESAI")).toThrow("tidak valid");
  });
});

describe("getResiList", () => {
  let captured: Captured;
  beforeEach(() => {
    captured = { eqs: [] };
  });

  it("select *, count exact, filter belum + search + range", async () => {
    const res = await getResiList(
      fakeClient([{ data: [ROW], count: 90 }], captured),
      { status: "belum", search: "MUC", page: 1, pageSize: 20 }
    );
    expect(captured.table).toBe("resi");
    expect(captured.select?.[0]).toBe(RESI_LIST_COLUMNS);
    expect(captured.eqs).toEqual([["status_followup", "BELUM_FOLLOWUP"]]);
    expect(captured.or).toContain("no_resi.ilike.%MUC%");
    expect(captured.or).toContain("agen.ilike.%MUC%");
    expect(captured.range).toEqual([0, 19]);
    expect(res).toMatchObject({ total: 90, totalPages: 5 });
  });

  it("filter sudah memakai SUDAH_FOLLOWUP; semua tanpa eq", async () => {
    await getResiList(fakeClient([{ data: [], count: 0 }], captured), {
      status: "sudah",
    });
    expect(captured.eqs).toEqual([["status_followup", "SUDAH_FOLLOWUP"]]);

    captured = { eqs: [] };
    await getResiList(fakeClient([{ data: [], count: 0 }], captured), {
      status: "semua",
    });
    expect(captured.eqs).toEqual([]);
  });

  it("error: log + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42501", message: "denied" };
      await expect(
        getResiList(fakeClient([{ data: null, error: err }], captured), {})
      ).rejects.toBe(err);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("[resi:list]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("updateFollowUpStatus", () => {
  it("payload lengkap + kembalikan baris (catatan jadi riwayat)", async () => {
    const captured: Captured = { eqs: [] };
    const updated = { ...ROW, status_followup: "SUDAH_FOLLOWUP" };
    const out = await updateFollowUpStatus(
      fakeClient([{ data: updated }], captured),
      { id: 491, status: "SUDAH_FOLLOWUP", catatan: "Hubungi agen", userName: "Aldi" }
    );
    expect(out).toEqual(updated);
    expect(captured.table).toBe("resi");
    // Baca riwayat lama (eq) + update (eq).
    expect(captured.eqs).toEqual([
      ["id", 491],
      ["id", 491],
    ]);
    expect(captured.singleCalled).toBe(true);
    const payload = captured.updatePayload as Record<string, unknown>;
    expect(payload.status_followup).toBe("SUDAH_FOLLOWUP");
    const log = payload.catatan_followup as string;
    expect(log).toMatch(/^\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} - Aldi\]: Hubungi agen$/);
    expect(payload.followed_up_by).toBe("Aldi");
    expect(typeof payload.followed_up_at).toBe("string");
    expect(payload).not.toHaveProperty("status_fu");
  });

  it("catatan baru digabung di atas riwayat lama", async () => {
    const captured: Captured = { eqs: [] };
    const existing = "[22/09/2026 14:00 - Helpdesk]: Resi baru masuk.";
    await updateFollowUpStatus(
      fakeClient(
        [
          { data: { catatan_followup: existing } },
          { data: { ...ROW, status_followup: "SUDAH_FOLLOWUP" } },
        ],
        captured
      ),
      { id: 1, status: "SUDAH_FOLLOWUP", catatan: "Paket diambil", userName: "Budi" }
    );
    const log = (
      captured.updatePayload as Record<string, unknown>
    ).catatan_followup as string;
    expect(log).toContain("Paket diambil");
    expect(log).toContain("----------------------------------------");
    expect(log).toContain(existing);
    expect(log.indexOf("Paket diambil")).toBeLessThan(log.indexOf(existing));
  });

  it("catatan kosong -> riwayat dipertahankan; validasi id/user/status", async () => {
    const captured: Captured = { eqs: [] };
    const existing = "[22/09/2026 14:00 - Helpdesk]: Resi baru masuk.";
    await updateFollowUpStatus(
      fakeClient([{ data: { catatan_followup: existing } }], captured),
      { id: 1, status: "SUDAH_FOLLOWUP", catatan: "   ", userName: "Budi" }
    );
    expect((captured.updatePayload as Record<string, unknown>).catatan_followup).toBe(
      existing
    );

    const noop = fakeClient([{ data: ROW }], { eqs: [] });
    await expect(
      updateFollowUpStatus(noop, { id: 1.5, status: "SUDAH_FOLLOWUP", catatan: "", userName: "B" })
    ).rejects.toThrow("ID resi");
    await expect(
      updateFollowUpStatus(noop, { id: 1, status: "SUDAH_FOLLOWUP", catatan: "", userName: "  " })
    ).rejects.toThrow("Nama user");
    await expect(
      updateFollowUpStatus(noop, { id: 1, status: "ANEH", catatan: "", userName: "B" })
    ).rejects.toThrow("tidak valid");
  });

  it("error baca riwayat: log [resi:read-catatan] + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "PGRST204", message: "schema cache" };
      const captured: Captured = { eqs: [] };
      await expect(
        updateFollowUpStatus(fakeClient([{ data: null, error: err }], captured), {
          id: 1,
          status: "SUDAH_FOLLOWUP",
          catatan: "",
          userName: "B",
        })
      ).rejects.toBe(err);
      expect(String(spy.mock.calls[0]?.[0])).toContain("[resi:read-catatan]");
    } finally {
      spy.mockRestore();
    }
  });
});
