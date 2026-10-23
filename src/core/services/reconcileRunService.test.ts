import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pruneReconcileHistory,
  recordReconcileRun,
  validateReconcileRunInput,
  type ReconcileRunInput,
} from "./reconcileRunService";

const VALID: ReconcileRunInput = {
  fileName: "rekon.xlsx",
  fileSha256: "a".repeat(64),
  totalRows: 10,
  validRows: 8,
  invalidRows: 2,
};

describe("validateReconcileRunInput", () => {
  it("menerima payload valid + menormalkan hash/nama file", () => {
    expect(
      validateReconcileRunInput({
        ...VALID,
        fileName: "  rekon.xlsx  ",
        fileSha256: "A".repeat(64),
      })
    ).toEqual(VALID);
  });

  it("menolak hash, nama, count, dan total yang tidak konsisten", () => {
    expect(validateReconcileRunInput(null)).toBeNull();
    expect(validateReconcileRunInput({ ...VALID, fileName: "" })).toBeNull();
    expect(validateReconcileRunInput({ ...VALID, fileSha256: "xyz" })).toBeNull();
    expect(validateReconcileRunInput({ ...VALID, totalRows: 9 })).toBeNull();
    expect(validateReconcileRunInput({ ...VALID, invalidRows: -1 })).toBeNull();
    expect(validateReconcileRunInput({ ...VALID, validRows: 1.5 })).toBeNull();
  });
});

describe("recordReconcileRun", () => {
  it("insert lalu memetakan snake_case -> camelCase", async () => {
    const client = {
      from: () => ({
        insert: (payload: unknown) => {
          expect(payload).toMatchObject({
            user_id: "u-1",
            file_name: VALID.fileName,
            file_sha256: VALID.fileSha256,
            total_rows: VALID.totalRows,
            valid_rows: VALID.validRows,
            invalid_rows: VALID.invalidRows,
          });
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: "run-1",
                  user_id: "u-1",
                  file_name: VALID.fileName,
                  file_sha256: VALID.fileSha256,
                  total_rows: VALID.totalRows,
                  valid_rows: VALID.validRows,
                  invalid_rows: VALID.invalidRows,
                  created_at: "2026-10-23T00:00:00Z",
                },
                error: null,
              }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await expect(recordReconcileRun(client, "u-1", VALID)).resolves.toEqual({
      id: "run-1",
      userId: "u-1",
      ...VALID,
      createdAt: "2026-10-23T00:00:00Z",
    });
  });

  it("melempar error yang bisa ditangani API", async () => {
    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { message: "db down" },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(recordReconcileRun(client, "u-1", VALID)).rejects.toThrow(
      "Gagal menyimpan audit Reconcile"
    );
  });
});

describe("pruneReconcileHistory", () => {
  it("memanggil RPC retensi dan memetakan jumlah yang dihapus", async () => {
    const client = {
      rpc: async (name: string) => {
        expect(name).toBe("prune_reconcile_history");
        return {
          data: [
            {
              deleted_reconcile_runs: 12,
              deleted_prefix_suggestions: 3,
            },
          ],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    await expect(pruneReconcileHistory(client)).resolves.toEqual({
      deletedReconcileRuns: 12,
      deletedPrefixSuggestions: 3,
    });
  });

  it("melempar error agar pemanggil bisa logging tanpa membatalkan audit", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "db down" } }),
    } as unknown as SupabaseClient;

    await expect(pruneReconcileHistory(client)).rejects.toThrow(
      "Gagal membersihkan riwayat Reconcile"
    );
  });
});
