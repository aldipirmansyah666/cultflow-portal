import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  importAgenMatrix,
  importExcelData,
} from "./dataUtamaService";

interface UpsertCall {
  rows: Record<string, unknown>[];
  opts: unknown;
}

/** Fake: select(*).limit(1) skema + upsert tercatat. */
function fakeImportClient(
  schemaRow: Record<string, unknown> | null,
  calls: UpsertCall[],
  failBatches: Set<number> = new Set()
): SupabaseClient {
  let batchNo = 0;
  return {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: schemaRow ? [schemaRow] : [],
          error: null,
        }),
      }),
      upsert: async (rows: Record<string, unknown>[], opts: unknown) => {
        batchNo += 1;
        calls.push({ rows, opts });
        if (failBatches.has(batchNo)) {
          return { error: { message: `batch ${batchNo} gagal` } };
        }
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
}

const FULL_SCHEMA = {
  ppid: "X",
  nama_pemilik: "Y",
  no_hp_pemilik: "Z",
};

function matrixOf(n: number, start = 1): unknown[][] {
  const m: unknown[][] = [["PPID", "NAMA PEMILIK", "NO HP PEMILIK"]];
  for (let i = 0; i < n; i++) {
    m.push([`PP${start + i}`, `Pemilik ${start + i}`, `081${start + i}`]);
  }
  return m;
}

describe("importAgenMatrix", () => {
  it("upsert onConflict ppid + saring skema live", async () => {
    const calls: UpsertCall[] = [];
    const summary = await importAgenMatrix(
      fakeImportClient({ ppid: "X", nama_pemilik: "Y" }, calls),
      matrixOf(2)
    );
    expect(summary.totalRows).toBe(2);
    expect(summary.upserted).toBe(2);
    expect(summary.skippedNoPpid).toBe(0);
    expect(summary.missingInRemote).toContain("no_hp_pemilik");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts).toEqual({ onConflict: "ppid" });
    // no_hp_pemilik absen di remote -> terbuang dari payload
    expect(calls[0]?.rows[0]).toEqual({ ppid: "PP1", nama_pemilik: "Pemilik 1" });
  });

  it("batch 500 + dedup last-wins + lewati tanpa-PPID", async () => {
    const calls: UpsertCall[] = [];
    const m = matrixOf(505);
    m.push(["PP1", "Pemilik DUP", "0899"]); // duplikat PP1
    m.push(["", "Tanpa PPID", "0800"]); // tanpa ppid
    m.push(["  ", "", ""]); // baris sampah
    const summary = await importAgenMatrix(
      fakeImportClient(FULL_SCHEMA, calls),
      m
    );
    expect(summary.totalRows).toBe(507);
    expect(summary.skippedNoPpid).toBe(1);
    expect(summary.upserted).toBe(505);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.rows).toHaveLength(500);
    expect(calls[1]?.rows).toHaveLength(5);
    const pp1 = calls
      .flatMap((c) => c.rows)
      .filter((r) => r.ppid === "PP1");
    expect(pp1).toHaveLength(1);
    expect(pp1[0]).toMatchObject({ nama_pemilik: "Pemilik DUP" });
  });

  it("batch gagal tercatat dan lanjut", async () => {
    const calls: UpsertCall[] = [];
    const summary = await importAgenMatrix(
      fakeImportClient(FULL_SCHEMA, calls, new Set([1])),
      matrixOf(501)
    );
    expect(summary.upserted).toBe(1);
    expect(summary.batchErrors).toHaveLength(1);
    expect(summary.batchErrors[0]).toMatchObject({ batch: 1 });
  });

  it("matriks kosong / tanpa header -> throw", async () => {
    const calls: UpsertCall[] = [];
    const client = fakeImportClient(FULL_SCHEMA, calls);
    await expect(importAgenMatrix(client, [])).rejects.toThrow("kosong");
    await expect(
      importAgenMatrix(client, [
        ["ABC", "DEF"],
        ["x", "y"],
      ])
    ).rejects.toThrow("header");
    expect(calls).toHaveLength(0);
  });
});

describe("importExcelData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function xlsxFile(name: string): File {
    const ws = XLSX.utils.aoa_to_sheet([
      ["PPID", "NAMA PEMILIK"],
      ["PP9", "Pemilik Sembilan"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Agen CUM");
    const raw = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as unknown as Uint8Array;
    const bytes = Uint8Array.from(raw);
    const file = new File([bytes], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    // jsdom File tanpa arrayBuffer(): polyfill setara Blob.
    (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
      async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
    return file;
  }

  it("parse -> POST matriks -> ringkasan + progress", async () => {
    const posted: unknown[] = [];
    const stages: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body?: string }) => {
        posted.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          json: async () => ({
            totalRows: 1,
            upserted: 1,
            skippedNoPpid: 0,
            missingInRemote: [],
            unmapped: [],
            batchErrors: [],
          }),
        };
      })
    );
    const summary = await importExcelData(xlsxFile("agen.xlsx"), (p) =>
      stages.push(p.stage)
    );
    expect(summary.upserted).toBe(1);
    expect(stages).toEqual(["parse", "upload", "done"]);
    const body = posted[0] as { matrix: unknown[][] };
    expect(body.matrix[0]).toEqual(["PPID", "NAMA PEMILIK"]);
    expect(body.matrix[1]).toEqual(["PP9", "Pemilik Sembilan"]);
  });

  it("error persis bila sheet Agen CUM absen", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["PPID"], ["X1"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet Lain");
    const raw = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as unknown as Uint8Array;
    const bytes = Uint8Array.from(raw);
    const file = new File([bytes], "lain.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
      async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
    await expect(importExcelData(file)).rejects.toThrow(
      "Sheet 'Agen CUM' tidak ditemukan dalam file Excel."
    );
  });

  it("tolak ekstensi salah + error server", async () => {
    await expect(
      importExcelData(new File(["x"], "data.txt", { type: "text/plain" }))
    ).rejects.toThrow(".xlsx");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Bukan ADMIN" }),
      }))
    );
    await expect(importExcelData(xlsxFile("a.xlsx"))).rejects.toThrow(
      "Bukan ADMIN"
    );
  });
});
