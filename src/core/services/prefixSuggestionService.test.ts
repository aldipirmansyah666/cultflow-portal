import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listPendingPrefixSuggestions,
  listStoredPrefixSuggestions,
  recordPrefixSuggestions,
  updatePrefixSuggestionStatus,
  validatePrefixSuggestionDecision,
  validatePrefixSuggestions,
  type PrefixSuggestionDecision,
  type PrefixSuggestionInput,
} from "./prefixSuggestionService";

const VALID: PrefixSuggestionInput = {
  productName: "PKH",
  suggestedPrefix: "XYZ",
  sampleResi: "XYZ001",
  occurrenceCount: 2,
};

describe("validatePrefixSuggestions", () => {
  it("menerima payload valid dan menormalkan huruf besar/spasi", () => {
    expect(
      validatePrefixSuggestions([
        {
          productName: " pkh ",
          suggestedPrefix: " xyz ",
          sampleResi: " XYZ001 ",
          occurrenceCount: 2,
        },
      ])
    ).toEqual([VALID]);
  });

  it("menerima array kosong", () => {
    expect(validatePrefixSuggestions([])).toEqual([]);
  });

  it("menolak payload yang bukan array atau item tidak sah", () => {
    expect(validatePrefixSuggestions(null)).toBeNull();
    expect(validatePrefixSuggestions({})).toBeNull();
    expect(validatePrefixSuggestions([null])).toBeNull();
    expect(
      validatePrefixSuggestions([{ ...VALID, productName: "" }])
    ).toBeNull();
    expect(
      validatePrefixSuggestions([{ ...VALID, suggestedPrefix: "XY" }])
    ).toBeNull();
    expect(
      validatePrefixSuggestions([{ ...VALID, suggestedPrefix: "X#Z" }])
    ).toBeNull();
    expect(
      validatePrefixSuggestions([{ ...VALID, sampleResi: "" }])
    ).toBeNull();
    expect(
      validatePrefixSuggestions([{ ...VALID, occurrenceCount: 0 }])
    ).toBeNull();
    expect(
      validatePrefixSuggestions([{ ...VALID, occurrenceCount: 1.5 }])
    ).toBeNull();
  });

  it("membatasi jumlah maksimal usulan dalam satu payload", () => {
    const tooMany = Array.from({ length: 501 }, () => VALID);
    expect(validatePrefixSuggestions(tooMany)).toBeNull();
  });
});

describe("validatePrefixSuggestionDecision", () => {
  it("menerima approved/rejected dan menormalkan key", () => {
    expect(
      validatePrefixSuggestionDecision({
        productName: " pkh ",
        suggestedPrefix: " xyz ",
        status: "approved",
      })
    ).toEqual({
      productName: "PKH",
      suggestedPrefix: "XYZ",
      status: "approved",
    });
  });

  it("menolak status pending, prefix tidak sah, dan payload rusak", () => {
    expect(validatePrefixSuggestionDecision(null)).toBeNull();
    expect(
      validatePrefixSuggestionDecision({
        productName: "PKH",
        suggestedPrefix: "XYZ",
        status: "pending",
      })
    ).toBeNull();
    expect(
      validatePrefixSuggestionDecision({
        productName: "PKH",
        suggestedPrefix: "XY",
        status: "approved",
      })
    ).toBeNull();
  });
});

describe("recordPrefixSuggestions", () => {
  it("memanggil RPC upsert dengan payload snake_case", async () => {
    const client = {
      rpc: async (name: string, args: unknown) => {
        expect(name).toBe("record_product_prefix_suggestions");
        expect(args).toEqual({
          p_suggestions: [
            {
              product_name: "PKH",
              suggested_prefix: "XYZ",
              sample_resi: "XYZ001",
              occurrence_count: 2,
            },
          ],
        });
        return { data: 1, error: null };
      },
    } as unknown as SupabaseClient;

    await expect(recordPrefixSuggestions(client, [VALID])).resolves.toBe(1);
  });

  it("tidak memanggil RPC untuk array kosong", async () => {
    const client = {
      rpc: async () => {
        throw new Error("tidak boleh dipanggil");
      },
    } as unknown as SupabaseClient;

    await expect(recordPrefixSuggestions(client, [])).resolves.toBe(0);
  });

  it("melempar error yang bisa ditangani API", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "db down" } }),
    } as unknown as SupabaseClient;

    await expect(recordPrefixSuggestions(client, [VALID])).rejects.toThrow(
      "Gagal menyimpan usulan prefix"
    );
  });
});

