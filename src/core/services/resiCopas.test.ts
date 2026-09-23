import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  importResiBatch,
  isResiCopasHeader,
  mapCopasSelesai,
  parseCopasDate,
  parseResiCopasText,
  sanitizeNomorResi,
  splitCopasColumns,
  type ResiCopasItem,
} from "./resiService";

describe("splitCopasColumns", () => {
  it("prioritas TAB di atas koma/spasi", () => {
    expect(splitCopasColumns("a\tb\tc")).toEqual(["a", "b", "c"]);
    expect(splitCopasColumns("a,b,c")).toEqual(["a", "b", "c"]);
    expect(splitCopasColumns("a  b   c")).toEqual(["a", "b", "c"]);
    expect(splitCopasColumns("a|b")).toEqual(["a", "b"]);
  });
});

describe("isResiCopasHeader", () => {
  it("deteksi header 7 kolom, abaikan baris data", () => {
    expect(
      isResiCopasHeader(
        "TGL. TIKET\tNO. RESI\tAGEN\tKODE LAYANAN\tPETUGAS\tSTATUS RESI\tSELESAI"
      )
    ).toBe(true);
    expect(isResiCopasHeader("22/09/2026 20:24:04\tP2609140044492\tMUC SWEET")).toBe(
      false
    );
    expect(isResiCopasHeader("P2609140044492 MUC SWEET")).toBe(false);
  });
});

describe("parseCopasDate", () => {
  it("DD/MM/YYYY + jam -> YYYY-MM-DD; ISO lolos; sampah -> null", () => {
    expect(parseCopasDate("22/09/2026 20:24:04")).toBe("2026-09-22");
    expect(parseCopasDate("22-09-2026")).toBe("2026-09-22");
    expect(parseCopasDate("2026-09-22")).toBe("2026-09-22");
    expect(parseCopasDate("MUC SWEET")).toBeNull();
    expect(parseCopasDate("99/99/2026")).toBeNull();
  });
});

describe("mapCopasSelesai", () => {
  it("BELUM/kosong -> pending; SELESAI/SUDAH -> done", () => {
    expect(mapCopasSelesai("BELUM")).toMatchObject({
      status_followup: "BELUM_FOLLOWUP",
      is_selesai: null,
    });
    expect(mapCopasSelesai("")).toMatchObject({
      status_followup: "BELUM_FOLLOWUP",
    });
    expect(mapCopasSelesai("SELESAI")).toMatchObject({
      status_followup: "SUDAH_FOLLOWUP",
      is_selesai: "SELESAI",
    });
    expect(mapCopasSelesai("sudah")).toMatchObject({
      status_followup: "SUDAH_FOLLOWUP",
    });
  });
});

describe("parseResiCopasText", () => {
  it("7 kolom TAB + header dilewati + mapping penuh", () => {
    const raw = [
      "TGL. TIKET\tNO. RESI\tAGEN\tKODE LAYANAN\tPETUGAS\tSTATUS RESI\tSELESAI",
      "22/09/2026 20:24:04\tP2609140044492\tMUC SWEET\tPKH\tCS1 MUCSWEET\tPERJALANAN\tBELUM",
    ].join("\n");
    const { items, skipped } = parseResiCopasText(raw);
    expect(skipped).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tgl_tiket: "2026-09-22",
      no_resi: "P2609140044492",
      agen: "MUC SWEET",
      kode_layanan: "PKH",
      petugas: "CS1 MUCSWEET",
      status_resi: "PERJALANAN",
      status_followup: "BELUM_FOLLOWUP",
    });
  });

  it("koma sebagai pemisah + 5 kolom tanpa tanggal", () => {
    const { items } = parseResiCopasText(
      "P2605110091369,MUC NDH,PE,ianCC,DELIVERED"
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tgl_tiket: null,
      no_resi: "P2605110091369",
      agen: "MUC NDH",
      status_followup: "BELUM_FOLLOWUP",
    });
  });

  it("dedup case-insensitive + baris tanpa resi dilewati", () => {
    const { items, skipped } = parseResiCopasText(
      ["P2601\tA\tPE\tP\tPERJALANAN", "p2601\tB\tPE\tP\tPERJALANAN", ""].join(
        "\n"
      )
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.agen).toBe("A");
    expect(skipped).toBe(1);
  });
});

describe("sanitizeNomorResi", () => {
  it("trim + NBSP/tak kasatmata + spasi dalam + uppercase", () => {
    expect(sanitizeNomorResi("  p2609140044492 ")).toBe("P2609140044492");
    expect(sanitizeNomorResi("P260\u00a09140044492")).toBe("P2609140044492");
    expect(sanitizeNomorResi("P260\u200b9140044492")).toBe("P2609140044492");
    expect(sanitizeNomorResi("P260 9140044492")).toBe("P2609140044492");
    expect(sanitizeNomorResi(null)).toBe("");
  });
});

