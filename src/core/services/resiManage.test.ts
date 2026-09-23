import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendHistoryLog,
  deleteResi,
  deleteResiBatch,
  formatHistoryEntry,
  getMonitoringResiList,
  getPurgeCutoff,
  isAutoCloseNote,
  normalizeFilterDate,
  normalizeFollowUpStatus,
  normalizeResiStatusChoice,
  parseHistoryLog,
  purgeExpiredResi,
  updateFollowUpStatus,
  updateResiStatus,
} from "./resiService";

describe("normalizeFollowUpStatus / normalizeResiStatusChoice", () => {
  it("terima BELUM/PROSES/SUDAH case-insensitive; SELESAI tetap asing", () => {
    expect(normalizeFollowUpStatus("proses_followup")).toBe("PROSES_FOLLOWUP");
    expect(normalizeFollowUpStatus(" BELUM_followup ")).toBe("BELUM_FOLLOWUP");
    expect(() => normalizeFollowUpStatus("SELESAI")).toThrow("tidak valid");
    expect(() => normalizeFollowUpStatus("ANEH")).toThrow("tidak valid");
  });

  it("SELESAI -> SUDAH + flag; lain -> flag null", () => {
    expect(normalizeResiStatusChoice("SELESAI")).toEqual({
      status_followup: "SUDAH_FOLLOWUP",
      is_selesai: "SELESAI",
    });
    expect(normalizeResiStatusChoice("proses_followup")).toEqual({
      status_followup: "PROSES_FOLLOWUP",
      is_selesai: null,
    });
  });
});

describe("normalizeFilterDate", () => {
  it("YYYY-MM-DD valid; kosong -> null; kalender salah -> throw", () => {
    expect(normalizeFilterDate("2026-09-01")).toBe("2026-09-01");
    expect(normalizeFilterDate("")).toBeNull();
    expect(normalizeFilterDate(undefined)).toBeNull();
    expect(() => normalizeFilterDate("01-09-2026")).toThrow("tidak valid");
    expect(() => normalizeFilterDate("2026-02-30")).toThrow("tidak valid");
    expect(() => normalizeFilterDate("2026-13-01")).toThrow("tidak valid");
  });
});

interface ListCaptured {
  table?: string;
  eqs: [string, unknown][];
  gte?: [string, unknown];
  lte?: [string, unknown];
  range?: [number, number];
}

function fakeListClient(captured: ListCaptured): SupabaseClient {
  const chain: Record<string, unknown> = {};
  chain.eq = (c: string, v: unknown) => {
    captured.eqs.push([c, v]);
    return chain;
  };
  chain.gte = (c: string, v: unknown) => {
    captured.gte = [c, v];
    return chain;
  };
  chain.lte = (c: string, v: unknown) => {
    captured.lte = [c, v];
    return chain;
  };
  chain.or = () => chain;
  chain.order = () => chain;
  chain.range = (a: number, b: number) => {
    captured.range = [a, b];
    return Promise.resolve({ data: [], count: 0, error: null });
  };
  return {
    from: (table: string) => {
      captured.table = table;
      return {
        select: () => chain,
      };
    },
  } as unknown as SupabaseClient;
}

