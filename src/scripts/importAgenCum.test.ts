import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEffectiveFields,
  cellToText,
  dedupeByPpid,
  fetchRemoteColumns,
  headerTokens,
  insertWithRowFallback,
  isSchemaCacheError,
  mapAgenCumRow,
  mapAgenCumRowByIndex,
  mapHeaderToField,
  parseArgs,
  parseBoolCell,
  resolveAllowedColumns,
  sanitizeRowForDb,
  type WriteStats,
} from "./importAgenCum";

describe("mapHeaderToField", () => {
  it("memetakan header umum secara langsung", () => {
    expect(mapHeaderToField("PPID")).toBe("ppid");
    expect(mapHeaderToField("Nama Loket Kurlog")).toBe("nama_loket_kurlog");
    expect(mapHeaderToField("No. HP Pemilik")).toBe("no_hp_pemilik");
    expect(mapHeaderToField("KURLOG POS PPOB")).toBe("kurlog_pos_ppob");
    expect(mapHeaderToField("No")).toBe("no");
  });

  it("toleran urutan kata dan alias", () => {
    expect(mapHeaderToField("Provinsi")).toBe("propinsi");
    expect(mapHeaderToField("Kabupaten/Kota")).toBe("kab_kot");
    expect(mapHeaderToField("Nama Pengganti")).toBe("pengganti_nama");
    expect(mapHeaderToField("Pengganti - Email")).toBe("pengganti_email");
  });

  it("mengembalikan null untuk header tak dikenal", () => {
    expect(mapHeaderToField("Kolom Entah Apa")).toBeNull();
    expect(mapHeaderToField("")).toBeNull();
    expect(mapHeaderToField(null)).toBeNull();
    expect(mapHeaderToField("waktu")).toBeNull();
  });
});

describe("mapHeaderToField berkonteks (sheet Agen CUM)", () => {
  it("sub-header grup STATUS via gabungan", () => {
    expect(mapHeaderToField("SYARAT", { group: "STATUS" })).toBe("status_syarat");
    expect(
      mapHeaderToField("PENGAJUAN SURVEY KE POS", { group: "STATUS" })
    ).toBe("pengajuan_survey");
  });

  it("sub-header grup KURLOG via gabungan", () => {
    expect(mapHeaderToField("POS + PPOB", { group: "KURLOG" })).toBe(
      "kurlog_pos_ppob"
    );
    expect(mapHeaderToField("SICEPAT", { group: "KURLOG" })).toBe(
      "kurlog_sicepat"
    );
  });

  it("label vertikal tanpa sub-header (grup dipakai langsung)", () => {
    expect(mapHeaderToField("NAMA LOKET DI ONPAYS", { group: "" })).toBe(
      "nama_loket_onpays"
    );
    expect(mapHeaderToField("NAMA LOKET DI KURLOG", { group: "" })).toBe(
      "nama_loket_kurlog"
    );
    expect(mapHeaderToField("NIB ( NO INDUK BERUSAHA)", { group: "" })).toBe(
      "nib"
    );
    expect(mapHeaderToField("ALAMAT PEMIILIK KTP", { group: "" })).toBe(
      "alamat_pemilik_ktp"
    );
  });

  it("blok pengganti: paling spesifik menang", () => {
    const g = { group: "DATA PENGGANTI KARENA MASALAH NIB" };
    expect(mapHeaderToField("NAMA", g)).toBe("pengganti_nama");
    expect(mapHeaderToField("NO KTP", g)).toBe("pengganti_no_ktp");
    expect(mapHeaderToField("NPWP", g)).toBe("pengganti_npwp");
    expect(mapHeaderToField("TELP", g)).toBe("pengganti_telp");
    expect(mapHeaderToField("EMAIL", g)).toBe("pengganti_email");
    expect(mapHeaderToField("STATUS", g)).toBe("pengganti_status");
    expect(mapHeaderToField("TANGGAL LAHIR", g)).toBe("pengganti_tgl_lahir");
  });

  it("blok dokumen satu-token -> doc_*", () => {
    expect(mapHeaderToField("KTP", { group: "PKS" })).toBe("doc_ktp");
    expect(mapHeaderToField("NIB", { group: "PKS" })).toBe("doc_nib");
    expect(mapHeaderToField("KBLI", { group: "PKS" })).toBe("doc_kbli");
  });

  it("nama kurir -> courier_* kecuali grup KURLOG", () => {
    expect(mapHeaderToField("SPX", { group: "JENIS USAHA AGEN" })).toBe(
      "courier_spx"
    );
    expect(mapHeaderToField("JNT EXPRESS", { group: "JENIS USAHA AGEN" })).toBe(
      "courier_jnt_express"
    );
    expect(mapHeaderToField("SICEPAT", { group: "JENIS USAHA AGEN" })).toBe(
      "courier_sicepat"
    );
    expect(mapHeaderToField("KATEGORI", { group: "JENIS USAHA AGEN" })).toBe(
      "jenis_usaha_kategori"
    );
  });

  it("Nama Pemilik di samping bank -> pemilik rekening", () => {
    expect(
      mapHeaderToField("Nama Pemilik", {
        neighbors: ["NOMOR REKENING", "Nama Bank"],
      })
    ).toBe("nama_pemilik_rekening");
    expect(mapHeaderToField("NAMA PEMILIK", { neighbors: ["PPID"] })).toBe(
      "nama_pemilik"
    );
  });
});

