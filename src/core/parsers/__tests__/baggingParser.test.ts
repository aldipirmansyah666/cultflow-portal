import { describe, expect, it } from "vitest";
import {
  findBaggingColumnIndices,
  findBaggingHeaderRowIndex,
  groupBaggingByAgen,
  isBelumDibagging,
  normalizeAgenName,
  parseBaggingRowsFromAOA,
} from "../baggingParser";

describe("findBaggingHeaderRowIndex (skor matching)", () => {
  it("menemukan header di bawah baris judul", () => {
    const rows = [
      ["LAPORAN BAGGING SEPTEMBER 2026"],
      ["TANGGAL", "NO RESI", "AGEN", "STATUS BAGGING"],
      ["2026-09-20", "SHPE1", "Loket A", "Belum Dibagging"],
    ];
    expect(findBaggingHeaderRowIndex(rows)).toBe(1);
  });

  it("langsung menang pada skor >= 3 dan menerima skor 2", () => {
    expect(
      findBaggingHeaderRowIndex([["NO RESI", "AGEN", "X"]])
    ).toBe(0);
    expect(findBaggingHeaderRowIndex([["ABC", "DEF"]])).toBe(-1);
    expect(findBaggingHeaderRowIndex([])).toBe(-1);
  });
});

describe("findBaggingColumnIndices", () => {
  it("memetakan kolom via alias (alias terpanjang menang)", () => {
    const idx = findBaggingColumnIndices([
      "Tgl",
      "Nomor Resi",
      "Nama Agen",
      "Kode Layanan",
      "Status Bagging",
    ]);
    expect(idx).toEqual({
      tanggalIdx: 0,
      resiIdx: 1,
      agenIdx: 2,
      layananIdx: 3,
      statusIdx: 4,
    });
  });

  it("-1 untuk kolom yang tidak ada", () => {
    const idx = findBaggingColumnIndices(["No Resi", "Agen"]);
    expect(idx.tanggalIdx).toBe(-1);
    expect(idx.resiIdx).toBe(0);
  });
});

describe("parseBaggingRowsFromAOA", () => {
  it("parse baris + membersihkan invisible + mempertahankan kolom ekstra", () => {
    const rows = [
      ["REKAP"],
      ["TANGGAL", "NO RESI", "AGEN", "KODE LAYANAN", "STATUS BAGGING", "KET"],
      ["20-09-2026", " shpe1 ", "Loket  A", "pe", "Belum Dibagging", "ok"],
      ["", "", "", "", "", ""],
    ];
    const result = parseBaggingRowsFromAOA(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      Tanggal: "20-09-2026",
      "No Resi": "SHPE1",
      Agen: "Loket A",
      "Kode Layanan": "PE",
      "Status Bagging": "Belum Dibagging",
      KET: "ok",
    });
  });

  it("array kosong bila header tak ditemukan / kolom kunci absen", () => {
    expect(parseBaggingRowsFromAOA([["A", "B"]])).toEqual([]);
    expect(parseBaggingRowsFromAOA([])).toEqual([]);
    expect(
      parseBaggingRowsFromAOA([["Tanggal Saja", "Kolom Lain"], ["x", "y"]])
    ).toEqual([]);
  });
});

describe("grouping & filter", () => {
  it("isBelumDibagging case-insensitive", () => {
    expect(isBelumDibagging({ "Status Bagging": "BELUM DIBAGGING" })).toBe(true);
    expect(isBelumDibagging({ "Status Bagging": "Sudah Dibagging" })).toBe(false);
    expect(isBelumDibagging({})).toBe(false);
  });

  it("normalizeAgenName collapse spasi, kosong -> LAINNYA", () => {
    expect(normalizeAgenName("  Loket   A ")).toBe("Loket A");
    expect(normalizeAgenName("")).toBe("LAINNYA");
    expect(normalizeAgenName(null)).toBe("LAINNYA");
  });

  it("groupBaggingByAgen hanya merangkum yang belum dibagging", () => {
    const grouped = groupBaggingByAgen([
      { Agen: "Loket A", "No Resi": "R1", "Status Bagging": "Belum Dibagging" },
      { Agen: "Loket A", "No Resi": "R2", "Status Bagging": "Sudah Dibagging" },
      { Agen: "Loket B", "No Resi": "R3", "Status Bagging": "belum dibagging" },
    ]);
    expect(Object.keys(grouped).sort()).toEqual(["Loket A", "Loket B"]);
    expect(grouped["Loket A"]).toHaveLength(1);
  });
});