describe("getMonitoringResiList — filter tanggal", () => {
  it("terapkan gte/lte created_at batas hari penuh", async () => {
    const captured: ListCaptured = { eqs: [] };
    await getMonitoringResiList(fakeListClient(captured), {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(captured.gte).toEqual(["created_at", "2026-09-01T00:00:00"]);
    expect(captured.lte).toEqual(["created_at", "2026-09-30T23:59:59.999"]);
  });

  it("tanpa tanggal -> tanpa gte/lte; rentang terbalik -> throw", async () => {
    const captured: ListCaptured = { eqs: [] };
    await getMonitoringResiList(fakeListClient(captured), {});
    expect(captured.gte).toBeUndefined();
    expect(captured.lte).toBeUndefined();

    await expect(
      getMonitoringResiList(fakeListClient({ eqs: [] }), {
        startDate: "2026-09-30",
        endDate: "2026-09-01",
      })
    ).rejects.toThrow("Rentang tanggal");
  });
});

describe("updateResiStatus", () => {
  function fakeUpdateClient(
    captured: Record<string, unknown>,
    existingCatatan: string | null = null
  ): SupabaseClient {
    const row = { id: 7, status_followup: "PROSES_FOLLOWUP" };
    return {
      from: (table: string) => {
        captured.table = table;
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { catatan_followup: existingCatatan },
                  error: null,
                }),
            }),
          }),
          update: (payload: unknown) => {
            captured.payload = payload;
            return {
              eq: (c: string, v: unknown) => {
                captured.eq = [c, v];
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: row, error: null }),
                  }),
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("payload status + flag + pelaksana + timestamp", async () => {
    const captured: Record<string, unknown> = {};
    const out = await updateResiStatus(fakeUpdateClient(captured), {
      id: 7,
      status: "SELESAI",
      catatan: "Paket diterima",
      userName: "Aldi",
    });
    expect(out).toMatchObject({ id: 7 });
    const payload = captured.payload as Record<string, unknown>;
    expect(payload.status_followup).toBe("SUDAH_FOLLOWUP");
    expect(payload.is_selesai).toBe("SELESAI");
    expect(payload.catatan_followup).toMatch(
      /^\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} - Aldi\]: Paket diterima$/
    );
    expect(payload.followed_up_by).toBe("Aldi");
    expect(typeof payload.followed_up_at).toBe("string");
    expect(captured.eq).toEqual(["id", 7]);
  });

  it("gaya posisional; BELUM -> flag null + catatan kosong -> null", async () => {
    const captured: Record<string, unknown> = {};
    await updateResiStatus(
      fakeUpdateClient(captured),
      7,
      "BELUM_FOLLOWUP",
      "   ",
      "Budi"
    );
    const payload = captured.payload as Record<string, unknown>;
    expect(payload.is_selesai).toBeNull();
    expect(payload.catatan_followup).toBeNull();
  });

  it("SELESAI tanpa catatan / id / user / status asing -> throw", async () => {
    const noop = fakeUpdateClient({});
    await expect(
      updateResiStatus(noop, { id: 1, status: "SELESAI", userName: "B" })
    ).rejects.toThrow("Catatan wajib");
    await expect(
      updateResiStatus(noop, { id: 1.5, status: "PROSES_FOLLOWUP", userName: "B" })
    ).rejects.toThrow("ID resi");
    await expect(
      updateResiStatus(noop, { id: 1, status: "ANEH", userName: "B" })
    ).rejects.toThrow("tidak valid");
    await expect(
      updateResiStatus(noop, { id: 1, status: "PROSES_FOLLOWUP", userName: "  " })
    ).rejects.toThrow("Nama user");
  });

  it("error update: log [resi:update-status] + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42501", message: "denied" };
      const errClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { catatan_followup: null }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: null, error: err }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;
      await expect(
        updateResiStatus(errClient, { id: 1, status: "PROSES_FOLLOWUP", userName: "B" })
      ).rejects.toBe(err);
      expect(String(spy.mock.calls[0]?.[0])).toContain("[resi:update-status]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("deleteResi / deleteResiBatch", () => {
  it("deleteResi: eq id + validasi", async () => {
    let eqArg: [string, unknown] | undefined;
    const client = {
      from: (table: string) => {
        expect(table).toBe("resi");
        return {
          delete: () => ({
            eq: (c: string, v: unknown) => {
              eqArg = [c, v];
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      },
    } as unknown as SupabaseClient;
    await deleteResi(client, 9);
    expect(eqArg).toEqual(["id", 9]);
    await expect(deleteResi(client, 1.5)).rejects.toThrow("ID resi");
  });

  it("deleteResiBatch: in(id) + ringkasan; kosong -> nol", async () => {
    const inArgs: [string, unknown[]][] = [];
    const client = {
      from: () => ({
        delete: () => ({
          in: (c: string, v: unknown[]) => {
            inArgs.push([c, v]);
            return {
              select: () =>
                Promise.resolve({
                  data: v.map((id) => ({ id })),
                  error: null,
                }),
            };
          },
        }),
      }),
    } as unknown as SupabaseClient;
    const out = await deleteResiBatch(client, [1, 2, 2, 3]);
    expect(out).toEqual({ deleted: 3 });
    expect(inArgs).toEqual([["id", [1, 2, 3]]]);
    await expect(deleteResiBatch(client, [])).resolves.toEqual({ deleted: 0 });
    await expect(deleteResiBatch(client, [1.5, NaN])).resolves.toEqual({
      deleted: 0,
    });
  });

  it("error batch: log [resi:delete-batch] + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42501", message: "denied" };
      const errClient = {
        from: () => ({
          delete: () => ({
            in: () => ({
              select: () => Promise.resolve({ data: null, error: err }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;
      await expect(deleteResiBatch(errClient, [1])).rejects.toBe(err);
      expect(String(spy.mock.calls[0]?.[0])).toContain("[resi:delete-batch]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isAutoCloseNote", () => {
  it("deteksi deliv/delivered/retur case-insensitive", () => {
    expect(isAutoCloseNote("paket deliv ke agen")).toBe(true);
    expect(isAutoCloseNote("Paket DELIVERED ke pembeli")).toBe(true);
    expect(isAutoCloseNote("retur barang rusak")).toBe(true);
    expect(isAutoCloseNote("Hubungi agen")).toBe(false);
    expect(isAutoCloseNote("")).toBe(false);
    expect(isAutoCloseNote(null)).toBe(false);
  });
});

describe("otomatisasi CLOSE dari catatan follow-up", () => {
  function fakeStatusClient(
    captured: Record<string, unknown>,
    existingCatatan: string | null = null
  ): SupabaseClient {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { catatan_followup: existingCatatan },
                error: null,
              }),
          }),
        }),
        update: (payload: unknown) => {
          captured.payload = payload;
          return {
            eq: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: 3 }, error: null }),
              }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;
  }

  it.each([
    ["deliv ke agen", "BELUM_FOLLOWUP"],
    ["Paket DELIVERED ke pembeli", "PROSES_FOLLOWUP"],
    ["retur barang rusak", "BELUM_FOLLOWUP"],
  ])("updateResiStatus: catatan %p memaksa CLOSE", async (note, status) => {
    const captured: Record<string, unknown> = {};
    await updateResiStatus(fakeStatusClient(captured), {
      id: 3,
      status,
      catatan: note,
      userName: "Aldi",
    });
    const payload = captured.payload as Record<string, unknown>;
    expect(payload.status_followup).toBe("SUDAH_FOLLOWUP");
    expect(payload.is_selesai).toBe("SELESAI");
    expect(typeof payload.closed_at).toBe("string");
    expect(typeof payload.followed_up_at).toBe("string");
  });

  it("updateFollowUpStatus: catatan retur memaksa CLOSE", async () => {
    const captured: Record<string, unknown> = {};
    await updateFollowUpStatus(fakeStatusClient(captured), {
      id: 3,
      status: "BELUM_FOLLOWUP",
      catatan: "retur barang rusak",
      userName: "Aldi",
    });
    const payload = captured.payload as Record<string, unknown>;
    expect(payload.status_followup).toBe("SUDAH_FOLLOWUP");
    expect(payload.is_selesai).toBe("SELESAI");
    expect(typeof payload.closed_at).toBe("string");
  });

  it("catatan biasa -> status normal tanpa closed_at", async () => {
    const captured: Record<string, unknown> = {};
    await updateResiStatus(fakeStatusClient(captured), {
      id: 3,
      status: "PROSES_FOLLOWUP",
      catatan: "Hubungi agen",
      userName: "Aldi",
    });
    const payload = captured.payload as Record<string, unknown>;
    expect(payload.status_followup).toBe("PROSES_FOLLOWUP");
    expect(payload.is_selesai).toBeNull();
    expect(payload).not.toHaveProperty("closed_at");
  });
});

describe("purgeExpiredResi", () => {
  it("getPurgeCutoff = now - 2 hari (murni)", () => {
    expect(getPurgeCutoff(new Date("2026-09-23T00:00:00.000Z"))).toBe(
      "2026-09-21T00:00:00.000Z"
    );
  });

  it("resi CLOSE >2 hari teridentifikasi untuk dihapus", async () => {
    const ops: Record<string, unknown>[] = [];
    // Antrean respons per query delete (4 query: 2 penanda x 2 umur).
    const queue: { id: number }[][] = [[{ id: 1 }, { id: 2 }], [], [{ id: 3 }], []];
    const client = {
      from: (table: string) => {
        expect(table).toBe("resi");
        return {
          delete: () => ({
            eq: (col: string, val: unknown) => {
              ops.push({ eq: [col, val] });
              return {
                lte: (col2: string, val2: unknown) => {
                  ops.push({ lte: [col2, val2] });
                  return {
                    select: () => {
                      ops.push({ select: "id" });
                      return Promise.resolve({
                        data: queue.shift() ?? [],
                        error: null,
                      });
                    },
                  };
                },
                is: (col2: string, val2: unknown) => {
                  ops.push({ is: [col2, val2] });
                  return {
                    lte: (col3: string, val3: unknown) => {
                      ops.push({ lte: [col3, val3] });
                      return {
                        select: () =>
                          Promise.resolve({
                            data: queue.shift() ?? [],
                            error: null,
                          }),
                      };
                    },
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;

    const out = await purgeExpiredResi(
      client,
      new Date("2026-09-23T00:00:00.000Z")
    );
    expect(out).toEqual({ purged: 3 });
    // Penanda tutup: is_selesai=SELESAI dan legacy status_followup=CLOSE.
    expect(ops).toContainEqual({ eq: ["is_selesai", "SELESAI"] });
    expect(ops).toContainEqual({ eq: ["status_followup", "CLOSE"] });
    // Batas umur 2 hari dari closed_at maupun followed_up_at.
    expect(ops).toContainEqual({
      lte: ["closed_at", "2026-09-21T00:00:00.000Z"],
    });
    expect(ops).toContainEqual({ is: ["closed_at", null] });
    expect(ops).toContainEqual({
      lte: ["followed_up_at", "2026-09-21T00:00:00.000Z"],
    });
  });

  it("error purge: log [resi:purge] + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42501", message: "denied" };
      const errClient = {
        from: () => ({
          delete: () => ({
            eq: () => ({
              lte: () => ({
                select: () => Promise.resolve({ data: null, error: err }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;
      await expect(purgeExpiredResi(errClient)).rejects.toBe(err);
      expect(String(spy.mock.calls[0]?.[0])).toContain("[resi:purge]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("riwayat catatan follow-up (append, bukan timpa)", () => {
  it("format entri + gabung di atas riwayat lama", () => {
    const at = new Date("2026-09-23T03:30:00.000Z"); // 10:30 WIB
    expect(formatHistoryEntry("CS1", "Paket dijemput", at)).toBe(
      "[23/09/2026 10:30 - CS1]: Paket dijemput"
    );
    const old = "[22/09/2026 14:00 - Helpdesk]: Resi baru masuk.";
    const merged = appendHistoryLog(
      old,
      "[23/09/2026 10:30 - CS1]: Paket dijemput"
    ) as string;
    expect(merged).toBe(
      "[23/09/2026 10:30 - CS1]: Paket dijemput\n----------------------------------------\n" +
        old
    );
    expect(parseHistoryLog(merged)).toEqual([
      "[23/09/2026 10:30 - CS1]: Paket dijemput",
      old,
    ]);
  });

  it("kosong -> null / pertahankan lama; parse kosong -> []", () => {
    expect(appendHistoryLog(null, "")).toBeNull();
    expect(appendHistoryLog("  ", "")).toBeNull();
    expect(appendHistoryLog("[lama]: x", "")).toBe("[lama]: x");
    expect(appendHistoryLog(null, "[baru]: y")).toBe("[baru]: y");
    expect(parseHistoryLog(null)).toEqual([]);
    expect(parseHistoryLog("  ")).toEqual([]);
    expect(parseHistoryLog("[satu]: x")).toEqual(["[satu]: x"]);
  });
});
