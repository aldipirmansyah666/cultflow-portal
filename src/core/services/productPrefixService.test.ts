import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listActiveProductPrefixes } from "./productPrefixService";

describe("listActiveProductPrefixes", () => {
  it("mengelompokkan prefix aktif per produk dan menormalkan nilai", async () => {
    const client = {
      from: (table: string) => {
        expect(table).toBe("product_prefixes");
        return {
          select: (columns: string) => {
            expect(columns).toBe("product_name,prefix");
            return {
              eq: async (column: string, value: unknown) => {
                expect(column).toBe("is_active");
                expect(value).toBe(true);
                return {
                  data: [
                    { product_name: "PKH", prefix: "OID" },
                    { product_name: "PKH", prefix: "OID" },
                    { product_name: "pkh", prefix: "xyz" },
                    { product_name: "EC3", prefix: "AB" },
                    { product_name: "EC3", prefix: "A#" },
                  ],
                  error: null,
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    await expect(listActiveProductPrefixes(client)).resolves.toEqual({
      PKH: ["OID", "XYZ"],
      EC3: ["AB"],
    });
  });

  it("mengembalikan map kosong bila belum ada prefix aktif", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(listActiveProductPrefixes(client)).resolves.toEqual({});
  });

  it("melempar error yang bisa ditangani API", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: null, error: { message: "db down" } }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(listActiveProductPrefixes(client)).rejects.toThrow(
      "Gagal membaca master prefix"
    );
  });
});
