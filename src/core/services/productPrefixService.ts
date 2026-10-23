/**
 * Service master prefix aktif (`product_prefixes`).
 *
 * Tabel hanya menyimpan prefix TAMBAHAN yang disetujui admin. Validator
 * menggabungkannya dengan daftar bawaan di `reconcileValidator.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductPrefixMap = Record<string, string[]>;

const PREFIX_RE = /^[A-Z0-9]{2,16}$/;

interface ProductPrefixRow {
  product_name: string;
  prefix: string;
}

/** Ambil semua prefix tambahan yang aktif, dikelompokkan per produk. */
export async function listActiveProductPrefixes(
  client: SupabaseClient
): Promise<ProductPrefixMap> {
  const { data, error } = await client
    .from("product_prefixes")
    .select("product_name,prefix")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Gagal membaca master prefix: ${error.message}`);
  }

  const map: ProductPrefixMap = {};
  for (const row of (data ?? []) as ProductPrefixRow[]) {
    const productName = row.product_name.trim().toUpperCase();
    const prefix = row.prefix.trim().toUpperCase();
    if (productName === "" || !PREFIX_RE.test(prefix)) continue;

    const prefixes = (map[productName] ??= []);
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }

  for (const prefixes of Object.values(map)) {
    prefixes.sort((a, b) => b.length - a.length || a.localeCompare(b));
  }
  return map;
}
