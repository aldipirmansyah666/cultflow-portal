/**
 * Service audit `reconcile_runs` — mencatat setiap validasi Reconcile selesai.
 *
 * Client-agnostic: terima SupabaseClient (service_role di API server).
 * Metadata hasil divalidasi ketat sebelum insert; angka ringkasan berasal
 * dari client, jadi tabel ini adalah audit operasional, bukan bukti kriptografis.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReconcileRunInput {
  fileName: string;
  fileSha256: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

export interface ReconcileRun extends ReconcileRunInput {
  id: string;
  userId: string;
  createdAt: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_ROWS = 10_000_000;

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_ROWS
  );
}

/** Validasi payload audit; null bila ada field yang tidak sah. */
export function validateReconcileRunInput(
  raw: unknown
): ReconcileRunInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const fileName =
    typeof input.fileName === "string" ? input.fileName.trim() : "";
  const fileSha256 =
    typeof input.fileSha256 === "string"
      ? input.fileSha256.trim().toLowerCase()
      : "";
  if (fileName === "" || fileName.length > 255) return null;
  if (!SHA256_RE.test(fileSha256)) return null;
  if (
    !isCount(input.totalRows) ||
    !isCount(input.validRows) ||
    !isCount(input.invalidRows)
  ) {
    return null;
  }
  if (input.totalRows !== input.validRows + input.invalidRows) return null;
  return {
    fileName,
    fileSha256,
    totalRows: input.totalRows,
    validRows: input.validRows,
    invalidRows: input.invalidRows,
  };
}

/** Simpan satu run audit; melempar error bila insert gagal. */
export async function recordReconcileRun(
  client: SupabaseClient,
  userId: string,
  input: ReconcileRunInput
): Promise<ReconcileRun> {
  const { data, error } = await client
    .from("reconcile_runs")
    .insert({
      user_id: userId,
      file_name: input.fileName,
      file_sha256: input.fileSha256,
      total_rows: input.totalRows,
      valid_rows: input.validRows,
      invalid_rows: input.invalidRows,
    })
    .select(
      "id,user_id,file_name,file_sha256,total_rows,valid_rows,invalid_rows,created_at"
    )
    .single();

  if (error) {
    throw new Error(`Gagal menyimpan audit Reconcile: ${error.message}`);
  }

  const row = data as {
    id: string;
    user_id: string;
    file_name: string;
    file_sha256: string;
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    created_at: string;
  };

  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    fileSha256: row.file_sha256,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    invalidRows: row.invalid_rows,
    createdAt: row.created_at,
  };
}

export interface ReconcilePruneResult {
  deletedReconcileRuns: number;
  deletedPrefixSuggestions: number;
}

/**
 * Jalankan retensi setelah insert audit. Kegagalan cleanup tidak boleh
 * membatalkan audit, jadi pemanggil API menangkap error ini secara terpisah.
 */
export async function pruneReconcileHistory(
  client: SupabaseClient
): Promise<ReconcilePruneResult> {
  const { data, error } = await client.rpc("prune_reconcile_history");
  if (error) {
    throw new Error(`Gagal membersihkan riwayat Reconcile: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const record =
    typeof row === "object" && row !== null
      ? (row as Record<string, unknown>)
      : {};

  return {
    deletedReconcileRuns:
      typeof record.deleted_reconcile_runs === "number"
        ? record.deleted_reconcile_runs
        : 0,
    deletedPrefixSuggestions:
      typeof record.deleted_prefix_suggestions === "number"
        ? record.deleted_prefix_suggestions
        : 0,
  };
}
