import { describe, expect, it } from "vitest";
import {
  buildReconcileBreakdown,
  countResiOccurrences,
  normalizeResi,
  validateReconcileRows,
} from "../reconcileValidator";

describe("validateReconcileRows — Rule 1 (row-level)", () => {
  it("resi EC3 valid bila diawali SHPE atau P26", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE123" },
      { produk: "EC3", nomor_resi: "P260456" },
      { produk: "EC3", nomor_resi: "P26999" },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it("resi EC3 invalid dengan reason tepat bila prefix salah", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "TTSPOS999" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[0]?.reason).toBe("Resi EC3 harus diawali SHPE atau P26");
    expect(result.isValid).toBe(false);
  });

  it("resi PKH valid untuk seluruh prefix yang diterima", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P260111" },
      { produk: "PKH", nomor_resi: "P26999" },
      { produk: "PKH", nomor_resi: "TTSPOS222" },
      { produk: "PKH", nomor_resi: "26MNG333" },
      { produk: "PKH", nomor_resi: "26ASD0000025474" },
      { produk: "PKH", nomor_resi: "26ASD0000025474XYZ" },
      { produk: "PKH", nomor_resi: "26KOM123" },
      { produk: "PKH", nomor_resi: "26EVP123" },
      { produk: "PKH", nomor_resi: "26ASD123" },
      { produk: "PKH", nomor_resi: "26999" },
      { produk: "PKH", nomor_resi: "26" },
      { produk: 'PKH', nomor_resi: '\u00a026mng\u200b123\u00a0' },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
  });

  it("prefix PKH case-insensitive (26kom kecil tetap cocok)", () => {
    const result = validateReconcileRows([
      { produk: "pkh", nomor_resi: "26kom123" },
      { produk: "PKH", nomor_resi: "26asd0000025474" },
      { produk: "PKH", nomor_resi: "ttspOs9" },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
  });

  it("OID6821522040 tidak lagi valid (di luar daftar 7 awalan bersama)", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "OID6821522040" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[0]?.code).toBe("PREFIX_MISMATCH");
  });

  it("resi PKH invalid dengan reason tepat bila prefix salah", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "SHPE333" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[0]?.reason).toBe(
      "Resi PKH harus diawali P26, TTSPOS, 26MNG, 26KOM, 26EVP, 26ASD, atau 26"
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

  it("produk tak dikenal ditolak sebagai UNKNOWN_OR_INVALID_PRODUCT", () => {
    const result = validateReconcileRows([
      { produk: "REG", nomor_resi: "XYZ123" },
      { nomor_resi: "XYZ456" },
      {},
      { produk: "EC 3", nomor_resi: "SHPE1" },
    ]);
    expect(result.rows.every((row) => !row.isValid)).toBe(true);
    expect(
      result.rows.every((row) => row.code === "UNKNOWN_OR_INVALID_PRODUCT")
    ).toBe(true);
    expect(
      result.rows.every((row) =>
        row.reason?.includes("UNKNOWN_OR_INVALID_PRODUCT")
      )
    ).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it("produk P260 dan TTSPOS mengikuti prefix masing-masing", () => {    const ok = validateReconcileRows([
      { produk: "P260", nomor_resi: "P260111" },
      { produk: "P260", nomor_resi: "P26999" },
      { produk: "TTSPOS", nomor_resi: "TTSPOS222" },
    ]);
    expect(ok.rows.every((row) => row.isValid)).toBe(true);
    expect(ok.isValid).toBe(true);

    const bad = validateReconcileRows([
      { produk: "P260", nomor_resi: "SHPE333" },
      { produk: "TTSPOS", nomor_resi: "P260444" },
    ]);
    expect(bad.rows.map((row) => row.isValid)).toEqual([false, false]);
    expect(bad.rows[0]?.code).toBe("PREFIX_MISMATCH");
  });

  it("produk PE memakai daftar awalan bersama PKH/PJB (case-insensitive)", () => {
    const ok = validateReconcileRows([
      { produk: "PE", nomor_resi: "P26123" },
      { produk: "pe", nomor_resi: "26kom123" },
      { produk: "PE", nomor_resi: "TTSPOS9" },
      { produk: "PE", nomor_resi: "26999" },
      { produk: "PE", nomor_resi: "  26EVP001 " },
    ]);
    expect(ok.rows.every((row) => row.isValid)).toBe(true);

    const bad = validateReconcileRows([
      { produk: "PE", nomor_resi: "SHPE333" },
      { produk: "PE", nomor_resi: "" },
    ]);
    expect(bad.rows.map((row) => row.isValid)).toEqual([false, false]);
    expect(bad.rows[0]?.code).toBe("PREFIX_MISMATCH");
    expect(bad.rows[0]?.reason).toBe(
      "Resi PE harus diawali P26, TTSPOS, 26MNG, 26KOM, 26EVP, 26ASD, atau 26"
    );
  });

  it("produk PJB memakai daftar awalan bersama PKH/PE (case-insensitive)", () => {
    const ok = validateReconcileRows([
      { produk: "PJB", nomor_resi: "PJB000" },
      { produk: "pjb", nomor_resi: "26mng123" },
      { produk: "PJB", nomor_resi: "26ASD7" },
    ]);
    // "PJB000" tidak berawalan daftar bersama -> invalid; sisanya valid.
    expect(ok.rows.map((row) => row.isValid)).toEqual([false, true, true]);
    expect(ok.rows[0]?.code).toBe("PREFIX_MISMATCH");
    expect(ok.rows[0]?.reason).toBe(
      "Resi PJB harus diawali P26, TTSPOS, 26MNG, 26KOM, 26EVP, 26ASD, atau 26"
    );

    const ok2 = validateReconcileRows([
      { produk: "PJB", nomor_resi: "P26123" },
      { produk: "PJB", nomor_resi: "TTSPOS9" },
    ]);
    expect(ok2.rows.every((row) => row.isValid)).toBe(true);
  });

  it("PE/PJB tidak lagi UNKNOWN dan masuk breakdown sendiri", () => {
    const result = validateReconcileRows([
      { produk: "PE", nomor_resi: "P261" },
      { produk: "PE", nomor_resi: "SALAH" },
      { produk: "PJB", nomor_resi: "26KOM2" },
      { produk: "PJB", nomor_resi: "SALAH" },
    ]);
    expect(result.rows.every((row) => row.code !== "UNKNOWN_OR_INVALID_PRODUCT")).toBe(true);
    const breakdown = buildReconcileBreakdown(result.rows);
    expect(breakdown).toMatchObject({
      peValid: 1,
      peInvalid: 1,
      pjbValid: 1,
      pjbInvalid: 1,
      unknownInvalid: 0,
    });
  });

  it("cakupan berkas PE/PJB memakai daftar bersama (anti false warning)", () => {
    // Resi 26KOM sah untuk PE walau tidak berprefix "PE" -> tanpa issue.
    const sharedOk = validateReconcileRows([
      { produk: "PE", nomor_resi: "26KOM1" },
      { produk: "PJB", nomor_resi: "26EVP2" },
    ]);
    expect(sharedOk.rows.every((row) => row.isValid)).toBe(true);
    expect(sharedOk.fileIssues).toHaveLength(0);
    expect(sharedOk.isValid).toBe(true);

    // Semua resi PE berprefix salah -> 1 issue cakupan.
    const incomplete = validateReconcileRows([
      { produk: "PE", nomor_resi: "XX1" },
    ]);
    expect(incomplete.fileIssues).toHaveLength(1);
    expect(incomplete.fileIssues[0]).toMatchObject({
      rule: "PRODUCT_PREFIX_COVERAGE",
    });
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
  it("berkas EC3 wajib memuat resi SHPE dan P26", () => {
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

  it("berkas PKH wajib memuat resi P26 dan TTSPOS", () => {
    const incomplete = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
    ]);
    expect(incomplete.fileIssues).toHaveLength(1);
    expect(incomplete.fileIssues[0]?.rule).toBe("PKH_PREFIX_COVERAGE");

    const complete = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
      { produk: "PKH", nomor_resi: "TTSPOS9" },
    ]);
    expect(complete.fileIssues).toHaveLength(0);
    expect(complete.isValid).toBe(true);
  });

  it("cakupan prefix dihitung per produk (regresi false-negative lintas-produk)", () => {
    // TTSPOS milik REG tidak boleh memenuhi syarat PKH.
    const crossProduct = validateReconcileRows([
      { produk: "PKH", nomor_resi: "P2601" },
      { produk: "REG", nomor_resi: "TTSPOS9" },
    ]);
    expect(crossProduct.rows[1]?.code).toBe("UNKNOWN_OR_INVALID_PRODUCT");
    expect(crossProduct.fileIssues).toHaveLength(1);
    expect(crossProduct.fileIssues[0]?.rule).toBe("PKH_PREFIX_COVERAGE");
    expect(crossProduct.isValid).toBe(false);

    // P26 milik EC3 tidak boleh memenuhi syarat PKH, dan sebaliknya.
    const mixed = validateReconcileRows([
      { produk: "EC3", nomor_resi: "P2601" },
      { produk: "PKH", nomor_resi: "TTSPOS2" },
    ]);
    expect(mixed.fileIssues).toHaveLength(2);
    expect(mixed.isValid).toBe(false);
  });

  it("berkas tanpa produk didukung tidak punya file issue (baris tetap invalid)", () => {
    const result = validateReconcileRows([{ produk: "REG", nomor_resi: "A1" }]);
    expect(result.fileIssues).toHaveLength(0);
    expect(result.rows[0]?.code).toBe("UNKNOWN_OR_INVALID_PRODUCT");
    expect(result.isValid).toBe(false);
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
    // Baris valid, tetapi cakupan P26/TTSPOS tetap ditagih.
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
      { produk: "PKH", nomor_resi: "SALAH1" },
      { produk: "EC3", nomor_resi: "SHPE5" },
      { produk: "EC3", nomor_resi: "P2606" },
      { produk: "EC3", nomor_resi: "SALAH2" },
      { produk: "REG", nomor_resi: "X1" },
    ]);
    expect(buildReconcileBreakdown(result.rows)).toEqual({
      pkhValid: 4,
      ec3Valid: 2,
      pkhInvalid: 1,
      ec3Invalid: 1,
      pkhValidByPrefix: {
        P26: 2,
        TTSPOS: 1,
        "26MNG": 1,
        "26KOM": 0,
        "26EVP": 0,
        "26ASD": 0,
        "26": 0,
      },
      ec3ValidByPrefix: { SHPE: 1, P26: 1 },
      otherValid: 0,
      otherInvalid: 0,
      peValid: 0,
      peInvalid: 0,
      pjbValid: 0,
      pjbInvalid: 0,
      unknownInvalid: 1,
      duplicateResiRows: 0,
      duplicateResiGroups: 0,
    });
  });

  it("prefix generik 26 tidak menelan prefix spesifik (longest-match)", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "26MNG1" },
      { produk: "PKH", nomor_resi: "26KOM2" },
      { produk: "PKH", nomor_resi: "26ASD0000025474" },
      { produk: "PKH", nomor_resi: "26ASD9" },
      { produk: "PKH", nomor_resi: "26999" },
    ]);
    const breakdown = buildReconcileBreakdown(result.rows);
    expect(breakdown.pkhValid).toBe(5);
    expect(breakdown.pkhValidByPrefix).toMatchObject({
      "26MNG": 1,
      "26KOM": 1,
      "26ASD": 2,
      "26": 1,
    });
  });

  it("berkas berisi prefix PKH baru saja: baris valid, cakupan tetap ditagih", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "26KOM1" },
      { produk: "PKH", nomor_resi: "26EVP2" },
    ]);
    expect(result.rows.every((row) => row.isValid)).toBe(true);
    // Varian 26* bukan P26/TTSPOS -> cakupan berkas belum komplit.
    expect(result.fileIssues).toHaveLength(2);
    expect(result.isValid).toBe(false);
  });

  it("kosong -> semua nol", () => {
    expect(buildReconcileBreakdown([])).toMatchObject({
      pkhValid: 0,
      ec3Valid: 0,
      pkhInvalid: 0,
      ec3Invalid: 0,
      unknownInvalid: 0,
      duplicateResiRows: 0,
      duplicateResiGroups: 0,
    });
  });
});

