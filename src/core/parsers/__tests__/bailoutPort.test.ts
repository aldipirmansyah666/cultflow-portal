import { describe, expect, it } from "vitest";
import {
  findColumnIndices,
  findHeaderRowIndex,
  normalizeKodeLoket,
  normalizeNama,
  normalizePeriodeToISO,
  parseBailoutFromPaste,
  parseBailoutRowsFromAOA,
  sanitizePeriodeOrToday,
} from "../bailoutParser";

describe("port: findHeaderRowIndex (skor, periode tie-breaker)", () => {
  it("menemukan header di baris ke-2", () => {
    const rows = [
      ["LAPORAN BAILOUT"],
      ["KODE LOKET", "NAMA LOKET", "BAILOUT", "PERIODE"],
      ["A1", "Loket A", 100, "2026-09-01"],
    ];
    expect(findHeaderRowIndex(rows)).toBe(1);
  });

  it("menerima alias fleksibel (MITRA ID / SALDO MINUS)", () => {
    expect(findHeaderRowIndex([["MITRA ID", "NAMA MITRA", "SALDO MINUS"]])).toBe(0);
  });

  it("-1 bila tidak ada petunjuk header", () => {
    expect(findHeaderRowIndex([["ABC", "DEF"]])).toBe(-1);
    expect(findHeaderRowIndex([])).toBe(-1);
  });
});

describe("port: findColumnIndices", () => {
  it("memetakan kolom terpanjang-menang", () => {
    expect(
      findColumnIndices(["KODE LOKET DI ONPAYS", "NAMA", "MINUS H-1", "TGL"])
    ).toEqual({ kodeIdx: 0, namaIdx: 1, bailoutIdx: 2, periodeIdx: 3 });
  });
});

describe("port: normalizeNama & normalizeKodeLoket unknown", () => {
  it("collapse spasi nama", () => {
    expect(normalizeNama("  Loket   A ")).toBe("Loket A");
  });

  it("kode menerima non-string dan NA", () => {
    expect(normalizeKodeLoket(null)).toBe("");
    expect(normalizeKodeLoket(123)).toBe("123");
    expect(normalizeKodeLoket("NA")).toBe("");
    expect(normalizeKodeLoket(" ab 12 ")).toBe("AB12");
  });
});

describe("port: normalizePeriodeToISO", () => {
  it("mendukung ragam format tanggal", () => {
    expect(normalizePeriodeToISO("20260914")).toBe("2026-09-14");
    expect(normalizePeriodeToISO("2026-09-14")).toBe("2026-09-14");
    expect(normalizePeriodeToISO("2026/09/14")).toBe("2026-09-14");
    expect(normalizePeriodeToISO("14/09/2026")).toBe("2026-09-14");
    expect(normalizePeriodeToISO("14-09-2026")).toBe("2026-09-14");
    expect(normalizePeriodeToISO(20260914)).toBe("2026-09-14");
  });

  it("menolak tanggal kalender invalid tanpa Invalid Date", () => {
    expect(normalizePeriodeToISO("2026-13-40")).toBeNull();
    expect(normalizePeriodeToISO("32/01/2026")).toBeNull();
    expect(normalizePeriodeToISO("")).toBeNull();
    expect(normalizePeriodeToISO("-")).toBeNull();
    expect(normalizePeriodeToISO(null)).toBeNull();
  });

  it("sanitizePeriodeOrToday fallback hari ini", () => {
    expect(sanitizePeriodeOrToday("14/09/2026")).toBe("2026-09-14");
    expect(sanitizePeriodeOrToday("bogus")).toBe(
      new Date().toISOString().slice(0, 10)
    );
  });
});

describe("port: parseBailoutRowsFromAOA (longgar + dedup)", () => {
  it("periode opsional, kode sama last-wins", () => {
    const result = parseBailoutRowsFromAOA([
      ["KODE", "NAMA", "BAILOUT"],
      ["A1", "Loket A", "Rp 1.000"],
      ["A1", "Loket A", "Rp 2.000"],
      ["TOTAL", "", "Rp 3.000"],
    ]);
    expect(result).toEqual([
      { kodeLoket: "A1", namaLoket: "Loket A", nominal: 2000, periode: "" },
    ]);
  });
});

describe("port: parseBailoutFromPaste (TSV)", () => {
  it("split tab, header dinamis, lewati TOTAL", () => {
    const text = [
      "KODE\tNAMA\tBAILOUT",
      "SBPAYS-01\tCV. Mitra Perdana\t-1.507.495",
      "TOTAL\t\t-1.507.495",
    ].join("\n");
    expect(parseBailoutFromPaste(text)).toEqual([
      {
        kodeLoket: "SBPAYS-01",
        namaLoket: "CV. Mitra Perdana",
        nominal: -1507495,
        periode: "",
      },
    ]);
  });

  it("fallback koma dan kosong -> []", () => {
    expect(
      parseBailoutFromPaste("KODE,NAMA,BAILOUT\nA1,Loket A,5000")
    ).toEqual([
      { kodeLoket: "A1", namaLoket: "Loket A", nominal: 5000, periode: "" },
    ]);
    expect(parseBailoutFromPaste("   ")).toEqual([]);
    expect(parseBailoutFromPaste("tanpa header jelas")).toEqual([]);
  });
});
