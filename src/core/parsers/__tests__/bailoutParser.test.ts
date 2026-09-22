import { describe, expect, it } from "vitest";
import {
  cleanBailoutValue,
  normalizeKodeLoket,
  parseBailoutRows,
} from "../bailoutParser";

describe("normalizeKodeLoket", () => {
  it("uppercase dan buang spasi/NBSP/zero-width", () => {
    expect(normalizeKodeLoket("  ab-12 ")).toBe("AB-12");
    expect(normalizeKodeLoket("AB 12")).toBe("AB12");
    expect(normalizeKodeLoket("AB​12")).toBe("AB12");
    expect(normalizeKodeLoket("ab12")).toBe("AB12");
  });

  it("nilai kosong semu menjadi string kosong", () => {
    expect(normalizeKodeLoket("0")).toBe("");
    expect(normalizeKodeLoket("-")).toBe("");
    expect(normalizeKodeLoket("NULL")).toBe("");
    expect(normalizeKodeLoket("null")).toBe("");
    expect(normalizeKodeLoket("N/A")).toBe("");
    expect(normalizeKodeLoket("n/a")).toBe("");
    expect(normalizeKodeLoket("   ")).toBe("");
  });
});

describe("cleanBailoutValue", () => {
  it("mengubah format Rupiah menjadi number", () => {
    expect(cleanBailoutValue("Rp 1.500.000")).toBe(1500000);
    expect(cleanBailoutValue("RP2.000.000")).toBe(2000000);
    expect(cleanBailoutValue("1.500.000,50")).toBe(1500000.5);
  });

  it("kurung menjadi negatif", () => {
    expect(cleanBailoutValue("(500.000)")).toBe(-500000);
    expect(cleanBailoutValue("(Rp 1.000)")).toBe(-1000);
  });

  it("tanda hubung dan kosong menjadi 0", () => {
    expect(cleanBailoutValue("-")).toBe(0);
    expect(cleanBailoutValue("")).toBe(0);
    expect(cleanBailoutValue("   ")).toBe(0);
    expect(cleanBailoutValue(null)).toBe(0);
    expect(cleanBailoutValue(undefined)).toBe(0);
  });

  it("number lolos apa adanya, non-numerik menjadi 0", () => {
    expect(cleanBailoutValue(750000)).toBe(750000);
    expect(cleanBailoutValue(Number.NaN)).toBe(0);
    expect(cleanBailoutValue("tidak-valid")).toBe(0);
    expect(cleanBailoutValue(true)).toBe(0);
  });
});

describe("parseBailoutRows", () => {
  const sheet: unknown[][] = [
    ["LAPORAN BAILOUT SEPTEMBER 2026"],
    ["KODE LOKET", "NAMA LOKET", "BAILOUT", "PERIODE"],
    ["AB12", "Loket A", "Rp 1.500.000", "2026-09"],
    [" cd34 ", "Loket B", "(500.000)", "2026-09"],
    ["TOTAL", "", "Rp 1.000.000", ""],
    ["", "Loket Tanpa Kode", "Rp 100.000", "2026-09"],
    ["GRAND TOTAL", "", "Rp 1.000.000", ""],
  ];

  it("menemukan header dinamis dan memetakan kolom", () => {
    const result = parseBailoutRows(sheet);
    expect(result).toEqual([
      { kodeLoket: "AB12", namaLoket: "Loket A", nominal: 1500000, periode: "2026-09" },
      { kodeLoket: "CD34", namaLoket: "Loket B", nominal: -500000, periode: "2026-09" },
    ]);
  });

  it("melewati baris TOTAL/JUMLAH/GRAND TOTAL dan kode kosong", () => {
    const result = parseBailoutRows([
      ["Kode", "Nama", "Bailout", "Periode"],
      ["X1", "Loket X", 100, "2026-09"],
      ["ZZ", "JUMLAH", 100, ""],
      ["X2", "Total Loket", 200, "2026-09"],
    ]);
    expect(result.map((row) => row.kodeLoket)).toEqual(["X1", "X2"]);
  });

  it("mengembalikan array kosong bila header tidak ditemukan", () => {
    expect(parseBailoutRows([["ABC", "DEF"], ["X1", "Loket"]])).toEqual([]);
    expect(parseBailoutRows([])).toEqual([]);
  });
});
