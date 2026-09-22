import { describe, expect, it } from "vitest";
import {
  cellToText,
  findHeaderRowIndex,
  sanitizeCell,
} from "../agenCumMapper";

describe("sanitizeCell", () => {
  it("primitif lolos, kosong -> null", () => {
    expect(sanitizeCell("  halo ")).toBe("halo");
    expect(sanitizeCell("   ")).toBeNull();
    expect(sanitizeCell(123)).toBe(123);
    expect(sanitizeCell(true)).toBe(true);
    expect(sanitizeCell(null)).toBeNull();
    expect(sanitizeCell(undefined)).toBeNull();
    expect(sanitizeCell(Number.NaN)).toBeNull();
  });

  it("objek/array dibuang (anti '[object Object]')", () => {
    expect(sanitizeCell({ a: 1 })).toBeNull();
    expect(sanitizeCell(["x", "y"])).toBeNull();
    expect(sanitizeCell(" [object Object] ")).toBe("[object Object]");
  });

  it("Date -> ISO string", () => {
    expect(sanitizeCell(new Date("2026-09-21T00:00:00Z"))).toBe(
      "2026-09-21T00:00:00.000Z"
    );
    expect(sanitizeCell(new Date("invalid"))).toBeNull();
  });
});

describe("cellToText via sanitizeCell", () => {
  it("objek -> null, boolean/number seperti semula", () => {
    expect(cellToText({ a: 1 })).toBeNull();
    expect(cellToText([1])).toBeNull();
    expect(cellToText(123)).toBe("123");
    expect(cellToText(false)).toBe("Tidak");
    expect(cellToText("  x ")).toBe("x");
  });
});

describe("findHeaderRowIndex (jangkar PPID)", () => {
  // tiruan layout asli: judul, grup (PPID), sub-detail, data
  const twoLevel = [
    ["LAPORAN", 1081],
    ["STATUS", "PPID", "NAMA PEMILIK", "EMAIL"],
    ["SYARAT", "PPID", "NAMA PEMILIK", "EMAIL"],
    ["11 Januari 2022", "53BSPA29321JBNDS", "Ucup Taojiri", "a@b.c"],
  ];

  it("seri skor -> jangkar menang; detail menang bila skor lebih tinggi", () => {
    expect(findHeaderRowIndex(twoLevel)).toBe(1);
    expect(
      findHeaderRowIndex([
        ["RINGKASAN"],
        ["STATUS", "PPID", "NAMA PEMILIK"],
        ["CATATAN", "TRAINING", "TRANSAKSI"],
        ["x", "y", "z"],
      ])
    ).toBe(2);
  });

  it("sheet datar: header berisi PPID di baris 0", () => {
    expect(
      findHeaderRowIndex([
        ["PPID", "NAMA PEMILIK", "NO HP PEMILIK"],
        ["X1", "Budi", "0812"],
      ])
    ).toBe(0);
  });

  it("-1 bila tak ada sel PPID / skor kurang", () => {
    expect(findHeaderRowIndex([["ABC", "DEF"], ["x", "y"]])).toBe(-1);
    expect(findHeaderRowIndex([])).toBe(-1);
    expect(findHeaderRowIndex([["PPID"]])).toBe(-1);
  });

  it("angka 1081/dll tak dianggap PPID", () => {
    expect(
      findHeaderRowIndex([
        [1081, 819],
        ["PPID", "NAMA PEMILIK", "EMAIL"],
        ["X1", "B", "c@d.e"],
      ])
    ).toBe(1);
  });
});