describe("validateReconcileRows — Rule 1b (DUPLICATE_RESI)", () => {
  it("resi ganda ditandai DUPLICATE_RESI pada semua kemunculan", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "P2602" },
    ]);
    expect(result.rows[0]?.isValid).toBe(false);
    expect(result.rows[1]?.isValid).toBe(false);
    expect(result.rows[0]?.code).toBe("DUPLICATE_RESI");
    expect(result.rows[0]?.reason).toContain("DUPLICATE_RESI");
    expect(result.rows[2]?.isValid).toBe(true);
    expect(result.summary).toEqual({ total: 3, valid: 1, invalid: 2 });
    expect(result.isValid).toBe(false);
    const breakdown = buildReconcileBreakdown(result.rows);
    expect(breakdown.duplicateResiRows).toBe(2);
    expect(breakdown.duplicateResiGroups).toBe(1);
  });

  it("duplikat lintas produk tetap terdeteksi (perbandingan case-insensitive)", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "P2609" },
      { produk: "PKH", nomor_resi: " p2609 " },
    ]);
    expect(result.rows.map((row) => row.isValid)).toEqual([false, false]);
    expect(
      result.rows.every((row) => row.reason?.includes("DUPLICATE_RESI"))
    ).toBe(true);
  });

  it("resi kosong tidak dihitung sebagai duplikat", () => {
    const breakdown = buildReconcileBreakdown([
      { index: 0, produk: "EC3", nomorResi: "", isValid: false },
      { index: 1, produk: "EC3", nomorResi: "", isValid: false },
    ]);
    expect(breakdown.duplicateResiRows).toBe(0);
    expect(breakdown.duplicateResiGroups).toBe(0);
  });

  it("tiga kemunculan = 1 grup, 3 baris", () => {
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "TTSPOS7" },
      { produk: "PKH", nomor_resi: "TTSPOS7" },
      { produk: "PKH", nomor_resi: "TTSPOS7" },
    ]);
    const breakdown = buildReconcileBreakdown(result.rows);
    expect(breakdown.duplicateResiRows).toBe(3);
    expect(breakdown.duplicateResiGroups).toBe(1);
  });

  it("duplikat menumpuk di atas error lain: kode awal dipertahankan, alasan digabung", () => {
    // SHPE333 invalid untuk PKH (PREFIX_MISMATCH) SEKALIGUS ganda.
    const result = validateReconcileRows([
      { produk: "PKH", nomor_resi: "SHPE333" },
      { produk: "EC3", nomor_resi: "SHPE333" },
      { produk: "EC3", nomor_resi: "SHPE333" },
    ]);
    expect(result.rows.map((row) => row.isValid)).toEqual([false, false, false]);
    // Baris 0 sudah invalid duluan -> kode PREFIX_MISMATCH tetap, alasan
    // duplikat ditambahkan (kedua masalah terekam, tidak saling menimpa).
    expect(result.rows[0]?.code).toBe("PREFIX_MISMATCH");
    expect(result.rows[0]?.reason).toContain("DUPLICATE_RESI");
    // Baris valid yang jadi ganda -> murni DUPLICATE_RESI.
    expect(result.rows[1]?.code).toBe("DUPLICATE_RESI");
    expect(result.rows[2]?.code).toBe("DUPLICATE_RESI");
  });

  it("dua grup duplikat terpisah dihitung akurat di breakdown", () => {
    const result = validateReconcileRows([
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "SHPE1" },
      { produk: "EC3", nomor_resi: "P2602" },
      { produk: "EC3", nomor_resi: "P2602" },
      { produk: "EC3", nomor_resi: "P2603" },
    ]);
    const breakdown = buildReconcileBreakdown(result.rows);
    expect(breakdown.duplicateResiGroups).toBe(2);
    expect(breakdown.duplicateResiRows).toBe(4);
    expect(result.summary).toEqual({ total: 5, valid: 1, invalid: 4 });
  });

  it("countResiOccurrences: ternormalisasi, resi kosong dikecualikan", () => {
    const counts = countResiOccurrences([
      { nomorResi: "SHPE1" },
      { nomorResi: "SHPE1" },
      { nomorResi: "" },
      { nomorResi: "" },
    ]);
    expect(counts.get("SHPE1")).toBe(2);
    expect(counts.has("")).toBe(false);
  });
});