describe("importResiBatch (check and merge, tanpa onConflict)", () => {
  interface ExistingRow {
    nomor_resi: string;
    status_followup?: string | null;
  }

  interface Captured {
    table?: string;
    selectCols?: unknown;
    inArgs?: [string, unknown[]];
    inserted?: unknown[];
    updates: { payload: unknown; col: string; val: unknown }[];
  }

  function fakeImportClient(
    captured: Captured,
    existing: ExistingRow[] = []
  ): SupabaseClient {
    return {
      from: (table: string) => {
        captured.table = table;
        return {
          select: (cols: unknown) => {
            captured.selectCols = cols;
            return {
              in: (col: string, vals: unknown[]) => {
                captured.inArgs = [col, vals];
                const data = existing
                  .filter((r) => (vals as string[]).includes(r.nomor_resi))
                  .map((r) => ({
                    id: `id-${r.nomor_resi}`,
                    nomor_resi: r.nomor_resi,
                    status_followup: r.status_followup ?? null,
                  }));
                return Promise.resolve({ data, error: null });
              },
            };
          },
          insert: (rows: unknown) => {
            captured.inserted = rows as unknown[];
            return {
              select: () =>
                Promise.resolve({ data: (rows as unknown[]).map((_, i) => ({ id: i })), error: null }),
            };
          },
          update: (payload: unknown) => ({
            eq: (col: string, val: unknown) => {
              captured.updates?.push({ payload, col, val });
              return Promise.resolve({ data: [payload], error: null });
            },
          }),
        };
      },
    } as unknown as SupabaseClient;
  }

  const item = (noResi: string, status: "BELUM_FOLLOWUP" | "SUDAH_FOLLOWUP" = "BELUM_FOLLOWUP"): ResiCopasItem => ({
    tgl_tiket: "2026-09-22",
    no_resi: noResi,
    agen: "MUC SWEET",
    kode_layanan: "PKH",
    petugas: "CS1",
    status_resi: "PERJALANAN",
    status_followup: status,
    is_selesai: null,
  });

  it("semua baru -> insert saja, tanpa update maupun onConflict", async () => {
    const captured: Captured = { updates: [] };
    const out = await importResiBatch(
      fakeImportClient(captured, []),
      [item("P2609140044492"), item("P2609140044493")]
    );
    expect(out).toEqual({ inserted: 2, updated: 0 });
    expect(captured.table).toBe("resi");
    expect(captured.selectCols).toBe("id, nomor_resi, status_followup");
    expect(captured.inArgs?.[0]).toBe("nomor_resi");
    expect(captured.inserted).toHaveLength(2);
    expect(
      (captured.inserted?.[0] as Record<string, unknown>)
    ).toMatchObject({
      no_resi: "P2609140044492",
      nomor_resi: "P2609140044492",
      tgl_tiket: "2026-09-22",
      status_followup: "BELUM_FOLLOWUP",
    });
    expect(captured.inserted?.[0]).not.toHaveProperty("is_selesai");
    expect(captured.updates).toHaveLength(0);
  });

  it("campuran baru + lama -> insert + update per nomor_resi", async () => {
    const captured: Captured = { updates: [] };
    const out = await importResiBatch(
      fakeImportClient(captured, [{ nomor_resi: "P2609140044492" }]),
      [item("P2609140044492"), item("P2609140044499")]
    );
    expect(out).toEqual({ inserted: 1, updated: 1 });
    expect(captured.inserted).toHaveLength(1);
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates?.[0]?.col).toBe("nomor_resi");
    expect(captured.updates?.[0]?.val).toBe("P2609140044492");
  });

  it("tidak menurunkan SUDAH_FOLLOWUP menjadi BELUM saat update", async () => {
    const captured: Captured = { updates: [] };
    await importResiBatch(
      fakeImportClient(captured, [
        { nomor_resi: "P2601", status_followup: "SUDAH_FOLLOWUP" },
      ]),
      [item("P2601", "BELUM_FOLLOWUP")]
    );
    expect(captured.updates).toHaveLength(1);
    expect(
      (captured.updates?.[0]?.payload as Record<string, unknown>).status_followup
    ).toBe("SUDAH_FOLLOWUP");
  });

  it("kosong -> nol tanpa query; >500 -> throw; error cek -> log + throw", async () => {
    const noop = fakeImportClient({ updates: [] }, []);
    await expect(importResiBatch(noop, [])).resolves.toEqual({
      inserted: 0,
      updated: 0,
    });
    const big = Array.from({ length: 501 }, (_, i) => item(`R${i}`));
    await expect(importResiBatch(noop, big)).rejects.toThrow("Maksimal 500");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const errClient = {
        from: () => ({
          select: () => ({
            in: () => Promise.resolve({ data: null, error: { code: "42P10" } }),
          }),
        }),
      } as unknown as SupabaseClient;
      await expect(importResiBatch(errClient, [item("R1")])).rejects.toMatchObject({
        code: "42P10",
      });
      expect(String(spy.mock.calls[0]?.[0])).toContain("[resi:batch-check]");
    } finally {
      spy.mockRestore();
    }
  });
});
