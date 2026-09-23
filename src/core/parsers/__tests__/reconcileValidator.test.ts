import { describe, expect, it } from "vitest";
import {
  buildReconcileBreakdown,
  normalizeResi,
  validateReconcileRows,
} from "../reconcileValidator";

describe("validateReconcileRows — Rule 1 (row-level)", () => {
  it("resi EC3 valid bila diawali SHPE atau P260", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE123" },
      { produk: "EC3", nomor_resi: "P260456" },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it("resi EC3 invalid dengan reason tepat bila prefix salah", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "TTSPOS999" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[0]?.reason).toBe("Resi EC3 harus diawali SHPE atau P260");
    expect(result.isValid).toBe(false);
  });

  it("resi PKH valid bila diawali P260, TTSPOS, atau 26MNG", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P260111" },
      { produk: "PKH", nomor_resi: "TTSPOS222" },
      { produk: "PKH", nomor_resi: "26MNG333" },
      { produk: 'PKH', nomor_resi: '\u00a026mng\u200b123\u00a0' },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
  });

  it("resi PKH invalid dengan reason tepat bila prefix salah", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "SHPE333" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[0]?.reason).toBe(
      "Resi PKH harus diawali P260, TTSPOS, atau 26MNG"
    );
  });

  it("normalisasi resi: NBSP, zero-width, dan spasi dalam dihapus", () => {
    expect(normalizeResi("\u00a026MNG123\u00a0")).toBe("26MNG123");
    expect(normalizeResi("26\u200bMNG123")).toBe("26MNG123");
    expect(normalizeResi("26 MNG 123")).toBe("26MNG123");
    expect(normalizeResi(" 26mng1 ")).toBe("26MNG1");
    const result = validateReconcileRows([
      { produk: 'PKH', nomor_resi: '\u00a026mng\u200b123\u00a0' },
    ]);
    expect(result.rows[0]).toMatchObject({
      nomorResi: "26MNG123",
      isValid: true,
    });
  });

  it("produk lain selalu valid", () => {
    const result = validateReconcileRows([
      { produk: "REG", nomor_resi: "XYZ123" },
      { nomor_resi: "XYZ456" },
      {},
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it("perbandingan case-insensitive dan tahan spasi", () => {
    const result = validateReconcileRows([
      { produk: "  ec3 ", nomor_resi: " shpe789 " },
    ]);
    expect(result.rows[0]).toMatchObject({
      produk: "EC3",
      nomorResi: "SHPE789",
      isValid: true,
    });
  });

  it("resi kosong untuk EC3/PKH dianggap invalid", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "" },
      { produk: "PKH" },
    ]);
    expect(result.rows.map((row) => row.isValid)).toEqual([false, false]);
  });
});

describe("validateReconcileRows — Rule 2 (file-level)", () => {
  it("berkas EC3 wajib memuat resi SHPE dan P260", () => {
    const onlyShpe = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "SHPE2" },
    ]);
    expect(onlyShpe.fileIssues).toHaveLength(1);
    expect(onlyShpe.fileIssues[0]).toMatchObject({
      rule: "EC3_PREFIX_COVERAGE",
    });
    expect(onlyShpe.isValid).toBe(false);

    const complete = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "P2602" },
    ]);
    expect(complete.fileIssues).toHaveLength(0);
    expect(complete.isValid).toBe(true);
  });

  it("berkas PKH wajib memuat resi P260 dan TTSPOS", () => {
    const incomplete = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
    ]);
    expect(incomplete.fileIssues).toHaveLength(1);
    expect(incomplete.fileIssues[0]?.rule).toBe("PKH_PREFIX_COVERAGE");

    const complete = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
      { produk: "REG", nomor_resi: "TTSPOS9" },
    ]);
    expect(complete.fileIssues).toHaveLength(0);
    expect(complete.isValid).toBe(true);
  });

  it("berkas tanpa EC3/PKH tidak punya file issue", () => {
    const result = validateReconcileRows([{ produk: "REG", nomor_resi: "A1" }]);
    expect(result.fileIssues).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it("summary menghitung total/valid/invalid", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "P2602" },
      { produk: "PKH", nomor_resi: "SALAH" },
    ]);
    expect(result.summary).toEqual({ total: 3, valid: 2, invalid: 1 });
    expect(result.isValid).toBe(false);
  });

  it("Rule 2 PKH tidak menuntut 26MNG (berkas lama tetap komplit)", () => {
    const legacy = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
      { produk: "PKH", nomor_resi: "TTSPOS2" },
    ]);
    expect(legacy.fileIssues).toHaveLength(0);
    expect(legacy.isValid).toBe(true);

    const only26mng = validateReconcileRows([
      { produk: "PKH", nomor_resi: "26MNG1" },
    ]);
    // Baris valid, tetapi cakupan P260/TTSPOS tetap ditagih.
    expect(only26mng.rows[0]?.isValid).toBe(true);
    expect(only26mng.fileIssues).toHaveLength(2);
    expect(only26mng.isValid).toBe(false);
  });
});

describe("buildReconcileBreakdown", () => {
  it("rincian valid/invalid per produk dan prefix", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
      { produk: "PKH", nomor_resi: "P2602" },
      { produk: "PKH", nomor_resi: "TTSPOS3" },
      { produk: "PKH", nomor_resi: "26MNG4" },
      { produk: "PKH", nomor_resi: "SALAH" },
      { produk: "EC3", nomor_resi: "SHPE5" },
      { produk: "EC3", nomor_resi: "P2606" },
      { produk: "EC3", nomor_resi: "SALAH" },
      { produk: "REG", nomor_resi: "X1" },
    ]);
    expect(buildReconcileBreakdown(result.rows)).toEqual({
      pkhValid: 4,
      ec3Valid: 2,
      pkhInvalid: 1,
      ec3Invalid: 1,
      pkhValidByPrefix: { P260: 2, TTSPOS: 1, "26MNG": 1 },
      ec3ValidByPrefix: { SHPE: 1, P260: 1 },
    });
  });

  it("kosong -> semua nol", () => {
    expect(buildReconcileBreakdown([])).toMatchObject({
      pkhValid: 0,
      ec3Valid: 0,
      pkhInvalid: 0,
      ec3Invalid: 0,
    });
  });
});