describe("listStoredPrefixSuggestions", () => {
  it("mengambil baris yang cocok dan memetakan snake_case", async () => {
    const client = {
      from: (table: string) => {
        expect(table).toBe("product_prefix_suggestions");
        return {
          select: (columns: string) => {
            expect(columns).toContain("status");
            return {
              in: async (column: string, values: string[]) => {
                expect(column).toBe("product_name");
                expect(values).toEqual(["PKH", "EC3"]);
                return {
                  data: [
                    {
                      id: "s-1",
                      product_name: "PKH",
                      suggested_prefix: "XYZ",
                      sample_resi: "XYZ001",
                      occurrence_count: 5,
                      status: "pending",
                      created_at: "2026-10-23T00:00:00Z",
                      updated_at: "2026-10-23T00:00:00Z",
                    },
                    {
                      id: "s-2",
                      product_name: "EC3",
                      suggested_prefix: "TTS",
                      sample_resi: "TTSPOS1",
                      occurrence_count: 1,
                      status: "approved",
                      created_at: "2026-10-23T00:00:00Z",
                      updated_at: "2026-10-23T00:00:00Z",
                    },
                    {
                      id: "s-3",
                      product_name: "PJB",
                      suggested_prefix: "ABC",
                      sample_resi: "ABC001",
                      occurrence_count: 9,
                      status: "pending",
                      created_at: "2026-10-23T00:00:00Z",
                      updated_at: "2026-10-23T00:00:00Z",
                    },
                  ],
                  error: null,
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const stored = await listStoredPrefixSuggestions(client, [
      VALID,
      { productName: "EC3", suggestedPrefix: "TTS" },
    ]);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      id: "s-1",
      productName: "PKH",
      suggestedPrefix: "XYZ",
      occurrenceCount: 5,
      status: "pending",
    });
    expect(stored[1]).toMatchObject({
      id: "s-2",
      productName: "EC3",
      suggestedPrefix: "TTS",
      status: "approved",
    });
  });

  it("tidak query untuk daftar kosong", async () => {
    const client = {
      from: () => {
        throw new Error("tidak boleh dipanggil");
      },
    } as unknown as SupabaseClient;

    await expect(listStoredPrefixSuggestions(client, [])).resolves.toEqual([]);
  });
});

describe("listPendingPrefixSuggestions", () => {
  it("mengambil pending terbaru beserta jumlah total", async () => {
    const client = {
      from: (table: string) => {
        expect(table).toBe("product_prefix_suggestions");
        return {
          select: (columns: string, options: { count?: string }) => {
            expect(columns).toContain("suggested_prefix");
            expect(options.count).toBe("exact");
            return {
              eq: (column: string, value: string) => {
                expect(column).toBe("status");
                expect(value).toBe("pending");
                return {
                  order: (column: string, options: { ascending: boolean }) => {
                    expect(options.ascending).toBe(false);
                    expect(["updated_at", "occurrence_count"]).toContain(column);
                    return {
                      order: (
                        column2: string,
                        options2: { ascending: boolean }
                      ) => {
                        expect(options2.ascending).toBe(false);
                        expect(column2).toBe("occurrence_count");
                        return {
                          limit: async (limit: number) => {
                            expect(limit).toBe(10);
                            return {
                              data: [
                                {
                                  id: "s-9",
                                  product_name: "PKH",
                                  suggested_prefix: "BAC",
                                  sample_resi: "BAC001",
                                  occurrence_count: 4,
                                  status: "pending",
                                  created_at: "2026-10-23T00:00:00Z",
                                  updated_at: "2026-10-23T01:00:00Z",
                                },
                              ],
                              count: 3,
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    await expect(listPendingPrefixSuggestions(client)).resolves.toEqual({
      pendingCount: 3,
      suggestions: [
        {
          id: "s-9",
          productName: "PKH",
          suggestedPrefix: "BAC",
          sampleResi: "BAC001",
          occurrenceCount: 4,
          status: "pending",
          createdAt: "2026-10-23T00:00:00Z",
          updatedAt: "2026-10-23T01:00:00Z",
        },
      ],
    });
  });

  it("membatasi limit dan fallback count ke jumlah baris", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: async (limit: number) => {
                  expect(limit).toBe(50);
                  return { data: [], count: null, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(listPendingPrefixSuggestions(client, 999)).resolves.toEqual({
      pendingCount: 0,
      suggestions: [],
    });
  });

  it("melempar error bila query gagal", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: async () => ({
                  data: null,
                  count: null,
                  error: { message: "db down" },
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(listPendingPrefixSuggestions(client)).rejects.toThrow(
      "Gagal membaca usulan prefix pending"
    );
  });
});

describe("updatePrefixSuggestionStatus", () => {
  const DECISION: PrefixSuggestionDecision = {
    productName: "PKH",
    suggestedPrefix: "XYZ",
    status: "approved",
  };

  it("memanggil RPC atomik dengan parameter keputusan dan memetakan hasil", async () => {
    const client = {
      rpc: async (name: string, params: unknown) => {
        expect(name).toBe("decide_product_prefix_suggestion");
        expect(params).toEqual({
          p_product_name: "PKH",
          p_suggested_prefix: "XYZ",
          p_status: "approved",
        });
        return {
          data: {
            id: "s-1",
            product_name: "PKH",
            suggested_prefix: "XYZ",
            sample_resi: "XYZ001",
            occurrence_count: 5,
            status: "approved",
            created_at: "2026-10-23T00:00:00Z",
            updated_at: "2026-10-23T01:00:00Z",
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    await expect(
      updatePrefixSuggestionStatus(client, DECISION)
    ).resolves.toMatchObject({
      id: "s-1",
      status: "approved",
    });
  });

  it("menerima hasil RPC berbentuk array", async () => {
    const client = {
      rpc: async () => ({
        data: [
          {
            id: "s-2",
            product_name: "EC3",
            suggested_prefix: "TTS",
            sample_resi: "TTS001",
            occurrence_count: 2,
            status: "rejected",
            created_at: "2026-10-23T00:00:00Z",
            updated_at: "2026-10-23T01:00:00Z",
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;

    await expect(
      updatePrefixSuggestionStatus(client, {
        productName: "EC3",
        suggestedPrefix: "TTS",
        status: "rejected",
      })
    ).resolves.toMatchObject({ id: "s-2", status: "rejected" });
  });

  it("mengembalikan null bila usulan tidak ditemukan", async () => {
    const client = {
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient;

    await expect(
      updatePrefixSuggestionStatus(client, DECISION)
    ).resolves.toBeNull();
  });

  it("melempar error bila RPC gagal", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    } as unknown as SupabaseClient;

    await expect(
      updatePrefixSuggestionStatus(client, DECISION)
    ).rejects.toThrow("Gagal memperbarui usulan prefix");
  });
});
