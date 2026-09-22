import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifySupabaseError,
  getDataUtamaList,
  getRegionalOptions,
  logSupabaseError,
  lookupAgenByPpid,
  sanitizeSearch,
  suggestAgen,
  toAgenProfile,
  type DataUtamaRow,
} from "./dataUtamaService";

interface Captured {
  table?: string;
  select?: [string, unknown?];
  or?: string;
  eq?: [string, unknown];
  order?: [string, unknown];
  range?: [number, number];
  not?: [string, string, unknown?];
  limit?: number;
}

function fakeClient(
  result: { data: unknown[] | null; count: number | null; error?: unknown },
  captured: Captured
): SupabaseClient {
  const builder = {
    or: (s: string) => {
      captured.or = s;
      return builder;
    },
    eq: (c: string, v: unknown) => {
      captured.eq = [c, v];
      return builder;
    },
    order: (c: string, o: unknown) => {
      captured.order = [c, o];
      return builder;
    },
    range: (a: number, b: number) => {
      captured.range = [a, b];
      return Promise.resolve({
        data: result.data,
        count: result.count,
        error: result.error ?? null,
      });
    },
    not: (c: string, op: string, v?: unknown) => {
      captured.not = [c, op, v];
      return builder;
    },
    limit: (n: number) => {
      captured.limit = n;
      return Promise.resolve({
        data: result.data,
        count: result.count,
        error: result.error ?? null,
      });
    },
  };
  return {
    from: (table: string) => {
      captured.table = table;
      return {
        select: (cols: string, opts?: unknown) => {
          captured.select = [cols, opts];
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("sanitizeSearch", () => {
  it("membuang wildcard/koma dan memangkas", () => {
    expect(sanitizeSearch("  a%b_c,d(e)  ")).toBe("a b c d e");
    expect(sanitizeSearch("x".repeat(200))).toHaveLength(100);
  });
});

describe("classifySupabaseError", () => {
  it("RLS/permission", () => {
    expect(
      classifySupabaseError({ code: "42501", message: "permission denied" }).kind
    ).toBe("rls");
    expect(
      classifySupabaseError({ message: "violates row-level security policy" })
        .kind
    ).toBe("rls");
  });

  it("kolom hilang (PGRST204/42703)", () => {
    expect(
      classifySupabaseError({ code: "PGRST204", message: "x" }).kind
    ).toBe("missing-column");
    expect(
      classifySupabaseError({
        code: "42703",
        message: 'column "foo" does not exist',
      }).kind
    ).toBe("missing-column");
  });

  it("tabel hilang dan fallback other", () => {
    expect(
      classifySupabaseError({ code: "42P01", message: "relation" }).kind
    ).toBe("missing-table");
    expect(classifySupabaseError({ message: "boom" }).kind).toBe("other");
    expect(classifySupabaseError(null).kind).toBe("other");
  });
});

describe("logSupabaseError", () => {
  it("console.error + kembalikan klasifikasi", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = logSupabaseError("list", {
        code: "42501",
        message: "permission denied",
      });
      expect(out.kind).toBe("rls");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("data-utama:list");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("getDataUtamaList", () => {
  let captured: Captured;
  beforeEach(() => {
    captured = {};
  });

  it("SELECT * + count exact + range halaman 2", async () => {
    const rows = [{ id: "1" }];
    const res = await getDataUtamaList(
      fakeClient({ data: rows, count: 45 }, captured),
      { page: 2, pageSize: 20 }
    );
    expect(captured.table).toBe("data_lengkap_utama");
    expect(captured.select?.[0]).toBe("*");
    expect(captured.range).toEqual([20, 39]);
    expect(res).toMatchObject({ total: 45, page: 2, pageSize: 20, totalPages: 3 });
    expect(res.data).toEqual(rows);
  });

  it("search merangkai OR 4 kolom; regional eq; SEMUA dilewati", async () => {
    await getDataUtamaList(
      fakeClient({ data: [], count: 0 }, captured),
      { search: "ALBI", regional: "BANDUNG" }
    );
    expect(captured.or).toContain("nama_loket_kurlog.ilike.%ALBI%");
    expect(captured.or).toContain("ppid.ilike.%ALBI%");
    expect(captured.eq).toEqual(["regional", "BANDUNG"]);

    captured = {};
    await getDataUtamaList(
      fakeClient({ data: [], count: 0 }, captured),
      { search: "   ", regional: "SEMUA" }
    );
    expect(captured.or).toBeUndefined();
    expect(captured.eq).toBeUndefined();
  });

  it("clamp page/pageSize + count null -> total 0", async () => {
    const res = await getDataUtamaList(
      fakeClient({ data: [], count: null }, captured),
      { page: -3, pageSize: 9999 }
    );
    expect(res).toMatchObject({ total: 0, page: 1, pageSize: 100, totalPages: 1 });
  });

  it("error RLS: log + throw asli", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42501", message: "permission denied" };
      await expect(
        getDataUtamaList(fakeClient({ data: null, count: null, error: err }, captured), {})
      ).rejects.toBe(err);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("error kolom hilang: log + throw asli", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "PGRST204", message: "schema cache" };
      await expect(
        getDataUtamaList(fakeClient({ data: null, count: null, error: err }, captured), {})
      ).rejects.toBe(err);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("getRegionalOptions", () => {
  it("unik, trim, abaikan kosong, terurut", async () => {
    const captured: Captured = {};
    const out = await getRegionalOptions(
      fakeClient(
        {
          data: [
            { regional: "B " },
            { regional: "A" },
            { regional: "B" },
            { regional: " " },
            { regional: null },
          ],
          count: null,
        },
        captured
      )
    );
    expect(out).toEqual(["A", "B"]);
  });

  it("error: log + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42P01", message: "relation missing" };
      await expect(
        getRegionalOptions(
          fakeClient({ data: null, count: null, error: err }, {})
        )
      ).rejects.toBe(err);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
