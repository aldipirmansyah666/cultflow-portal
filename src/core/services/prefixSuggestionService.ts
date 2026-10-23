/**
 * Service usulan prefix resi (`product_prefix_suggestions`).
 *
 * Validator mengirim kelompok prefix tak dikenal (produk + 3 karakter awal
 * resi). Service memvalidasi payload dari client lalu memanggil satu RPC
 * upsert atomik agar occurrence_count diakumulasi tanpa race condition.
 * Keputusan admin memakai RPC terpisah yang juga mengaktifkan/menonaktifkan
 * prefix di tabel master `product_prefixes` dalam transaksi yang sama.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PrefixSuggestionInput {
  productName: string;
  suggestedPrefix: string;
  sampleResi: string;
  occurrenceCount: number;
}

export type PrefixSuggestionStatus = "pending" | "approved" | "rejected";

export interface StoredPrefixSuggestion {
  id: string;
  productName: string;
  suggestedPrefix: string;
  sampleResi: string | null;
  occurrenceCount: number;
  status: PrefixSuggestionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PrefixSuggestionDecision {
  productName: string;
  suggestedPrefix: string;
  status: "approved" | "rejected";
}

const PREFIX_RE = /^[A-Z0-9]{3}$/;
const MAX_SUGGESTIONS = 500;
const MAX_PRODUCT_NAME_LENGTH = 100;
const MAX_SAMPLE_LENGTH = 512;
const MAX_OCCURRENCE = 10_000_000;

const PREFIX_COLUMNS =
  "id,product_name,suggested_prefix,sample_resi,occurrence_count,status,created_at,updated_at";

interface PrefixSuggestionRow {
  id: string;
  product_name: string;
  suggested_prefix: string;
  sample_resi: string | null;
  occurrence_count: number;
  status: PrefixSuggestionStatus;
  created_at: string;
  updated_at: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function suggestionKey(productName: string, suggestedPrefix: string): string {
  return `${productName}\u0000${suggestedPrefix}`;
}

function mapRow(row: PrefixSuggestionRow): StoredPrefixSuggestion {
  return {
    id: row.id,
    productName: row.product_name,
    suggestedPrefix: row.suggested_prefix,
    sampleResi: row.sample_resi,
    occurrenceCount: row.occurrence_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Validasi payload usulan; null bila ada item yang tidak sah. */
export function validatePrefixSuggestions(
  raw: unknown
): PrefixSuggestionInput[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SUGGESTIONS) return null;

  const suggestions: PrefixSuggestionInput[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) return null;
    const item = value as Record<string, unknown>;

    const productName = normalizeText(item.productName).toUpperCase();
    const suggestedPrefix = normalizeText(item.suggestedPrefix).toUpperCase();
    const sampleResi = normalizeText(item.sampleResi);
    const occurrenceCount = item.occurrenceCount;

    if (
      productName === "" ||
      productName.length > MAX_PRODUCT_NAME_LENGTH ||
      !PREFIX_RE.test(suggestedPrefix) ||
      sampleResi === "" ||
      !Number.isInteger(occurrenceCount) ||
      (occurrenceCount as number) < 1 ||
      (occurrenceCount as number) > MAX_OCCURRENCE
    ) {
      return null;
    }

    suggestions.push({
      productName,
      suggestedPrefix,
      sampleResi: sampleResi.slice(0, MAX_SAMPLE_LENGTH),
      occurrenceCount: occurrenceCount as number,
    });
  }

  return suggestions;
}

/** Validasi keputusan admin; hanya approved/rejected yang diterima. */
export function validatePrefixSuggestionDecision(
  raw: unknown
): PrefixSuggestionDecision | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const productName = normalizeText(item.productName).toUpperCase();
  const suggestedPrefix = normalizeText(item.suggestedPrefix).toUpperCase();
  const status = item.status;

  if (
    productName === "" ||
    productName.length > MAX_PRODUCT_NAME_LENGTH ||
    !PREFIX_RE.test(suggestedPrefix) ||
    (status !== "approved" && status !== "rejected")
  ) {
    return null;
  }

  return { productName, suggestedPrefix, status };
}

/**
 * Upsert batch usulan prefix. Satu RPC = satu transaksi; bila salah satu
 * item gagal, tidak ada occurrence_count yang bertambah setengah jalan.
 */
export async function recordPrefixSuggestions(
  client: SupabaseClient,
  suggestions: PrefixSuggestionInput[]
): Promise<number> {
  if (suggestions.length === 0) return 0;

  const { data, error } = await client.rpc(
    "record_product_prefix_suggestions",
    {
      p_suggestions: suggestions.map((suggestion) => ({
        product_name: suggestion.productName,
        suggested_prefix: suggestion.suggestedPrefix,
        sample_resi: suggestion.sampleResi,
        occurrence_count: suggestion.occurrenceCount,
      })),
    }
  );

  if (error) {
    throw new Error(`Gagal menyimpan usulan prefix: ${error.message}`);
  }

  return typeof data === "number" ? data : suggestions.length;
}

/**
 * Ambil kembali baris yang baru di-upsert agar UI mendapat id/status resmi
 * dari database (bukan menebak dari state client).
 */
export async function listStoredPrefixSuggestions(
  client: SupabaseClient,
  suggestions: Pick<PrefixSuggestionInput, "productName" | "suggestedPrefix">[]
): Promise<StoredPrefixSuggestion[]> {
  if (suggestions.length === 0) return [];

  const productNames = [
    ...new Set(suggestions.map((suggestion) => suggestion.productName)),
  ];
  const { data, error } = await client
    .from("product_prefix_suggestions")
    .select(PREFIX_COLUMNS)
    .in("product_name", productNames);

  if (error) {
    throw new Error(`Gagal membaca usulan prefix: ${error.message}`);
  }

  const wanted = new Set(
    suggestions.map((suggestion) =>
      suggestionKey(suggestion.productName, suggestion.suggestedPrefix)
    )
  );
  const rows = (data ?? []) as PrefixSuggestionRow[];
  return rows
    .filter((row) =>
      wanted.has(suggestionKey(row.product_name, row.suggested_prefix))
    )
    .map(mapRow);
}

/**
 * Ubah status satu usulan dan sinkronkan master prefix dalam satu transaksi
 * database. Null bila baris usulan tidak ditemukan.
 */
export async function updatePrefixSuggestionStatus(
  client: SupabaseClient,
  decision: PrefixSuggestionDecision
): Promise<StoredPrefixSuggestion | null> {
  const { data, error } = await client.rpc(
    "decide_product_prefix_suggestion",
    {
      p_product_name: decision.productName,
      p_suggested_prefix: decision.suggestedPrefix,
      p_status: decision.status,
    }
  );

  if (error) {
    throw new Error(`Gagal memperbarui usulan prefix: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return mapRow(row as PrefixSuggestionRow);
}