describe("buildEffectiveFields", () => {
  it("menggabungkan grup + sub per kolom", () => {
    const fields = buildEffectiveFields(
      ["NO", "SYARAT", "PPID", "EMAIL"],
      ["NO", "STATUS", "PPID", "DATA PENGGANTI KARENA MASALAH NIB"]
    );
    expect(fields.map((f) => f.field)).toEqual([
      "no",
      "status_syarat",
      "ppid",
      "pengganti_email",
    ]);
  });

  it("label vertikal hanya dari sel grup tepat di kolomnya", () => {
    const fields = buildEffectiveFields(["", ""], ["LATITUDE", ""]);
    expect(fields[0]?.field).toBe("latitude");
    // kolom 1: grup kosong -> null (tidak mewarisi label tetangga)
    expect(fields[1]?.field).toBeNull();
  });
});

describe("sanitizeRowForDb", () => {
  it("membuang kunci di luar skema", () => {
    const clean = sanitizeRowForDb({
      ppid: "X1",
      no_hp_pemilik: "0812",
      waktu_update: "2026",
    } as never);
    expect(clean).toEqual({ ppid: "X1", no_hp_pemilik: "0812" });
  });
});

describe("mapAgenCumRowByIndex", () => {  it("memetakan per indeks dengan ctx berbeda label sama", () => {
    const row = mapAgenCumRowByIndex(
      ["Budi", "Bank CUM", "Siti"],
      ["nama_pemilik", "nama_bank", "nama_pemilik_rekening"]
    );
    expect(row).toMatchObject({
      nama_pemilik: "Budi",
      nama_bank: "Bank CUM",
      nama_pemilik_rekening: "Siti",
    });
  });
});

describe("pin aktivasi_kurlog & alamat_lengkap_loket", () => {
  it("langsung maupun via grup STATUS/ALAMAT LENGKAP", () => {
    expect(mapHeaderToField("AKTIVASI KURLOG", { group: "STATUS" })).toBe(
      "aktivasi_kurlog"
    );
    expect(mapHeaderToField("AKTIVASI KURLOG")).toBe("aktivasi_kurlog");
    expect(
      mapHeaderToField("ALAMAT LENGKAP LOKET", { group: "ALAMAT LENGKAP" })
    ).toBe("alamat_lengkap_loket");
    expect(mapHeaderToField("ALAMAT LENGKAP LOKET")).toBe(
      "alamat_lengkap_loket"
    );
  });

  it("nilai tanggal aktivasi lolos sebagai teks", () => {
    const row = mapAgenCumRow({
      PPID: "X1",
      "AKTIVASI KURLOG": "3 OKTOBER 2022",
      "ALAMAT LENGKAP LOKET": "Jl Raya No 1",
    });
    expect(row).toMatchObject({
      aktivasi_kurlog: "3 OKTOBER 2022",
      alamat_lengkap_loket: "Jl Raya No 1",
    });
  });
});

