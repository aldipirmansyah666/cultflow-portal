import { describe, expect, it } from "vitest";
import { validateReconcileRows } from "../reconcileValidator";

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

  it("resi PKH valid bila diawali P260 atau TTSPOS", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P260111" },
      { produk: "PKH", nomor_resi: "TTSPOS222" },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
  });

  it("resi PKH invalid dengan reason tepat bila prefix salah", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "SHPE333" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[0]?.reason).toBe("Resi PKH harus diawali P260 atau TTSPOS");
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
});