describe("skema live dinamis", () => {
  function fakeSelectClient(
    data: unknown,
    error: { message: string } | null
  ): SupabaseClient {
    return {
      from: () => ({
        select: () => ({ limit: async () => ({ data, error }) }),
      }),
    } as unknown as SupabaseClient;
  }

  it("fetchRemoteColumns membaca kunci baris live", async () => {
    const s = await fetchRemoteColumns(
      fakeSelectClient([{ ppid: "X", no_hp_pemilik: "081" }], null)
    );
    expect(s.live).toBe(true);
    expect(s.columns.has("ppid")).toBe(true);
    expect(s.columns.has("aktivasi_kurlog")).toBe(false);
  });

  it("fallback statis saat tabel kosong / error", async () => {
    const empty = await fetchRemoteColumns(fakeSelectClient([], null));
    expect(empty.live).toBe(false);
    expect(empty.columns.has("ppid")).toBe(true);
    const err = await fetchRemoteColumns(
      fakeSelectClient(null, { message: "boom" })
    );
    expect(err.live).toBe(false);
    expect(err.note).toContain("boom");
  });

  it("resolveAllowedColumns memangkas drift + sanitize patuh", () => {
    const { allowed, missingInRemote } = resolveAllowedColumns(
      new Set(["ppid", "no_hp_pemilik"])
    );
    expect(allowed.has("ppid")).toBe(true);
    expect(allowed.has("aktivasi_kurlog")).toBe(false);
    expect(missingInRemote).toContain("aktivasi_kurlog");
    expect(
      sanitizeRowForDb({ ppid: "X", aktivasi_kurlog: "Y" }, allowed)
    ).toEqual({ ppid: "X" });
  });
});

describe("error per baris + schema cache", () => {
  function blankStats(): WriteStats {
    return { inserted: 0, updated: 0, failed: 0, failures: [] };
  }

  function fakeInsertClient(opts: {
    batchFails?: { message: string; code?: string };
    failPpids?: string[];
    failFirstThenOk?: boolean;
    calls: string[];
  }): SupabaseClient {
    let batchCalls = 0;
    return {
      from: () => ({
        insert: async (rows: { ppid?: unknown }[]) => {
          opts.calls.push(`insert:${rows.length}`);
          if (rows.length > 1) {
            batchCalls += 1;
            if (opts.failFirstThenOk && batchCalls === 1) {
              return { error: { code: "PGRST204", message: "schema cache" } };
            }
            if (opts.failFirstThenOk || !opts.batchFails) {
              return { error: null };
            }
            return { error: opts.batchFails };
          }
          const ppid = String(rows[0]?.ppid ?? "");
          if ((opts.failPpids ?? []).includes(ppid)) {
            return { error: { message: `bad row ${ppid}` } };
          }
          if (opts.failFirstThenOk && batchCalls === 0) {
            batchCalls += 1;
            return { error: { code: "PGRST204", message: "schema cache" } };
          }
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;
  }

  it("isSchemaCacheError mendeteksi PGRST204/pesan cache", () => {
    expect(isSchemaCacheError({ code: "PGRST204", message: "x" })).toBe(true);
    expect(
      isSchemaCacheError({ message: "Could not find table in schema cache" })
    ).toBe(true);
    expect(isSchemaCacheError({ code: "23505", message: "dup" })).toBe(false);
    expect(isSchemaCacheError(null)).toBe(false);
  });

  it("batch sukses tanpa fallback", async () => {
    const calls: string[] = [];
    const stats = blankStats();
    await insertWithRowFallback(
      fakeInsertClient({ calls }),
      "t",
      [{ ppid: "A" }, { ppid: "B" }],
      "L",
      stats
    );
    expect(stats).toMatchObject({ inserted: 2, failed: 0 });
    expect(calls).toEqual(["insert:2"]);
  });

  it("batch gagal -> per baris mengisolasi baris busuk", async () => {
    const calls: string[] = [];
    const stats = blankStats();
    await insertWithRowFallback(
      fakeInsertClient({
        calls,
        batchFails: { message: "boom" },
        failPpids: ["B"],
      }),
      "t",
      [{ ppid: "A" }, { ppid: "B" }],
      "L",
      stats,
      { retryDelayMs: 0, sleeper: async () => {} }
    );
    expect(stats.inserted).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.failures[0]).toMatchObject({ key: "B" });
    expect(calls).toEqual(["insert:2", "insert:1", "insert:1"]);
  });

  it("PGRST204 -> retry 1x setelah jeda reload", async () => {
    const calls: string[] = [];
    let slept = 0;
    const stats = blankStats();
    await insertWithRowFallback(
      fakeInsertClient({ calls, failFirstThenOk: true }),
      "t",
      [{ ppid: "A" }],
      "L",
      stats,
      { retryDelayMs: 5, sleeper: async (ms) => { slept += ms; } }
    );
    expect(stats.inserted).toBe(1);
    expect(stats.failed).toBe(0);
    expect(slept).toBe(5);
    expect(calls).toEqual(["insert:1", "insert:1"]);
  });
});

describe("parseBoolCell", () => {
  it("mengenali nilai benar/salah umum", () => {
    expect(parseBoolCell("Ya")).toBe(true);
    expect(parseBoolCell("V")).toBe(true);
    expect(parseBoolCell(1)).toBe(true);
    expect(parseBoolCell("Tidak")).toBe(false);
    expect(parseBoolCell("-")).toBe(false);
    expect(parseBoolCell(0)).toBe(false);
  });

  it("mengembalikan null untuk kosong/tak dikenal", () => {
    expect(parseBoolCell("")).toBeNull();
    expect(parseBoolCell("mungkin")).toBeNull();
    expect(parseBoolCell(null)).toBeNull();
  });
});

describe("mapAgenCumRow", () => {
  it("memetakan baris lengkap", () => {
    const row = mapAgenCumRow({
      No: 1,
      PPID: "POS123",
      "Nama Loket Kurlog": "Loket A",
      Regional: "Jawa Barat",
      "Kurlog POS PPOB": "Ya",
    });
    expect(row).toMatchObject({
      no: 1,
      ppid: "POS123",
      nama_loket_kurlog: "Loket A",
      regional: "Jawa Barat",
      kurlog_pos_ppob: true,
    });
  });

  it("melewati baris kosong/tanpa identitas", () => {
    expect(mapAgenCumRow({ PPID: "", "Nama Loket Kurlog": "" })).toBeNull();
    expect(mapAgenCumRow({})).toBeNull();
  });

  it("mengabaikan sel kosong tanpa menandai baris berisi", () => {
    expect(mapAgenCumRow({ PPID: "X1", Catatan: "  " })).toMatchObject({
      ppid: "X1",
    });
  });
});

describe("helpers", () => {
  it("headerTokens memecah dan lower-case", () => {
    expect(headerTokens("No. HP Pemilik")).toEqual(["no", "hp", "pemilik"]);
  });

  it("cellToText merapikan nilai", () => {
    expect(cellToText("  halo ")).toBe("halo");
    expect(cellToText(123)).toBe("123");
    expect(cellToText("   ")).toBeNull();
  });
});

describe("dedupeByPpid", () => {
  it("last-wins untuk PPID ganda, tanpa-PPID lolos", () => {
    const { rows, dupCount, dupKeys } = dedupeByPpid([
      { ppid: "A", nama_pemilik: "lama" },
      { nama_pemilik: "tanpa ppid" },
      { ppid: "A", nama_pemilik: "baru" },
      { ppid: "B", nama_pemilik: "solo" },
    ]);
    expect(dupCount).toBe(1);
    expect(dupKeys).toEqual(["A"]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.ppid === "A")).toMatchObject({
      nama_pemilik: "baru",
    });
  });

  it("tanpa duplikat -> identik", () => {
    const input = [{ ppid: "A" }, { ppid: "B" }];
    const { rows, dupCount } = dedupeByPpid(input);
    expect(dupCount).toBe(0);
    expect(rows).toHaveLength(2);
  });
});

describe("parseArgs", () => {
  it("default + flag", () => {
    expect(parseArgs([])).toMatchObject({
      file: "datleng kurlog.xlsx",
      sheet: "Agen CUM",
      dryRun: false,
      skipNoPpid: false,
    });
    expect(parseArgs(["f.xlsx", "S", "--dry-run", "--skip-no-ppid"])).toMatchObject({
      file: "f.xlsx",
      sheet: "S",
      dryRun: true,
      skipNoPpid: true,
    });
  });
});
