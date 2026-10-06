import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCariSlipText,
  buildFeeAgentProfile,
  buildFeeCsv,
  buildFullModuleBreakdown,
  buildModuleBreakdown,
  buildRincianText,
  CARI_MODULE_MAP,
  classifyFeeDbError,
  deleteFeeRows,
  deriveLoketStatus,
  deriveRichStatus,
  detectFeeHeader,
  dropAllFeeData,
  excelSerialToTanggal,
  isPaidStatus,
  LOKET_BSB_TARGET,
  displayNamaLoket,
  fetchLoketLookup,
  fillMergedCells,
  filterFeeRows,
  FEE_DELETE_MAX_IDS,
  fetchFeeList,
  isCariSheetMatrix,
  isNontrivialFullParse,
  isPpidLike,
  isProfilDbRow,
  normalizeImportProfil,
  normalizeLoketStatusInput,
  parseCariSheet,
  parseLoketBsbFull,
  parseUniversalFeeRows,
  resolveTanggalTransfer,
  selectFeeSheet,
  slipImageFilename,
  statusLabelCari,
  toFeeRekapRowFromProfil,
  toLoketDetailDbRows,
  toLoketProfileDbRow,
  trimTrailingEmptyRows,
  formatPeriode,
  formatRupiah,
  getSelectedLoketData,
  IMPORT_CHUNK_SIZE,
  MOCK_FEE_DATA,
  canonicalFeeSearch,
  escapeFeeLike,
  normalizeHeaderCell,
  normalizePpid,
  paginateRows,
  ppidFuzzyPattern,
  ppidSearchKey,
  toFeeDbRow,
  parseAmount,
  parseStatus,
  parseFeeRowsFromAOA,
  parseLoketBsbRows,
  periodeOptions,
  runBatchesIsolated,
  sanitizeFeeSearch,
  saveFeeImport,
  splitIntoChunks,
  toAbsoluteAmount,
  toFeeRekapRow,
  toUploadLog,
  verifyFeeImport,
  type FeeRekapRow,
  type LoketProfileFull,
} from "./feeRekapService";

describe("feeRekapService", () => {
  it("formatRupiah memakai format IDR", () => {
    expect(formatRupiah(1_250_000)).toBe("Rp 1.250.000");
    expect(formatPeriode("2026-09")).toBe("September 2026");
  });

  it("filter realtime by PPID/nama + periode", () => {
    expect(filterFeeRows(MOCK_FEE_DATA, "ckm-001", "").length).toBe(1);
    expect(filterFeeRows(MOCK_FEE_DATA, "kios", "").length).toBeGreaterThan(1);
    expect(
      filterFeeRows(MOCK_FEE_DATA, "", "2026-09").every(
        (r) => r.periode === "2026-09"
      )
    ).toBe(true);
  });

  it("paginate memotong halaman dengan aman", () => {
    const { pageRows, totalPages } = paginateRows(MOCK_FEE_DATA, 2, 5);
    expect(totalPages).toBe(3);
    expect(pageRows).toHaveLength(5);
    expect(paginateRows(MOCK_FEE_DATA, 99, 5).pageRows.length).toBeGreaterThan(0);
  });

  it("parse AOA mendeteksi header dinamis", () => {
    const matrix = [
      ["Rekap Fee", "", "", ""],
      ["PPID", "Nama Loket", "Total Fee", "Status"],
      ["SBPOS-X-1", "Agen X", 100000, "Terbayar"],
      ["", "", "", ""],
    ];
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "test");
    expect(parsed.detectedHeaderRow).toBe(1);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.status).toBe("TERBAYAR");
    expect(periodeOptions(MOCK_FEE_DATA)).toContain("2026-09");
  });

  it("buildFeeCsv menghasilkan header + baris", () => {
    const csv = buildFeeCsv(MOCK_FEE_DATA.slice(0, 2));
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("PPID");
  });

  it("sanitizeFeeSearch membuang wildcard/pemisah PostgREST", () => {
    expect(sanitizeFeeSearch("muc,sp (a%b_c)")).toBe("muc sp a b c");
    expect(sanitizeFeeSearch("  ")).toBe("");
  });

  it("toFeeRekapRow memetakan snake_case + normalisasi status/rincian", () => {
    const row = toFeeRekapRow({
      id: "uuid-1",
      ppid: "mucspa1",
      nama_loket: "Agen X",
      periode: "2026-09",
      total_fee: 1500000,
      status: "terbayar",
      rincian: [{ label: "Komisi", nilai: 1500000 }],
      updated_at: "2026-09-28T00:00:00Z",
    });
    expect(row.ppid).toBe("MUCSPA1");
    expect(row.status).toBe("TERBAYAR");
    expect(row.rincian).toHaveLength(1);
    expect(
      toFeeRekapRow({
        id: "u2",
        ppid: "P2",
        nama_loket: "",
        periode: "2026-09",
        total_fee: NaN,
        status: "aneh",
        rincian: null,
        updated_at: "",
      }).status
    ).toBe("PENDING");
  });

  it("toUploadLog memetakan baris fee_upload_logs", () => {
    expect(
      toUploadLog({
        id: "l1",
        tanggal_upload: "2026-09-28T09:00:00+07:00",
        nama_file: "f.xlsx",
        jumlah_baris: 7,
        periode: "2026-09",
        diunggah_oleh: "admin",
      })
    ).toMatchObject({ namaFile: "f.xlsx", jumlahBaris: 7 });
  });

  it("splitIntoChunks memotong dengan sisa yang benar", () => {
    expect(splitIntoChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitIntoChunks([], 500)).toEqual([]);
    expect(splitIntoChunks([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("classifyFeeDbError: tabel hilang -> 503 MIGRATION_MISSING", () => {
    const missing = classifyFeeDbError(
      { code: "42P01", message: 'relation "public.fee_loket" does not exist' },
      "fee_loket",
      "fallback"
    );
    expect(missing.status).toBe(503);
    expect(missing.code).toBe("MIGRATION_MISSING");
    expect(missing.message).toContain("20260924000000_fee_loket.sql");

    const rls = classifyFeeDbError(
      { code: "42501", message: "permission denied for table fee_loket" },
      "fee_loket",
      "fallback"
    );
    expect(rls).toMatchObject({ status: 503, code: "RLS_DENIED" });

    const generic = classifyFeeDbError(
      { code: "XX000", message: "boom" },
      "fee_loket",
      "fallback"
    );
    expect(generic).toMatchObject({ status: 500, code: "DB_ERROR" });
  });
});

describe("parseAmount (robust currency)", () => {
  it("menangani Number, string polos, dan format Rp", () => {
    expect(parseAmount(50000)).toBe(50000);
    expect(parseAmount(975.5)).toBe(976);
    expect(parseAmount("50000")).toBe(50000);
    expect(parseAmount("Rp 50.000")).toBe(50000);
    expect(parseAmount("Rp 1.250.000")).toBe(1250000);
    expect(parseAmount("rp1.000")).toBe(1000);
  });

  it("menangani koma desimal Indonesia dan negatif akuntansi", () => {
    expect(parseAmount("1.250.000,50")).toBe(1250001);
    expect(parseAmount("(2.500)")).toBe(-2500);
    expect(parseAmount("-3.000")).toBe(-3000);
  });

  it("kosong/tak-valid menjadi 0", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount(NaN)).toBe(0);
    expect(parseAmount("abc")).toBe(0);
  });

  it("akhiran ',-' Indonesia dan tanda hubung", () => {
    expect(parseAmount("Rp 1.250.000,-")).toBe(1250000);
    expect(parseAmount("2.500,-")).toBe(2500);
    expect(parseAmount("–")).toBe(0);
    expect(parseAmount("1 250 000")).toBe(1250000);
  });

  it("titik desimal ala US tidak meledak 100x (regresi Rp-0/salah nominal)", () => {
    // "1500000.00": satu titik + 2 digit pecahan BUKAN pola ribuan
    // (\d{1,3} + grup tepat 3 digit) -> desimal, bukan 150000000.
    expect(parseAmount("1500000.00")).toBe(1500000);
    expect(parseAmount("1507495.00")).toBe(1507495);
    // Pola ribuan Indonesia tetap utuh.
    expect(parseAmount("2.500")).toBe(2500);
    expect(parseAmount("1.500.000")).toBe(1500000);
    expect(toAbsoluteAmount("1500000")).toBe(1500000);
  });
});

describe("parseStatus (kata negatif dicek dulu — regresi)", () => {
  it("'Belum Bayar' dkk TERBACA PENDING, bukan TERBAYAR", () => {
    // Jebakan utama: mengandung substring "BAYAR"/"LUNAS"/"PAID" tetapi
    // berawalan kata negatif — wajib PENDING.
    for (const pending of [
      "Belum Bayar",
      "belum bayar",
      "Belum Dibayar",
      "Tidak Dibayar",
      "Tidak Lunas",
      "Belum Lunas",
      "Pending",
      "Batal Bayar",
      "Gagal Transfer",
      "Piutang",
      "UNPAID",
      "",
      "  ",
      "aneh",
    ]) {
      expect(parseStatus(pending)).toBe("PENDING");
    }
    expect(parseStatus(null)).toBe("PENDING");
    expect(parseStatus(undefined)).toBe("PENDING");
  });

  it("varian lunas tetap TERBAYAR", () => {
    for (const paid of [
      "Terbayar",
      "Sudah Dibayar",
      "Lunas",
      "PAID",
      "Success",
      "Done",
      "Sudah Transfer Lunas",
    ]) {
      expect(parseStatus(paid)).toBe("TERBAYAR");
    }
  });

  it("end-to-end: kolom Status 'Belum Bayar' di Excel -> PENDING", () => {
    const parsed = parseFeeRowsFromAOA(
      [
        ["PPID", "Nama Loket", "Total Fee", "Status"],
        ["SB-1", "Agen A", 100000, "Belum Bayar"],
        ["SB-2", "Agen B", 200000, "Terbayar"],
      ],
      "2026-09",
      "t"
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.status).toBe("PENDING");
    expect(parsed.rows[1]?.status).toBe("TERBAYAR");
  });
});

describe("matrix helpers (.xlsb)", () => {
  it("trimTrailingEmptyRows membuang ekor kosong (skipped akurat)", () => {
    const matrix = [
      ["PPID", "Nama Loket", "Total Fee"],
      ["SB-1", "Agen A", 1000],
      ["", "", ""],
      ["", "", ""],
    ];
    const trimmed = trimTrailingEmptyRows(matrix);
    expect(trimmed).toHaveLength(2);
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(0);
  });

  it("fillMergedCells meneruskan nilai anchor ke sel kosong", () => {
    const matrix = [
      ["PPID", "Nama Loket", "Total Fee"],
      ["SB-1", "Agen A", 1000],
      ["", "", 2000],
    ];
    const filled = fillMergedCells(matrix, [
      { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
      { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    ]);
    expect(filled[2]?.[0]).toBe("SB-1");
    expect(filled[2]?.[1]).toBe("Agen A");
    // Sel terisi tidak ditimpa; input asli tidak dimutasi.
    expect(filled[2]?.[2]).toBe(2000);
    expect(matrix[2]?.[0]).toBe("");
    const parsed = parseFeeRowsFromAOA(filled, "2026-09", "t");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]?.ppid).toBe("SB-1");
  });

  it("detectFeeHeader dipakai pemindai sheet", () => {
    expect(
      detectFeeHeader([
        ["Judul Rekap", "", ""],
        ["PPID", "Nama Loket", "Total Fee"],
      ])?.headerRow
    ).toBe(1);
    expect(detectFeeHeader([["Tidak", "Relevan"]])).toBeNull();
  });
});

describe("normalizeHeaderCell + deteksi kolom", () => {
  it("lowercase + trim spasi", () => {
    expect(normalizeHeaderCell("PPID ")).toBe("ppid");
    expect(normalizeHeaderCell("  Nama Loket")).toBe("nama loket");
    expect(normalizeHeaderCell("TOTAL FEE (Rp)")).toBe("total fee rp");
  });

  it("header varian umum terpetakan dengan benar", () => {
    const matrix = [
      ["PPID ", "Nama Loket", "Fee Loket", "Total Fee"],
      ["SB-1", "Agen A", 100000, 250000],
    ];
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(parsed.detectedHeaderRow).toBe(0);
    // "Total Fee" menang atas "Fee Loket" (bukan kolom pertama).
    expect(parsed.rows[0]?.totalFee).toBe(250000);
    expect(parsed.rows[0]?.namaLoket).toBe("Agen A");
  });

  it("'Kode Loket' boleh jadi kunci bila kolom Nama terpisah (tanpa tabrakan)", () => {
    const matrix = [
      ["Kode Loket", "Nama Loket", "Total Fee"],
      ["K-1", "Agen K", 50000],
    ];
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(parsed.detectedHeaderRow).toBe(0);
    expect(parsed.rows[0]?.ppid).toBe("K-1");
    expect(parsed.rows[0]?.namaLoket).toBe("Agen K");
    expect(parsed.rows[0]?.totalFee).toBe(50000);
  });

  it("header tanpa kolom Nama ditolak (anti salah petakan)", () => {
    const matrix = [
      ["Kode Loket", "Total Fee"],
      ["K-1", 50000],
    ];
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(parsed.detectedHeaderRow).toBe(-1);
    expect(parsed.rows).toHaveLength(0);
  });

  it("kolom potongan menjadi pengurang + rincian", () => {
    const matrix = [
      ["PPID", "Nama Loket", "Total Fee", "Potongan Admin", "Status"],
      ["SB-9", "Agen P", 1000000, 50000, "Pending"],
    ];
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(parsed.rows[0]?.totalFee).toBe(950000);
    expect(parsed.rows[0]?.rincian).toHaveLength(2);
    expect(parsed.rows[0]?.rincian[1]?.nilai).toBe(-50000);
  });
});

describe("header nama/fee varian tambahan", () => {
  it("mengenali 'Nama Pos', 'Outlet', 'Jumlah Fee', 'Fee Bersih'", () => {
    const matrix = [
      ["PPID", "Nama Pos", "Jumlah Fee", "Status"],
      ["SB-1", "Pos A", 75000, "Terbayar"],
    ];
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(parsed.detectedHeaderRow).toBe(0);
    expect(parsed.rows[0]?.namaLoket).toBe("Pos A");
    expect(parsed.rows[0]?.totalFee).toBe(75000);

    const outlet = parseFeeRowsFromAOA(
      [["PPID", "Outlet", "Fee Bersih"], ["SB-2", "Outlet B", 90000]],
      "2026-09",
      "t"
    );
    expect(outlet.rows[0]?.namaLoket).toBe("Outlet B");
    expect(outlet.rows[0]?.totalFee).toBe(90000);
  });

  it("'Fee Bersih' menang atas 'Fee' biasa", () => {
    const parsed = parseFeeRowsFromAOA(
      [
        ["PPID", "Nama Loket", "Fee", "Fee Bersih"],
        ["SB-3", "Agen C", 10000, 80000],
      ],
      "2026-09",
      "t"
    );
    expect(parsed.rows[0]?.totalFee).toBe(80000);
  });

  it("varian payout: 'Total Bayar', 'Fee Dibayar', 'Nilai Pencairan'", () => {
    for (const feeHeader of [
      "TOTAL BAYAR",
      "Total Transfer",
      "NILAI PENCAIRAN",
      "TOTAL LUNAS",
      "FEE DIBAYAR",
    ]) {
      const parsed = parseFeeRowsFromAOA(
        [
          ["PPID", "Nama Loket", feeHeader],
          ["SB-8", "Agen H", 250000],
        ],
        "2026-08",
        "t"
      );
      expect(parsed.rows[0]?.totalFee).toBe(250000);
    }
    // Kolom status-teks tetap bukan fee.
    expect(
      parseFeeRowsFromAOA(
        [
          ["PPID", "Nama Loket", "Tanggal Bayar"],
          ["SB-8", "Agen H", "12/08/2026"],
        ],
        "2026-08",
        "t"
      ).detectedHeaderRow
    ).toBe(-1);
  });

  it("audit: allZero + sampel mentah + formula tanpa nilai", () => {
    const matrix = [
      ["PPID", "Nama Loket", "Total Fee"],
      ["SB-1", "Agen A", ""],
      ["SB-2", "Agen B", ""],
    ];
    const withFormula = parseFeeRowsFromAOA(matrix, "2026-09", "t", {
      inspectCell: (r, c) =>
        r >= 1 && c === 2 ? { hasFormula: true } : undefined,
    });
    expect(withFormula.audit.allZero).toBe(true);
    expect(withFormula.audit.zeroFeeRows).toBe(2);
    expect(withFormula.audit.formulaWithoutValue).toBe(2);
    expect(withFormula.audit.samples).toHaveLength(2);
    expect(withFormula.audit.samples[0]).toMatchObject({
      matrixRow: 1,
      ppid: "SB-1",
      parsed: 0,
      hasFormula: true,
    });

    const plain = parseFeeRowsFromAOA(matrix, "2026-09", "t");
    expect(plain.audit.allZero).toBe(true);
    expect(plain.audit.formulaWithoutValue).toBe(0);
    expect(plain.audit.samples[0]?.hasFormula).toBe(false);
  });

  it("varian total (.xlsb): 'Grand Total' & 'Total Diterima' terpetakan", () => {
    const grand = parseFeeRowsFromAOA(
      [
        ["PPID", "Nama Loket", "Grand Total"],
        ["SB-4", "Agen D", 1750000],
      ],
      "2026-08",
      "t"
    );
    expect(grand.rows[0]?.totalFee).toBe(1750000);
    expect(grand.columns.fee).toBe("Grand Total");

    const terima = parseFeeRowsFromAOA(
      [
        ["PPID", "Nama Loket", "Total Diterima", "Status"],
        ["SB-5", "Agen E", "Rp 2.000.000", "Lunas"],
      ],
      "2026-08",
      "t"
    );
    expect(terima.rows[0]?.totalFee).toBe(2000000);
    expect(terima.rows[0]?.status).toBe("TERBAYAR");
  });

  it("'Total Transaksi' (kolom hitung) tidak dimakan sebagai fee", () => {
    const parsed = parseFeeRowsFromAOA(
      [
        ["PPID", "Nama Loket", "Total Transaksi"],
        ["SB-6", "Agen F", 42],
      ],
      "2026-08",
      "t"
    );
    expect(parsed.detectedHeaderRow).toBe(-1);
    expect(parsed.rows).toHaveLength(0);
  });

  it("columns mengekspos label asli untuk diagnostik UI", () => {
    const parsed = parseFeeRowsFromAOA(
      [
        ["PPID", "Nama Loket", "Total Fee", "Potongan Admin"],
        ["SB-7", "Agen G", 100000, 5000],
      ],
      "2026-09",
      "t"
    );
    expect(parsed.columns).toMatchObject({
      ppid: "PPID",
      nama: "Nama Loket",
      fee: "Total Fee",
      potongan: ["Potongan Admin"],
    });
  });
});

/** Matriks 200 kolom ala sheet Loket BSB: header idx 2, data idx 5. */
function loketBsbMatrix(): unknown[][] {
  const blank = () => Array<string>(200).fill("");
  const header = blank();
  header[1] = "PPID";
  header[2] = "Nama Loket";
  header[10] = "Total Fee";
  header[189] = "JUMLAH FEE BULAN INI";
  header[191] = "JUMLAH FEE";
  return [
    ["REKAP FEE", ...blank().slice(1)],
    ["Periode: Agustus 2026", ...blank().slice(1)],
    header,
    ["", "SUBTOTAL", ...blank().slice(2)],
    ["", "", ...blank().slice(2)],
    ["1", "12BSPA19010BDLMH", "LOKET BSB CIAMIS", ...blank().slice(3)],
    ["2", "12BSPA19011BDLMH", "", ...blank().slice(3)],
    ["", "", ...blank().slice(2)],
  ];
}

function withFeeMatrixValue(matrix: unknown[][], row: number, col: number, value: unknown) {
  (matrix[row] as unknown[])[col] = value;
}

describe("selectFeeSheet + layout Loket BSB", () => {
  it("memilih sheet 'Loket BSB' (exact, lalu case-insensitive)", () => {
    expect(selectFeeSheet(["Cover", "Loket BSB"])?.name).toBe("Loket BSB");
    expect(selectFeeSheet(["loket bsb"])?.name).toBe("loket bsb");
    expect(selectFeeSheet(["Cover", "Rekap"])?.name).toBeUndefined();
    expect(selectFeeSheet(["Cover", "Rekap"])).toBeNull();
  });

  it("hint kolom fee menang atas decoy 'Total Fee'", () => {
    const matrix = loketBsbMatrix();
    (matrix[2] as string[])[189] = "JUMLAH FEE BULAN INI";
    const detected = detectFeeHeader(matrix, {
      headerRowHint: 2,
      columnHints: { ppid: 1, nama: 2, fee: [189, 191, 196] },
    });
    expect(detected?.headerRow).toBe(2);
    expect(detected?.ppidCol).toBe(1);
    expect(detected?.namaCol).toBe(2);
    expect(detected?.feeCol).toBe(189);
  });

  it("parse layout Loket BSB: data dari indeks 5 + dropna PPID", () => {
    const matrix = loketBsbMatrix();
    const feeRow = matrix[5] as unknown[];
    feeRow[189] = 1500000;
    const blankRow = matrix[7] as unknown[];
    blankRow[1] = "";
    const parsed = parseFeeRowsFromAOA(matrix, "2026-08", "bsb", {
      headerRowHint: LOKET_BSB_TARGET.headerRowHint,
      dataStartRowHint: LOKET_BSB_TARGET.dataStartRowHint,
      columnHints: { ...LOKET_BSB_TARGET.columnHints },
    });
    // Baris indeks 5 (fee 1.5jt) + indeks 6 (nama fallback PPID); baris
    // subtotal/kosong di atas data dan ekor kosong tidak ikut.
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.ppid).toBe("12BSPA19010BDLMH");
    expect(parsed.rows[0]?.namaLoket).toBe("LOKET BSB CIAMIS");
    expect(parsed.rows[0]?.totalFee).toBe(1500000);
    expect(parsed.rows[1]?.namaLoket).toBe("12BSPA19011BDLMH");
    expect(parsed.skipped).toBe(0);
  });
});

describe("toFeeRekapRow (koersi bigint PostgREST)", () => {
  function dbRow(totalFee: unknown) {
    return {
      id: "u1",
      ppid: "53JCUM03019BGRLM",
      nama_loket: "Loket BSB",
      periode: "2026-08",
      total_fee: totalFee,
      status: "TERBAYAR",
      rincian: [{ label: "Jumlah Fee", nilai: totalFee }],
      updated_at: "2026-08-28T00:00:00Z",
    };
  }

  it("string numerik bigint TIDAK menjadi 0 (regresi Rp-0 massal)", () => {
    // PostgREST mengembalikan kolom bigint sebagai string JSON.
    const row = toFeeRekapRow(dbRow("1507495") as never);
    expect(row.totalFee).toBe(1507495);
    expect(row.ppid).toBe("53JCUM03019BGRLM");
    expect(row.rincian[0]?.nilai).toBe(1507495);
  });

  it("number tetap didukung; null/tak-valid menjadi 0", () => {
    expect(toFeeRekapRow(dbRow(250000) as never).totalFee).toBe(250000);
    expect(toFeeRekapRow(dbRow(null) as never).totalFee).toBe(0);
    expect(toFeeRekapRow(dbRow("Rp 50.000") as never).totalFee).toBe(50000);
  });
});

describe("toAbsoluteAmount (Number-dulu)", () => {
  it("angka dan string numerik polos apa adanya", () => {
    expect(toAbsoluteAmount(1500000)).toBe(1500000);
    expect(toAbsoluteAmount("1500000")).toBe(1500000);
    expect(toAbsoluteAmount("  2500  ")).toBe(2500);
    expect(toAbsoluteAmount("")).toBe(0);
    expect(toAbsoluteAmount(null)).toBe(0);
    expect(toAbsoluteAmount(NaN)).toBe(0);
  });

  it("fallback parseAmount untuk format Indonesia", () => {
    expect(toAbsoluteAmount("Rp 1.500.000")).toBe(1500000);
    expect(toAbsoluteAmount("1.500.000")).toBe(1500000);
    expect(toAbsoluteAmount("1.500.000,50")).toBe(1500001);
    expect(toAbsoluteAmount("Rp 2.500,-")).toBe(2500);
  });
});

describe("format kurung akuntansi (konsistensi parseAmount vs toAbsoluteAmount)", () => {
  it("'(Rp 5.000)' terurai konsisten sebagai -5000 di kedua parser", () => {
    // Unifikasi parser: angka minus berkurung (khas koreksi/potongan di
    // Excel) tidak boleh beda tafsir antara preview client dan server.
    expect(parseAmount("(Rp 5.000)")).toBe(-5000);
    expect(toAbsoluteAmount("(Rp 5.000)")).toBe(-5000);
  });

  it("varian kurung/minus lain konsisten di kedua parser", () => {
    const cases: [unknown, number][] = [
      ["(2.500)", -2500],
      ["(Rp 1.507.495)", -1507495],
      ["-3.000", -3000],
      ["Rp 1.507.495", 1507495],
      ["(1.250.000,50)", -1250001],
    ];
    for (const [raw, expected] of cases) {
      expect(parseAmount(raw)).toBe(expected);
      expect(toAbsoluteAmount(raw)).toBe(expected);
    }
  });
});

describe("parseLoketBsbRows (aturan mutlak)", () => {
  it("memakai fee idx 191 (JUMLAH FEE) dengan nilai string Rp", () => {
    const matrix = loketBsbMatrix();
    // Samakan baris data dengan skenario loket BSB nyata.
    (matrix[5] as unknown[])[1] = "53JCUM03019BGRLM";
    (matrix[5] as unknown[])[2] = "LOKET BSB A";
    withFeeMatrixValue(matrix, 5, 189, 111);
    withFeeMatrixValue(matrix, 5, 191, "Rp 1.507.495");
    const parsed = parseLoketBsbRows(matrix, "2026-08", "bsb");
    expect(parsed).not.toBeNull();
    // 2 baris: indeks 5 (fee Rp 1.507.495) + indeks 6 yang PPID-nya ada
    // tetapi nama kosong -> fallback nama = PPID (aturan bisnis: baris
    // tetap valid, bukan dibuang). Hanya baris 7 yang fully-blank.
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows[0]?.ppid).toBe("53JCUM03019BGRLM");
    expect(parsed?.rows[0]?.namaLoket).toBe("LOKET BSB A");
    expect(parsed?.rows[0]?.totalFee).toBe(1507495);
    expect(parsed?.rows[1]?.ppid).toBe("12BSPA19011BDLMH");
    expect(parsed?.rows[1]?.namaLoket).toBe("12BSPA19011BDLMH");
    expect(parsed?.rows[1]?.totalFee).toBe(0);
    expect(parsed?.columns.fee).toBe("JUMLAH FEE");
    expect(parsed?.audit.allZero).toBe(false);
  });

  it("fallback ke idx 189 bila 191 kosong/tak-valid", () => {
    const matrix = loketBsbMatrix();
    withFeeMatrixValue(matrix, 5, 189, 2000000);
    withFeeMatrixValue(matrix, 5, 191, "");
    const parsed = parseLoketBsbRows(matrix, "2026-08", "bsb");
    expect(parsed?.rows[0]?.totalFee).toBe(2000000);
    expect(parsed?.columns.fee).toBe("JUMLAH FEE BULAN INI");
  });

  it("prioritas 191 menang bila berisi data (walau 189 juga ada)", () => {
    const matrix = loketBsbMatrix();
    withFeeMatrixValue(matrix, 5, 189, 111);
    withFeeMatrixValue(matrix, 5, 191, 999000);
    const parsed = parseLoketBsbRows(matrix, "2026-08", "bsb");
    expect(parsed?.rows[0]?.totalFee).toBe(999000);
    expect(parsed?.columns.fee).toBe("JUMLAH FEE");
  });

  it("dropna PPID + data selalu dari indeks 5", () => {
    const matrix = loketBsbMatrix();
    (matrix[5] as unknown[])[1] = "53JCUM03019BGRLM";
    (matrix[5] as unknown[])[2] = "LOKET BSB A";
    withFeeMatrixValue(matrix, 5, 191, 100000);
    (matrix[3] as unknown[])[1] = "JUNK-ATAS";
    (matrix[6] as unknown[])[1] = "";
    (matrix[6] as unknown[])[2] = "";
    const parsed = parseLoketBsbRows(matrix, "2026-08", "bsb");
    expect(parsed?.rows).toHaveLength(1);
    expect(parsed?.rows[0]?.ppid).toBe("53JCUM03019BGRLM");
    // Baris metadata di atas data (indeks 3) diabaikan; baris kosong
    // interior (indeks 6) di-dropna dan terhitung skipped.
    expect(parsed?.skipped).toBe(1);
  });

  it("null bila sanity header gagal (fallback dinamis di pemanggil)", () => {
    const matrix = loketBsbMatrix();
    (matrix[2] as string[])[1] = "Nomor Urut";
    expect(parseLoketBsbRows(matrix, "2026-08", "bsb")).toBeNull();
  });

  it("pindah kolom tetap terjadi bila data hanya ada jauh di bawah", () => {
    // Regresi: bukti-data kolom fee dipindai SELURUH baris (dulu hanya
    // 20 pertama) agar nilai yang muncul di baris dalam tidak terlewat
    // dan berujung Rp-0 massal di kolom prioritas yang kosong.
    const blank = () => Array<string>(200).fill("");
    const header = blank();
    header[1] = "PPID";
    header[2] = "Nama Loket";
    header[189] = "JUMLAH FEE BULAN INI";
    header[191] = "JUMLAH FEE";
    const matrix: unknown[][] = [
      ["REKAP", ...blank().slice(1)],
      ["Periode", ...blank().slice(1)],
      header,
      ["", "SUBTOTAL", ...blank().slice(2)],
      ["", "", ...blank().slice(2)],
    ];
    for (let i = 0; i < 25; i += 1) {
      const r = blank();
      r[1] = `PPID-D${i}`;
      r[2] = `LOKET D${i}`;
      matrix.push(r);
    }
    const deep: unknown[] = blank();
    deep[1] = "PPID-DEEP";
    deep[2] = "LOKET DEEP";
    deep[189] = 777000;
    matrix.push(deep);
    const parsed = parseLoketBsbRows(matrix, "2026-08", "bsb");
    expect(parsed?.columns.fee).toBe("JUMLAH FEE BULAN INI");
    expect(parsed?.rows.find((r) => r.ppid === "PPID-DEEP")?.totalFee).toBe(777000);
  });
});

describe("buildFeeAgentProfile (profil virtual dari fee)", () => {
  it("found bila PPID ada di fee + ringkasan scope-aware", () => {
    const all = getSelectedLoketData(MOCK_FEE_DATA, "SBPOS-CKM-001", "SEMUA");
    const profile = buildFeeAgentProfile(all, "SEMUA");
    expect(profile).not.toBeNull();
    expect(profile?.ppid).toBe("SBPOS-CKM-001");
    expect(profile?.namaLoket).toBe("Agen Barokah Cikampek");
    expect(profile?.periods).toEqual(["2026-09"]);
    // Scope periode yang tidak cocok -> angka 0, identitas tetap ada.
    const scoped = buildFeeAgentProfile(all, "2026-08");
    expect(scoped?.ppid).toBe("SBPOS-CKM-001");
    expect(scoped?.totalFee).toBe(0);
    expect(scoped?.rowCount).toBe(0);
  });

  it("status agregat + nama dari baris bernama", () => {
    const rows = [
      { ...MOCK_FEE_DATA[2]!, periode: "2026-09", status: "PENDING" as const },
      { ...MOCK_FEE_DATA[2]!, id: "x", periode: "2026-08", status: "TERBAYAR" as const },
    ];
    const mixed = buildFeeAgentProfile(rows, "SEMUA");
    expect(mixed?.status).toBe("PENDING");
    expect(mixed?.totalFee).toBe(rows[0]!.totalFee + rows[1]!.totalFee);
    const paid = buildFeeAgentProfile([rows[1]!], "SEMUA");
    expect(paid?.status).toBe("TERBAYAR");
  });

  it("null bila tidak ada baris", () => {
    expect(buildFeeAgentProfile([], "SEMUA")).toBeNull();
  });
});

describe("getSelectedLoketData + displayNamaLoket", () => {
  it("strict match case-insensitive + trim + filter periode", () => {
    const found = getSelectedLoketData(MOCK_FEE_DATA, " sbpos-ckm-001 ");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.ppid).toBe("SBPOS-CKM-001");
    expect(getSelectedLoketData(MOCK_FEE_DATA, "SBPOS-CKM-001", "2026-08")).toHaveLength(0);
    expect(getSelectedLoketData(MOCK_FEE_DATA, "")).toHaveLength(0);
    expect(getSelectedLoketData(MOCK_FEE_DATA, null)).toHaveLength(0);
  });

  it("fallback nama ke PPID bila kosong", () => {
    expect(displayNamaLoket({ namaLoket: "", ppid: "P1" })).toBe("P1");
    expect(displayNamaLoket({ namaLoket: "  ", ppid: "P1" })).toBe("P1");
    expect(displayNamaLoket({ namaLoket: "Agen X", ppid: "P1" })).toBe("Agen X");
  });

  it("hyphen-insensitive: hubung di satu sisi tetap cocok", () => {
    const rows = MOCK_FEE_DATA.map((r) =>
      r.ppid === "SBPOS-CKM-001" ? { ...r, ppid: "SBPOSCKM001" } : r
    );
    // Query berhubung vs DB tanpa hubung.
    expect(getSelectedLoketData(rows, "SBPOS-CKM-001", "SEMUA")[0]?.ppid).toBe(
      "SBPOSCKM001"
    );
    // Query tanpa hubung + lowercase + spasi vs DB berhubung.
    expect(
      getSelectedLoketData(MOCK_FEE_DATA, " sbposckm001 ", "SEMUA")[0]?.ppid
    ).toBe("SBPOS-CKM-001");
    // Kode solicitous dua arah hyphen.
    expect(
      getSelectedLoketData(MOCK_FEE_DATA, "53BSPA23075BDGWN", "SEMUA")
    ).toHaveLength(0); // tidak ada di mock -> tetap 0, bukan error
  });

  it("ppidFuzzyPattern: pola ilike hyphen-insensitive", () => {
    expect(ppidFuzzyPattern("SBPOS-CKM-001")).toBe(
      "%S%B%P%O%S%C%K%M%0%0%1%"
    );
    // Query tanpa hubung menghasilkan pola yang cocok untuk DB
    // berhubung maupun tidak (huruf berurutan, % menelan "-").
    expect(ppidFuzzyPattern("sbposckm001")).toBe(
      "%S%B%P%O%S%C%K%M%0%0%1%"
    );
    expect(ppidFuzzyPattern("")).toBeNull();
    expect(ppidFuzzyPattern("   ")).toBeNull();
  });
});

describe("normalisasi PPID kanonis (anti 'tidak ditemukan')", () => {
  it("normalizePpid membuang invisible + spasi + uppercase", () => {
    expect(normalizePpid("12bspa19010bdlmh")).toBe("12BSPA19010BDLMH");
    expect(normalizePpid("  SBPOS-CKM-001 ")).toBe("SBPOS-CKM-001");
    // NBSP / zero-width di tengah kode ikut dibuang (bukan jadi spasi).
    expect(normalizePpid("12BSPA 19010")).toBe("12BSPA19010");
    expect(normalizePpid("12BSPA​19010")).toBe("12BSPA19010");
    expect(normalizePpid(" SBPOS-CKM-001 ")).toBe("SBPOS-CKM-001");
    expect(normalizePpid(null)).toBe("");
    expect(normalizePpid(undefined)).toBe("");
  });

  it("filterFeeRows cocok walau data ber-NBSP dan query normal", () => {
    const rows = [
      ...MOCK_FEE_DATA.slice(0, 1),
      {
        ...MOCK_FEE_DATA[0]!,
        id: "nbsp-1",
        // NBSP di sekeliling kode (khas sel Excel) — kanonisnya sama
        // dengan baris mock ber-hyphen di atas.
        ppid: " SBPOS-CKM-001 ",
        namaLoket: "Agen NBSP",
      },
    ];
    // Query normal tanpa spasi/NBSP tetap menemukan keduanya.
    expect(filterFeeRows(rows, "sbpos-ckm-001", "")).toHaveLength(2);
    expect(filterFeeRows(rows, "sbpos ckm 001", "")).toHaveLength(2);
  });

  it("escapeFeeLike mempertahankan underscore sebagai literal", () => {
    expect(escapeFeeLike("AGEN_001")).toBe("AGEN\\_001");
    expect(escapeFeeLike("100%")).toBe("100\\%");
    // Koma/parens pemecah sintaks or() tetap dibuang.
    expect(escapeFeeLike("a,b(c)")).toBe("a b c");
  });

  it("canonicalFeeSearch: ppid kanonis + nama longgar", () => {
    expect(canonicalFeeSearch(" sbpos-ckm-001 ")).toEqual({
      ppid: "SBPOS-CKM-001",
      nama: "sbpos-ckm-001",
    });
    expect(canonicalFeeSearch("AGEN_001")).toMatchObject({
      ppid: "AGEN\\_001",
    });
    expect(canonicalFeeSearch("")).toEqual({ ppid: "", nama: "" });
    expect(canonicalFeeSearch(null)).toEqual({ ppid: "", nama: "" });
  });
});

describe("toFeeDbRow (mapping upsert anti Rp-0)", () => {
  it("PPID dikanonisasi + periode otoritatif + total_fee defensif", () => {
    const row = toFeeDbRow(
      {
        ppid: " 53jcum03019bgrlm ",
        nama_loket: "Loket BSB",
        periode: "2026-07",
        total_fee: 6100,
        status: "TERBAYAR",
        rincian: [{ label: "Jumlah Fee", nilai: 6100 }],
      },
      "2026-08"
    );
    expect(row).not.toBeNull();
    // NBSP/spasi/case dibersihkan; periode BARIS diabaikan demi
    // periode deklarasi agar simpan/verifikasi/log konsisten.
    expect(row).toMatchObject({
      ppid: "53JCUM03019BGRLM",
      periode: "2026-08",
      total_fee: 6100,
      status: "TERBAYAR",
    });
    expect(row?.rawTotal).toBe(6100);
    expect(row?.clamped).toBe(false);
  });

  it("menerima camelCase totalFee/namaLoket (anti mapping-loss)", () => {
    const row = toFeeDbRow(
      { ppid: "P1", namaLoket: "Loket 1", totalFee: 6100 } as never,
      "2026-08"
    );
    expect(row).toMatchObject({
      ppid: "P1",
      nama_loket: "Loket 1",
      total_fee: 6100,
    });
  });

  it("PPID kosong -> null; fallback periode tak-valid -> null", () => {
    expect(toFeeDbRow({ ppid: "  ", total_fee: 100 }, "2026-08")).toBeNull();
    expect(toFeeDbRow({ ppid: "P1", total_fee: 100 }, "Agustus")).toBeNull();
  });

  it("negatif di-clamp + flag, bukan hilang diam", () => {
    const row = toFeeDbRow({ ppid: "P1", total_fee: -5000 }, "2026-08");
    expect(row).toMatchObject({ total_fee: 0 });
    expect(row?.rawTotal).toBe(-5000);
    expect(row?.clamped).toBe(true);
    expect(
      row?.rincian.some((d) => d.label.includes("OVER_DEDUCTED_CLAMPED"))
    ).toBe(true);
  });
});

describe("saveFeeImport chunked", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeRows(n: number): FeeRekapRow[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `r-${i}`,
      ppid: `PPID-${i}`,
      namaLoket: `Loket ${i}`,
      periode: "2026-09",
      totalFee: 1000,
      status: "PENDING" as const,
      rincian: [],
      updatedAt: "",
    }));
  }

  function mockFetchOk(upsertedPerCall: number[]) {
    const calls: unknown[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        calls.push(
          init?.body ? JSON.parse(String(init.body)) : null
        );
        const upserted = upsertedPerCall[n] ?? 0;
        n += 1;
        return {
          ok: true,
          json: async () => ({ upserted, periode: "2026-09" }),
        };
      })
    );
    return calls;
  }

  it("1200 baris dikirim sebagai 3 chunk + progress + totalRows", async () => {
    const calls = mockFetchOk([500, 500, 200]);
    const progress: { done: number; total: number }[] = [];
    const result = await saveFeeImport(
      { rows: makeRows(1200), fileName: "besar.xlsx", periode: "2026-09" },
      (p) => progress.push({ done: p.done, total: p.total })
    );
    expect(result).toMatchObject({ upserted: 1200, periode: "2026-09" });
    expect(calls).toHaveLength(3);
    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    const bodies = calls as {
      rows: unknown[];
      totalRows: number;
      chunk: { index: number; total: number };
    }[];
    expect(bodies[0]?.rows).toHaveLength(IMPORT_CHUNK_SIZE);
    expect(bodies[2]?.rows).toHaveLength(200);
    // Chunk terakhir menandai penulisan log di server.
    expect(bodies[2]?.chunk).toEqual({ index: 2, total: 3 });
    expect(bodies[2]?.totalRows).toBe(1200);
  });

  it("impor kecil tetap 1 request", async () => {
    const calls = mockFetchOk([2]);
    const result = await saveFeeImport({
      rows: makeRows(2),
      fileName: "kecil.xlsx",
      periode: "2026-09",
    });
    expect(result.upserted).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it("gagal di tengah jalan menyertakan posisi batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "DB down" }),
      }))
    );
    await expect(
      saveFeeImport({ rows: makeRows(600), fileName: "x.xlsx", periode: "2026-09" })
    ).rejects.toThrow(/batch 1\/2/);
  });

  it("retry chunk 5xx/429 hingga 3x lalu sukses (idempoten, tanpa duplikat hitung)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls <= 2) {
          return { ok: false, status: 503, json: async () => ({ error: "sibuk" }) };
        }
        return {
          ok: true,
          json: async () => ({
            upserted: 2,
            periode: "2026-09",
            receivedSum: 0,
            storedSum: 0,
            zeroRows: 0,
            profilesUpserted: 0,
            detailsUpserted: 0,
          }),
        };
      })
    );
    const result = await saveFeeImport({
      rows: makeRows(2),
      fileName: "retry.xlsx",
      periode: "2026-09",
    });
    expect(result.upserted).toBe(2);
    expect(calls).toBe(3);
  });

  it("error 4xx TIDAK di-retry (langsung throw 1x panggil)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return { ok: false, status: 400, json: async () => ({ error: "rows invalid" }) };
      })
    );
    await expect(
      saveFeeImport({ rows: makeRows(2), fileName: "bad.xlsx", periode: "2026-09" })
    ).rejects.toThrow(/rows invalid/);
    expect(calls).toBe(1);
  });

  it("jaringan putus 3x -> throw dengan saran simpan ulang", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    await expect(
      saveFeeImport({ rows: makeRows(2), fileName: "net.xlsx", periode: "2026-09" })
    ).rejects.toThrow(/simpan ulang/);
  });

  it("tabular masif: 500 baris + selingan kosong + ekor kosong tak ada yang hilang", () => {
    const header = ["NO", "PPID", "NAMA LOKET", "JUMLAH FEE"];
    const matrix: unknown[][] = [header];
    const want: string[] = [];
    for (let i = 0; i < 500; i += 1) {
      const ppid = `PP${String(i).padStart(4, "0")}`;
      want.push(ppid);
      matrix.push([i + 1, ppid, `Loket ${i}`, 100000 + i]);
      if (i % 50 === 0) matrix.push(["", "", "", ""]);
    }
    matrix.push(["", "", "", ""], []);
    const parsed = parseFeeRowsFromAOA(matrix, "2026-09", "masif");
    const got = new Set(parsed.rows.map((r) => r.ppid));
    expect(got.size).toBe(500);
    for (const ppid of want) expect(got.has(ppid)).toBe(true);
  });
});

describe("runBatchesIsolated", () => {
  it("sukses penuh lintas batch konkuren: semua terhitung tepat sekali", async () => {
    const seen: string[][] = [];
    const out = await runBatchesIsolated(
      Array.from({ length: 10 }, (_, i) => `P${i}`),
      {
        batchSize: 3,
        concurrency: 4,
        table: "t",
        keyOf: (r) => r,
        upsertBatch: async (batch) => {
          seen.push([...batch]);
        },
        upsertOne: async () => {},
        issues: [],
      }
    );
    expect(out).toEqual({ succeeded: 10, failedIds: [] });
    expect(seen.flat().sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `P${i}`).sort()
    );
  });

  it("batch gagal 2x -> fallback per baris mengisolasi baris busuk", async () => {
    const issues: { batch: number; table: string; message: string }[] = [];
    const oneCalls: string[] = [];
    const out = await runBatchesIsolated(["A", "BAD", "C"], {
      batchSize: 3,
      concurrency: 1,
      table: "fee_loket",
      keyOf: (r) => r,
      upsertBatch: async (batch) => {
        if (batch.includes("BAD")) throw new Error("constraint boom");
      },
      upsertOne: async (row) => {
        oneCalls.push(row);
        if (row === "BAD") throw new Error("constraint boom");
      },
      issues,
    });
    expect(out.succeeded).toBe(2);
    expect(out.failedIds).toEqual(["BAD"]);
    expect(oneCalls.sort()).toEqual(["A", "BAD", "C"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ batch: 1, table: "fee_loket" });
  });

  it("transien (gagal 1x) sembuh via retry tanpa fallback baris", async () => {
    let batchCalls = 0;
    let oneCalls = 0;
    const out = await runBatchesIsolated(["A", "B"], {
      batchSize: 2,
      concurrency: 2,
      table: "t",
      keyOf: (r) => r,
      upsertBatch: async () => {
        batchCalls += 1;
        if (batchCalls === 1) throw new Error("timeout transien");
      },
      upsertOne: async () => {
        oneCalls += 1;
      },
      issues: [],
    });
    expect(out).toEqual({ succeeded: 2, failedIds: [] });
    expect(batchCalls).toBe(2);
    expect(oneCalls).toBe(0);
  });

  it("kosong: tanpa panggilan, tanpa isu", async () => {
    let calls = 0;
    const out = await runBatchesIsolated([], {
      table: "t",
      keyOf: (r: string) => r,
      upsertBatch: async () => {
        calls += 1;
      },
      upsertOne: async () => {
        calls += 1;
      },
      issues: [],
    });
    expect(out).toEqual({ succeeded: 0, failedIds: [] });
    expect(calls).toBe(0);
  });
});

describe("verifyFeeImport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sukses: teruskan found/missing dari server", async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body?: string }) => {
        seen.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          json: async () => ({
            success: true,
            periode: "2026-09",
            total: 3,
            found: 2,
            missingCount: 1,
            missing: ["PP3"],
          }),
        };
      })
    );
    const result = await verifyFeeImport(["PP1", "PP2", "PP3"], "2026-09");
    expect(result).toMatchObject({ total: 3, found: 2, missingCount: 1 });
    expect(result.missing).toEqual(["PP3"]);
    expect(seen[0]).toMatchObject({ periode: "2026-09" });
  });

  it("respons tak valid / gagal -> throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ aneh: 1 }) }))
    );
    await expect(verifyFeeImport(["PP1"], "2026-09")).rejects.toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "x" }) }))
    );
    await expect(verifyFeeImport(["PP1"], "2026-09")).rejects.toThrow();
  });
});

describe("fetchFeeList truncated", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockListOk(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => body,
      }))
    );
  }

  it("meneruskan flag truncated + total dari server", async () => {
    mockListOk({
      data: [],
      total: 2500,
      page: 1,
      pageSize: 2000,
      totalPages: 2,
      truncated: true,
      periods: ["2026-09"],
      summary: { totalLoket: 2500, totalTerbayarAktif: 1000, latestPeriode: "2026-09" },
    });
    const result = await fetchFeeList({ pageSize: 2000 });
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(2500);
  });

  it("fallback lokal bila server lama tanpa flag truncated", async () => {
    mockListOk({
      data: [],
      total: 5,
      page: 1,
      pageSize: 2000,
      totalPages: 1,
      periods: [],
      summary: { totalLoket: 0, totalTerbayarAktif: 0, latestPeriode: "" },
    });
    const result = await fetchFeeList({ pageSize: 2000 });
    // 0 baris < total 5 -> terpotong.
    expect(result.truncated).toBe(true);
  });
});

describe("deleteFeeRows", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mengirim DELETE {ids} dan mengembalikan jumlah", async () => {
    const seen: { url: unknown; init: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: unknown) => {
        seen.push({ url, init });
        return { ok: true, json: async () => ({ deleted: 1 }) };
      })
    );
    const result = await deleteFeeRows(["  uuid-1 ", "uuid-1"]);
    expect(result).toEqual({ deleted: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("/api/fee-rekap");
    const init = seen[0]?.init as { method: string; body: string };
    expect(init.method).toBe("DELETE");
    // trim + dedup sebelum dikirim
    expect(JSON.parse(init.body)).toEqual({ ids: ["uuid-1"] });
  });

  it("menolak ids kosong dan melebihi batas", async () => {
    await expect(deleteFeeRows([])).rejects.toThrow(/wajib diisi/);
    await expect(deleteFeeRows(["  "])).rejects.toThrow(/wajib diisi/);
    await expect(
      deleteFeeRows(Array.from({ length: FEE_DELETE_MAX_IDS + 1 }, (_, i) => `id-${i}`))
    ).rejects.toThrow(/Maksimal/);
  });

  it("meneruskan pesan error server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Hanya ADMIN" }),
      }))
    );
    await expect(deleteFeeRows(["x"])).rejects.toThrow("Hanya ADMIN");
  });
});

describe("Excel Master: Loket BSB penuh + sheet Cari", () => {
  /** Matriks 209 kolom ala Loket BSB: header idx 2, serial tgl idx 3, data idx 5. */
  function masterMatrix(): unknown[][] {
    const blank = () => Array<unknown>(209).fill("");
    const header = blank();
    header[1] = "PPID";
    header[2] = "Nama Loket";
    header[3] = "BANK";
    header[4] = "No.Rekening";
    // Baris serial tanggal (Excel row 4 = I5:I8 sheet Cari).
    const dates = blank();
    dates[198] = 46268; // 3-Sep-2026
    dates[200] = 46273; // 8-Sep-2026
    return [
      ["NOMOR KOLOM", ...blank().slice(1)],
      ["DATA LOKET", ...blank().slice(1)],
      header,
      dates,
      ["AGREGAT", ...blank().slice(1)],
      (() => {
        const r = blank();
        r[1] = "53JCUM03186MJKSM";
        r[2] = "Sangkan Makmur";
        r[3] = "BRI";
        r[4] = "412401000623501";
        r[5] = "MAMAT JAMALUDIN";
        r[6] = "Cum Onpays Cirebon";
        r[7] = "CUM - JABAR";
        r[82] = 56; // LEMBAR PLN Postpaid
        r[161] = 114800; // TOTAL PLN Postpaid (56 x 2050)
        r[189] = 114800; // JUMLAH FEE BULAN INI
        r[191] = 114800; // JUMLAH FEE
        r[196] = 114800; // Fee Siap Transfer
        r[199] = 114800; // Transfer ke Rekening
        r[206] = 114800; // Total Transfer
        return r;
      })(),
      // Baris kosong interior (di-dropna + dihitung skipped; ekor kosong
      // dipangkas trimTrailingEmptyRows sehingga tidak ikut dihitung).
      ["", ...Array<unknown>(208).fill("")],
      (() => {
        const r = blank();
        r[1] = "53JCUM03019BGRLM";
        r[2] = "LUKMAN";
        r[190] = 6100; // FEE BULAN SEBELUMNYA
        r[191] = 6100; // JUMLAH FEE
        r[193] = 6100; // HOLD
        return r;
      })(),
      ["", ...blank().slice(1)],
    ];
  }

  it("CARI_MODULE_MAP: 79 modul unik (duplikat XL/WOM didisambiguasi)", () => {
    expect(CARI_MODULE_MAP).toHaveLength(79);
    const names = CARI_MODULE_MAP.map((m) => m.modul);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("PLN Postpaid");
    expect(names).toContain("XL (2)");
    expect(names).toContain("WOM FINANCE (2)");
    expect(names).toContain("MINI ATM BERSAMA");
  });

  it("deriveLoketStatus: Total Transfer > 0 -> TERBAYAR", () => {
    expect(deriveLoketStatus(114800)).toBe("TERBAYAR");
    expect(deriveLoketStatus(0)).toBe("PENDING");
    expect(deriveLoketStatus(-5)).toBe("PENDING");
  });

  it("buildModuleBreakdown: pola (a) total tersimpan -> fee turunan", () => {
    const cells: unknown[] = Array(210).fill("");
    cells[82] = 56;
    cells[161] = 114800;
    expect(
      buildModuleBreakdown(cells, {
        modul: "PLN Postpaid",
        tarifCol: null,
        lembarCol: 82,
        totalCol: 161,
      })
    ).toEqual({ modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 });
  });

  it("buildModuleBreakdown: pola (b) tarif x lembar -> total", () => {
    const cells: unknown[] = Array(210).fill("");
    cells[15] = 1000; // tarif INDOVISION
    cells[88] = 3; // lembar
    expect(
      buildModuleBreakdown(cells, {
        modul: "INDOVISION",
        tarifCol: 15,
        lembarCol: 88,
        totalCol: null,
      })
    ).toEqual({ modul: "INDOVISION", lembar: 3, feePerLembar: 1000, total: 3000 });
  });

  it("buildModuleBreakdown: tarif-nol tanpa lembar dibuang (sparse)", () => {
    // Tarif skema tersimpan per loket walau LEMBAR 0 — bukan aktivitas,
    // wajib null agar details 10rb loket tidak meledak ±700rb baris.
    const cells: unknown[] = Array(210).fill("");
    cells[15] = 1000;
    cells[88] = 0;
    expect(
      buildModuleBreakdown(cells, {
        modul: "INDOVISION",
        tarifCol: 15,
        lembarCol: 88,
        totalCol: null,
      })
    ).toBeNull();
  });

  it("buildModuleBreakdown: pola (c) agregat PDAM + sparse null", () => {
    const cells: unknown[] = Array(210).fill("");
    cells[121] = 2;
    cells[123] = 1;
    cells[180] = 9000;
    expect(
      buildModuleBreakdown(cells, {
        modul: "PDAM",
        tarifCol: null,
        lembarCol: null,
        lembarSumCols: [121, 122, 123],
        totalCol: 180,
      })
    ).toEqual({ modul: "PDAM", lembar: 3, feePerLembar: 3000, total: 9000 });
    expect(
      buildModuleBreakdown(Array(210).fill(""), {
        modul: "PBB",
        tarifCol: null,
        lembarCol: null,
        lembarSumCols: [124],
        totalCol: 181,
      })
    ).toBeNull();
  });

  it("buildFullModuleBreakdown: katalog penuh + nol untuk yang non-aktif", () => {
    const full = buildFullModuleBreakdown([
      { modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 },
      { modul: "PBB", lembar: 3, feePerLembar: 3000, total: 9000 },
    ]);
    // Panjang = katalog kanonis, urutan mengikuti parser `Cari`.
    expect(full).toHaveLength(CARI_MODULE_MAP.length);
    expect(full.map((d) => d.modul)).toEqual(
      CARI_MODULE_MAP.map((m) => m.modul)
    );
    // Modul kunci (PLN, Jastel, leasing, PBB, Fee Pos/Sicepat) wajib ada.
    for (const name of [
      "PLN Postpaid",
      "PLN Prepaid",
      "PLN Nontaglis",
      "JASTEL",
      "INDOVISION",
      "FIF",
      "WOM FINANCE",
      "ADIRA",
      "PBB",
      "FEE LOKET POS",
      "FEE LOKET SICEPAT NETT",
    ]) {
      expect(full.map((d) => d.modul)).toContain(name);
    }
    // Nilai aktif dipertahankan, non-aktif diisi nol.
    expect(
      full.find((d) => d.modul === "PLN Postpaid")
    ).toEqual({ modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 });
    expect(full.find((d) => d.modul === "JASTEL")).toEqual({
      modul: "JASTEL",
      lembar: 0,
      feePerLembar: 0,
      total: 0,
    });
    // Total tidak berubah (nol tidak menambah).
    expect(full.reduce((s, d) => s + d.total, 0)).toBe(114800 + 9000);
  });

  it("buildFullModuleBreakdown: kosong -> seluruh katalog nol; nama asing di ekor", () => {
    const full = buildFullModuleBreakdown([]);
    expect(full).toHaveLength(CARI_MODULE_MAP.length);
    expect(full.every((d) => d.lembar === 0 && d.total === 0)).toBe(true);
    const withExtra = buildFullModuleBreakdown([
      { modul: "MODUL LAMA", lembar: 1, feePerLembar: 500, total: 500 },
    ]);
    expect(withExtra).toHaveLength(CARI_MODULE_MAP.length + 1);
    expect(withExtra[withExtra.length - 1]?.modul).toBe("MODUL LAMA");
  });

  it("buildRincianText: TSV header + baris + TOTAL", () => {
    const text = buildRincianText([
      { modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 },
      { modul: "JASTEL", lembar: 0, feePerLembar: 0, total: 0 },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("MODUL\tLEMBAR\tFEE / LEMBAR\tTOTAL FEE");
    expect(lines).toContain("PLN Postpaid\t56\t2050\t114800");
    expect(lines).toContain("JASTEL\t0\t0\t0");
    expect(lines[lines.length - 1]).toBe("TOTAL\t56\t\t114800");
  });

  // Fixture meniru sheet `Cari` asli: blok form kiri (C=label, D=":",
  // E=nilai) + tabel modul (K-N). Indeks 0-based: label col 2,
  // nilai col 4, modul col 10-13.
  function cariMatrix(ppid: string): unknown[][] {
    const blank = (): unknown[] => Array(20).fill("");
    const m: unknown[][] = [blank(), blank(), blank()];
    m.push(["", "", "", "", "", "", "", "", "", "", "MODUL", "LEMBAR", "FEE / LEMBAR", "TOTAL FEE", "", "", "", "", "", ""]);
    m.push(["", "", "", "", "", "", "", "", "", "", "PLN Postpaid", 56, 2050, 114800, "", "", "", "", "", ""]);
    m.push(["", "", "PPID", ":", ppid, "", "", "", "", "", "PLN Prepaid", 0, 0, 0, "", "", "", "", "", ""]);
    m.push(["", "", "Nama Loket", ":", "Kios Berkah", "", "", "", "", "", "PBB", 3, 3000, 9000, "", "", "", "", "", ""]);
    m.push(["", "", "Nomor Rekening", ":", "12345", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Rekening BANK", ":", "BANK X", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Pemilik Rekening", ":", "Budi", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Fee Bulan Ini", ":", 1000000, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Fee Bulan Sebelumnya", ":", 200000, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Subsidi Antar Loket", ":", 50000, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Minus Loket", ":", 10000, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Status Fee", ":", "Belum di Transfer", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Fee ke Deposit", ":", 0, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Fee di Transfer ke Rek.", ":", 0, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "Fee Siap Transfer", ":", 1240000, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    return m;
  }

  it("isCariSheetMatrix: form Cari vs tabel generik", () => {
    expect(isCariSheetMatrix(cariMatrix("SBPOS-CKM-001"))).toBe(true);
    expect(
      isCariSheetMatrix([
        ["PPID", "NAMA LOKET", "TOTAL FEE"],
        ["X1", "Kios", 100],
      ])
    ).toBe(false);
    expect(isCariSheetMatrix([])).toBe(false);
  });

  it("parseCariSheet: profil + rincian Master dari form terisi", () => {
    const parsed = parseCariSheet(cariMatrix("sbpos-ckm-001"), "2026-08", "f");
    expect(parsed).not.toBeNull();
    const row = parsed!.row;
    expect(row.ppid).toBe("SBPOS-CKM-001");
    expect(row.periode).toBe("2026-08");
    expect(row.totalFee).toBe(1250000);
    expect(row.profil?.namaLoket).toBe("Kios Berkah");
    expect(row.profil?.noRekening).toBe("12345");
    expect(row.profil?.feeSiapTransfer).toBe(1240000);
    // Rincian sparse: modul nol dibuang, aktif dipertahankan.
    expect(row.profil?.details).toEqual([
      { modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 },
      { modul: "PBB", lembar: 3, feePerLembar: 3000, total: 9000 },
    ]);
  });

  it("parseCariSheet: template kosong (PPID kosong) -> null, bukan error", () => {
    expect(parseCariSheet(cariMatrix(""), "2026-08", "f")).toBeNull();
    expect(parseCariSheet(cariMatrix("   "), "2026-08", "f")).toBeNull();
  });

  it("parseCariSheet: input E3 (Masukan PPID) dibaca bila E6 kosong", () => {
    const m = cariMatrix("");
    m[2] = ["", "", "Masukan PPID / Kode", ":", "SBPOS-PWK-027"];
    const parsed = parseCariSheet(m, "2026-09", "h");
    expect(parsed).not.toBeNull();
    expect(parsed!.row.ppid).toBe("SBPOS-PWK-027");
  });

  it("parseCariSheet: E3 kosong tidak menutupi E6 yang terisi", () => {
    const m = cariMatrix("SBPOS-CKM-001");
    m[2] = ["", "", "Masukan PPID / Kode", ":", ""];
    const parsed = parseCariSheet(m, "2026-08", "h");
    expect(parsed).not.toBeNull();
    expect(parsed!.row.ppid).toBe("SBPOS-CKM-001");
  });

  it("kunci query stabil untuk PPID solicit (53BSPA09884JBKTK)", () => {
    // Regresi: PPID dari sheet Cari harus dinormalisasi identik di
    // sisi impor (normalizePpid) dan sisi query (canonicalFeeSearch)
    // agar lookup exact menemukan baris tersimpan.
    expect(normalizePpid(" 53bspa09884jbktk ")).toBe("53BSPA09884JBKTK");
    const q = canonicalFeeSearch("53bspa09884jbktk");
    expect(q.ppid).toBe(normalizePpid("53BSPA09884JBKTK"));
    expect(q.ppid).not.toBe("");
  });

  it("parseCariSheet: varian posisi (PPID di E4, tabel modul bergeser)", () => {
    // Varian: label PPID di baris indeks 3 (sel input E4), tabel modul
    // di kolom H-K (indeks 7-10) — parser wajib resolusi dari label.
    const blank = (): unknown[] => Array(20).fill("");
    const m: unknown[][] = [blank(), blank(), blank()];
    m.push(["", "", "PPID", ":", "SBPOS-PWK-027"]);
    m.push(["", "", "Nama Loket", ":", "Loket Maju Jaya"]);
    m.push(["", "", "", "", "", "", "", "MODUL", "LEMBAR", "FEE/LEMBAR", "TOTAL FEE"]);
    m.push(["", "", "Fee Bulan Ini", ":", 2100750, "", "", "PLN Postpaid", 10, 2000, 20000]);
    m.push(["", "", "Fee Bulan Sebelumnya", ":", 0, "", "", "PBB", 0, 0, 0]);
    m.push(["", "", "Keterangan", ":", "lunas", "", "", "", "", "", ""]);
    m.push(["", "", "", "", "", "", "", "", "", "", ""]);
    m.push(["", "", "", "", "", "", "", "FIF", 2, 1500, 3000]);
    expect(isCariSheetMatrix(m)).toBe(true);
    const parsed = parseCariSheet(m, "2026-09", "g");
    expect(parsed).not.toBeNull();
    expect(parsed!.row.ppid).toBe("SBPOS-PWK-027");
    expect(parsed!.row.totalFee).toBe(2100750);
    expect(parsed!.row.profil?.details).toEqual([
      { modul: "PLN Postpaid", lembar: 10, feePerLembar: 2000, total: 20000 },
      { modul: "FIF", lembar: 2, feePerLembar: 1500, total: 3000 },
    ]);
  });

  it("e2e Cari: form terisi -> body saveFeeImport memuat profil+rincian -> baris DB utuh", async () => {
    const parsed = parseCariSheet(cariMatrix("SBPOS-CKM-001"), "2026-08", "e2e");
    expect(parsed).not.toBeNull();
    const bodies: { rows: Record<string, unknown>[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : { rows: [] });
        return {
          ok: true,
          json: async () => ({
            upserted: 1,
            periode: "2026-08",
            receivedSum: 0,
            storedSum: 0,
            zeroRows: 0,
            profilesUpserted: 1,
            detailsUpserted: 2,
          }),
        };
      })
    );
    try {
      const result = await saveFeeImport(
        { rows: [parsed!.row], fileName: "cari.xlsx", periode: "2026-08" }
      );
      expect(result.upserted).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
    // 1) Payload client membawa profil + rincian (bukan legacy polos).
    const sent = bodies[0]?.rows[0] as unknown as Record<string, unknown>;
    expect(sent).toMatchObject({ ppid: "SBPOS-CKM-001" });
    expect(sent).toHaveProperty("profil");
    expect(sent.details).toHaveLength(2);
    // 2) Mapping server menghasilkan baris DB fee + profil + details utuh.
    expect(toFeeDbRow(sent, "2026-08")).not.toBeNull();
    const dbProfil = normalizeImportProfil(sent, "2026-08");
    expect(dbProfil?.profil).toMatchObject({
      ppid: "SBPOS-CKM-001",
      periode: "2026-08",
    });
    expect(
      dbProfil?.details.map((d) => d.modul_nama).sort()
    ).toEqual(["PBB", "PLN Postpaid"]);
  });

  it("isPpidLike: kode PPID vs header/nominal/tanggal", () => {
    expect(isPpidLike("SBPOS-CKM-001")).toBe(true);
    expect(isPpidLike("53BSPA09884JBKTK")).toBe(true);
    expect(isPpidLike("12BSPA19010BDLMH")).toBe(true);
    expect(isPpidLike("PPID")).toBe(false);
    expect(isPpidLike("MODUL")).toBe(false);
    expect(isPpidLike("114800")).toBe(false);
    expect(isPpidLike("2026-09-22")).toBe(false);
    expect(isPpidLike("XL (2)")).toBe(false);
    expect(isPpidLike("")).toBe(false);
    expect(isPpidLike(null)).toBe(false);
  });

  it("parseUniversalFeeRows: tanpa header, baris PPID terekstrak, sampah tidak", () => {
    const matrix: unknown[][] = [
      ["DATA LOKET WILAYAH TIMUR"],
      ["53BSPA09884JBKTK", "Kios Berkah Jaya", 1250000],
      ["SBPOS-CKM-001", 750000, "Agen Barokah"],
      ["KETERANGAN", "rekap penutup"],
      ["PPH 23 POS", 0, 0],
      ["NO", 1, 2],
      ["", "", ""],
    ];
    const { rows, skipped } = parseUniversalFeeRows(matrix, "2026-08", "u");
    expect(rows.map((r) => r.ppid).sort()).toEqual([
      "53BSPA09884JBKTK",
      "SBPOS-CKM-001",
    ]);
    expect(rows[0]).toMatchObject({ namaLoket: "Kios Berkah Jaya", totalFee: 1250000 });
    expect(rows[1]).toMatchObject({ namaLoket: "Agen Barokah", totalFee: 750000 });
    // PPH tanpa nominal + baris nomor/tanggal/kosong dilewati.
    expect(skipped).toBe(1);
    expect(rows.every((r) => r.periode === "2026-08")).toBe(true);
  });

  it("isNontrivialFullParse: guard generalisasi tabular massal", () => {
    expect(isNontrivialFullParse(null)).toBe(false);
    expect(
      isNontrivialFullParse({ profiles: [], rows: [], skipped: 0 })
    ).toBe(false);
    // Rp-0 massal tanpa rincian -> tolak (lanjut dinamis).
    expect(
      isNontrivialFullParse({
        profiles: [],
        rows: [
          {
            id: "x-1",
            ppid: "PP1",
            namaLoket: "L1",
            periode: "2026-08",
            totalFee: 0,
            status: "PENDING" as const,
            rincian: [],
            updatedAt: "",
          },
        ],
        skipped: 0,
      })
    ).toBe(false);
    // Fee non-nol ATAU rincian ada -> pakai jalur Master.
    const row = {
      id: "x-1",
      ppid: "PP1",
      namaLoket: "L1",
      periode: "2026-08",
      totalFee: 100,
      status: "PENDING" as const,
      rincian: [],
      updatedAt: "",
    };
    expect(
      isNontrivialFullParse({ profiles: [], rows: [row], skipped: 0 })
    ).toBe(true);
    expect(
      isNontrivialFullParse({
        profiles: [
          {
            ppid: "PP1",
            namaLoket: "L1",
            bank: "",
            noRekening: "",
            namaPemilik: "",
            rekomender: "",
            elektrikArea: "",
            periode: "2026-08",
            feeBulanIni: 0,
            feeBulanSebelumnya: 0,
            subsidiAntarLoket: 0,
            totalFee: 0,
            minus: 0,
            hold: 0,
            potonganLainnya: 0,
            potonganOngkir: 0,
            totalFeeTransfer: 0,
            feeKeDeposit: 0,
            feeTransferRekening: 0,
            sisaFee: 0,
            keterangan: "",
            tanggalTransfer: "",
            feeSiapTransfer: 0,
            statusPembayaran: "PENDING" as const,
            details: [{ modul: "PBB", lembar: 1, feePerLembar: 1, total: 1 }],
          },
        ],
        rows: [{ ...row, totalFee: 0 }],
        skipped: 0,
      })
    ).toBe(true);
  });

  it("parseLoketBsbFull: identitas + keuangan + rincian + status", () => {
    const parsed = parseLoketBsbFull(masterMatrix(), "2026-08", "master");
    expect(parsed).not.toBeNull();
    const profiles = parsed ? parsed.profiles : [];
    const rows = parsed ? parsed.rows : [];
    expect(profiles).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(parsed ? parsed.skipped : -1).toBe(1);
    const aktif = profiles[0] as LoketProfileFull;
    expect(aktif.ppid).toBe("53JCUM03186MJKSM");
    expect(aktif.bank).toBe("BRI");
    expect(aktif.noRekening).toBe("412401000623501");
    expect(aktif.feeBulanIni).toBe(114800);
    expect(aktif.feeSiapTransfer).toBe(114800);
    // Transfer ke Rek 114800, deposit 0 → TRANSFER_REKENING (J20 Excel).
    expect(aktif.statusPembayaran).toBe("TRANSFER_REKENING");
    expect(aktif.totalFee).toBe(114800);
    expect(aktif.totalFeeTransfer).toBe(114800);
    expect(aktif.feeTransferRekening).toBe(114800);
    expect(aktif.feeKeDeposit).toBe(0);
    expect(aktif.sisaFee).toBe(0);
    // Grup 1 (198+199) > 0 → serial idx3[198] = 46268 = 3-Sep-2026 (E27).
    expect(aktif.tanggalTransfer).toBe("3-Sep-2026");
    expect(aktif.details).toEqual([
      { modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 },
    ]);
    // Baris ringkas monitoring konsisten (JUMLAH FEE 191 + rincian Master).
    expect(rows[0]).toMatchObject({
      ppid: "53JCUM03186MJKSM",
      periode: "2026-08",
      totalFee: 114800,
      status: "TERBAYAR",
    });
    expect(rows[0]?.profil?.ppid).toBe("53JCUM03186MJKSM");
    const hold = profiles[1] as LoketProfileFull;
    expect(hold.hold).toBe(6100);
    expect(hold.feeSiapTransfer).toBe(0);
    expect(hold.statusPembayaran).toBe("BELUM_TRANSFER");
    expect(hold.totalFee).toBe(6100);
    // Tanpa aktivitas transfer + tanpa catatan kol 208 → "Belum di kirim".
    expect(hold.tanggalTransfer).toBe("Belum di kirim");
    expect(hold.details).toEqual([]);
    expect(rows[1]?.totalFee).toBe(6100);
  });

  it("parseLoketBsbFull: null bila header tak-valid (fallback dinamis)", () => {
    const matrix = masterMatrix();
    (matrix[2] as unknown[])[1] = "Nomor Urut";
    expect(parseLoketBsbFull(matrix, "2026-08", "master")).toBeNull();
  });

  it("toLoketProfileDbRow + toLoketDetailDbRows: kanonis + batas", () => {
    const profil: LoketProfileFull = {
      ppid: " 53jcum03186mjksm ",
      namaLoket: "Sangkan Makmur",
      bank: "BRI",
      noRekening: "4124",
      namaPemilik: "Mamat",
      rekomender: "CUM",
      elektrikArea: "JABAR",
      periode: "2026-07",
      feeBulanIni: 114800,
      feeBulanSebelumnya: 0,
      subsidiAntarLoket: 500,
      totalFee: 115300,
      minus: 0,
      hold: 0,
      potonganLainnya: 0,
      potonganOngkir: 200,
      totalFeeTransfer: 115100,
      feeKeDeposit: 0,
      feeTransferRekening: 115100,
      sisaFee: 0,
      keterangan: "OK",
      tanggalTransfer: "Transfer 05 Agustus 2026",
      feeSiapTransfer: 114800,
      statusPembayaran: "TRANSFER_REKENING",
      details: [
        { modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 },
        { modul: "PLN Postpaid", lembar: 1, feePerLembar: 1, total: 1 },
      ],
    };
    const row = toLoketProfileDbRow(profil, "2026-08");
    expect(row).toMatchObject({
      ppid: "53JCUM03186MJKSM",
      periode: "2026-08",
      fee_bulan_ini: 114800,
      subsidi_antar_loket: 500,
      total_fee: 115300,
      potongan_ongkir: 200,
      fee_transfer_rekening: 115100,
      keterangan: "OK",
      tanggal_transfer: "Transfer 05 Agustus 2026",
      status_pembayaran: "TRANSFER_REKENING",
    });
    // Dedup modul + periode otoritatif.
    const details = toLoketDetailDbRows(profil, "2026-08");
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      ppid: "53JCUM03186MJKSM",
      periode: "2026-08",
      modul_nama: "PLN Postpaid",
      jumlah_lembar: 56,
    });
    expect(toLoketProfileDbRow(profil, "Agustus")).toBeNull();
  });

  it("normalizeImportProfil: payload longgar -> baris DB", () => {
    const normalized = normalizeImportProfil(
      {
        ppid: "P1",
        periode: "2026-07",
        total_fee: 100,
        profil: {
          ppid: "p1",
          namaLoket: "Loket 1",
          feeBulanIni: 100,
          statusPembayaran: "PENDING",
        },
        details: [{ modul: "PLN Postpaid", lembar: 2, feePerLembar: 2050, total: 4100 }],
      },
      "2026-08"
    );
    expect(normalized?.profil).toMatchObject({ ppid: "P1", periode: "2026-08" });
    expect(normalized?.details).toHaveLength(1);
    expect(normalizeImportProfil({ ppid: "P1" }, "2026-08")).toBeNull();
  });

  it("multi-sheet: Master + Cari + dinamis + duplikat + kosong -> tak ada PPID valid hilang", () => {
    // Mensimulasikan gabungan preview lintas sheet (Loket BSB, Cari,
    // tabel dinamis) persis sebelum saveFeeImport + mapping API.
    const payload = [
      {
        ppid: "PP-BSB",
        namaLoket: "Loket BSB",
        periode: "2026-08",
        total_fee: 1000,
        status: "TERBAYAR",
        rincian: [],
        profil: { ppid: "PP-BSB", namaLoket: "Loket BSB", feeBulanIni: 1000 },
        details: [
          { modul: "PLN Postpaid", lembar: 2, feePerLembar: 2050, total: 4100 },
        ],
      },
      {
        ppid: "PP-CARI",
        namaLoket: "Loket Cari",
        periode: "2026-08",
        total_fee: 500,
        status: "PENDING",
        rincian: [],
        profil: { ppid: "PP-CARI", namaLoket: "Loket Cari", feeBulanIni: 500 },
        details: [{ modul: "PBB", lembar: 1, feePerLembar: 3000, total: 3000 }],
      },
      {
        ppid: "PP-DYN",
        namaLoket: "Loket Dinamis",
        periode: "2026-08",
        total_fee: 200,
        status: "PENDING",
        rincian: [],
      },
      { ppid: "pp-bsb", namaLoket: "Duplikat BSB", periode: "2026-08", total_fee: 1, status: "PENDING", rincian: [] },
      { ppid: "   ", namaLoket: "Tanpa PPID", periode: "2026-08", total_fee: 999, status: "PENDING", rincian: [] },
    ];
    // 1) toFeeDbRow: hanya baris tanpa-PPID yang null.
    const mapped = payload.map((r) => toFeeDbRow(r, "2026-08"));
    expect(mapped.filter(Boolean)).toHaveLength(4);
    // 2) Dedup gaya API (ppid||periode, terakhir menang).
    const byKey = new Map<string, unknown>();
    for (const m of mapped) {
      if (!m) continue;
      byKey.set(`${m.ppid}||${m.periode}`, m);
    }
    expect([...byKey.keys()].sort()).toEqual([
      "PP-BSB||2026-08",
      "PP-CARI||2026-08",
      "PP-DYN||2026-08",
    ]);
    // 3) Profil + rincian Master/Cari lolos utuh (kasus PPID dinamis
    //    tanpa profil -> null, ditangani sebagai legacy oleh API).
    const profBsb = normalizeImportProfil(payload[0] as never, "2026-08");
    expect(profBsb?.profil.ppid).toBe("PP-BSB");
    expect(profBsb?.details).toHaveLength(1);
    expect(profBsb?.details[0]).toMatchObject({ modul_nama: "PLN Postpaid" });
    const profCari = normalizeImportProfil(payload[1] as never, "2026-08");
    expect(profCari?.profil.ppid).toBe("PP-CARI");
    expect(profCari?.details).toHaveLength(1);
    expect(profCari?.details[0]).toMatchObject({ modul_nama: "PBB" });
    expect(normalizeImportProfil(payload[2] as never, "2026-08")).toBeNull();
  });

  it("buildCariSlipText: slip keuangan + rincian modul", () => {
    const text = buildCariSlipText(
      {
        ppid: "P1",
        namaLoket: "Loket 1",
        bank: "BRI",
        noRekening: "123",
        namaPemilik: "Bos",
        rekomender: "",
        elektrikArea: "",
        periode: "2026-08",
        feeBulanIni: 114800,
        feeBulanSebelumnya: 0,
        subsidiAntarLoket: 0,
        totalFee: 114800,
        minus: 0,
        hold: 0,
        potonganLainnya: 0,
        potonganOngkir: 0,
        totalFeeTransfer: 114800,
        feeKeDeposit: 0,
        feeTransferRekening: 114800,
        sisaFee: 0,
        keterangan: "",
        tanggalTransfer: "",
        feeSiapTransfer: 114800,
        statusPembayaran: "TRANSFER_REKENING",
      },
      [{ modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 }]
    );
    expect(text).toContain("PPID: P1");
    expect(text).toContain("Fee Siap Transfer:");
    expect(text).toContain("Subsidi Antar Loket:");
    expect(text).toContain("Status Fee: Transfer ke Rekening");
    expect(text).toContain("PLN Postpaid: 56 lbr x");
  });
  it("ppidSearchKey: hubung/spasi/NBSP/case diabaikan saat mencari", () => {
    expect(ppidSearchKey("sbpos-ckm-001")).toBe("SBPOSCKM001");
    expect(ppidSearchKey("sbpos ckm 001")).toBe("SBPOSCKM001");
    expect(ppidSearchKey(" SBPOS-CKM-001 ")).toBe("SBPOSCKM001");
    expect(filterFeeRows(MOCK_FEE_DATA, "sbposckm001", "")).toHaveLength(1);
  });
});

describe("fetchLoketLookup (sheet Cari via API)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("404 -> not-found tanpa error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) }))
    );
    await expect(fetchLoketLookup("TIDAK-ADA")).resolves.toEqual({
      found: false,
      profile: null,
      details: [],
      legacy: false,
    });
  });

  it("200 -> profil + rincian ternormalisasi", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          found: true,
          legacy: false,
          profile: {
            ppid: "P1",
            nama_loket: "Loket 1",
            bank: "BRI",
            no_rekening: "123",
            nama_pemilik: "Bos",
            rekomender: "",
            elektrik_area: "",
            periode: "2026-08",
            fee_bulan_ini: "114800",
            fee_bulan_sebelumnya: 0,
            minus: 0,
            hold: 0,
            potongan_lainnya: 0,
            fee_siap_transfer: 114800,
            status_pembayaran: "TERBAYAR",
          },
          details: [
            { modul_nama: "PLN Postpaid", jumlah_lembar: 56, fee_per_lembar: 2050, total_fee: 114800 },
          ],
        }),
      }))
    );
    const result = await fetchLoketLookup(" p1 ");
    expect(result.found).toBe(true);
    expect(result.profile?.feeBulanIni).toBe(114800);
    expect(result.details).toEqual([
      { modul: "PLN Postpaid", lembar: 56, feePerLembar: 2050, total: 114800 },
    ]);
  });

  it("error server diteruskan sebagai pesan jelas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 503,
        ok: false,
        json: async () => ({ error: "Tabel loket_profiles belum tersedia" }),
      }))
    );
    await expect(fetchLoketLookup("P1")).rejects.toThrow("belum tersedia");
  });
});

describe("Slip Master penuh (J20 Excel) + anti Rp-0", () => {
  it("deriveRichStatus mengikuti J20: 0/1/2/3", () => {
    expect(deriveRichStatus(0, 0)).toBe("BELUM_TRANSFER");
    expect(deriveRichStatus(5000, 0)).toBe("KE_DEPOSIT");
    expect(deriveRichStatus(0, 114800)).toBe("TRANSFER_REKENING");
    expect(deriveRichStatus(1000, 2000)).toBe("TOPUP_SISA");
  });

  it("statusLabelCari persis E21 + isPaidStatus + normalisasi input", () => {
    expect(statusLabelCari("BELUM_TRANSFER")).toBe("Belum di Transfer");
    expect(statusLabelCari("KE_DEPOSIT")).toBe("Fee Ke Deposit");
    expect(statusLabelCari("TRANSFER_REKENING")).toBe("Transfer ke Rekening");
    expect(statusLabelCari("TOPUP_SISA")).toBe("Topup Minus Sisa Transfer Fee");
    expect(statusLabelCari("TERBAYAR")).toBe("Terbayar");
    expect(statusLabelCari("aneh")).toBe("Pending");
    expect(isPaidStatus("TOPUP_SISA")).toBe(true);
    expect(isPaidStatus("BELUM_TRANSFER")).toBe(false);
    expect(isPaidStatus("PENDING")).toBe(false);
    expect(normalizeLoketStatusInput("ke_deposit")).toBe("KE_DEPOSIT");
    expect(normalizeLoketStatusInput("???")).toBe("BELUM_TRANSFER");
  });

  it("classifyFeeDbError: kolom hilang -> 503 MIGRATION_MISSING extra", () => {
    const missing = classifyFeeDbError(
      { code: "PGRST204", message: 'Could not find the \'subsidi_antar_loket\' column' },
      "loket_profiles",
      "fallback"
    );
    expect(missing.status).toBe(503);
    expect(missing.code).toBe("MIGRATION_MISSING");
    expect(missing.message).toContain("20261003000000_loket_profiles_master_extra.sql");
  });

  it("toFeeRekapRowFromProfil: bigint-string terkoersi, bukan Rp 0", () => {
    // PostgREST mengembalikan bigint sebagai STRING — akar Rp 0 bila
    // dibaca tanpa parseAmount.
    const row = toFeeRekapRowFromProfil({
      id: "uuid-9",
      ppid: "53jcum03186mjksm",
      nama_loket: "Sangkan Makmur",
      periode: "2026-08",
      fee_bulan_ini: "114800",
      fee_bulan_sebelumnya: 0,
      subsidi_antar_loket: "0",
      total_fee: "114800",
      minus: 0,
      hold: 0,
      potongan_lainnya: 0,
      potongan_ongkir: 0,
      fee_siap_transfer: "114800",
      status_pembayaran: "TRANSFER_REKENING",
      updated_at: "2026-08-28T00:00:00Z",
    });
    expect(row.ppid).toBe("53JCUM03186MJKSM");
    expect(row.totalFee).toBe(114800);
    expect(row.status).toBe("TERBAYAR");
    expect(row.rincian.map((r) => r.label)).toContain("Fee Siap Transfer");
  });

  it("toFeeRekapRowFromProfil: total_fee kosong -> hitung E14, bukan 0", () => {
    // Baris lama pra-migrasi extra (total_fee NULL/0): E14 dari komponen.
    const row = toFeeRekapRowFromProfil({
      ppid: "P1",
      nama_loket: "Loket 1",
      periode: "2026-08",
      fee_bulan_ini: 100000,
      fee_bulan_sebelumnya: 20000,
      subsidi_antar_loket: 5000,
      total_fee: 0,
      fee_siap_transfer: 0,
      status_pembayaran: "BELUM_TRANSFER",
    });
    expect(row.totalFee).toBe(125000);
    expect(row.status).toBe("PENDING");
  });

  it("isProfilDbRow membedakan baris Master vs legacy", () => {
    expect(isProfilDbRow({ fee_bulan_ini: 1 })).toBe(true);
    expect(isProfilDbRow({ total_fee: 1 })).toBe(false);
    expect(isProfilDbRow(null)).toBe(false);
  });
});

describe("dropAllFeeData (reset database)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETE drop-all mengembalikan hitungan per tabel", async () => {
    const seen: { url: unknown; init: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: unknown) => {
        seen.push({ url, init });
        return {
          ok: true,
          json: async () => ({
            success: true,
            deleted: { details: 13501, profiles: 10692, feeLoket: 10692 },
          }),
        };
      })
    );
    const result = await dropAllFeeData();
    expect(result).toEqual({ profiles: 10692, details: 13501, feeLoket: 10692 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("/api/fee-rekap/drop-all");
    expect((seen[0]?.init as { method: string }).method).toBe("DELETE");
  });

  it("403/500 server diteruskan sebagai pesan jelas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Hanya ADMIN yang boleh menghapus" }),
      }))
    );
    await expect(dropAllFeeData()).rejects.toThrow("Hanya ADMIN");
  });
});

describe("Tanggal Transfer ala E27 + nama file slip", () => {
  it("excelSerialToTanggal: serial -> 3-Sep-2026 (UTC, tanpa geser hari)", () => {
    expect(excelSerialToTanggal(46268)).toBe("3-Sep-2026");
    expect(excelSerialToTanggal(46273)).toBe("8-Sep-2026");
    expect(excelSerialToTanggal(46275)).toBe("10-Sep-2026");
    expect(excelSerialToTanggal("46268")).toBe("3-Sep-2026");
    expect(excelSerialToTanggal(0)).toBeNull();
    expect(excelSerialToTanggal("")).toBeNull();
    expect(excelSerialToTanggal(null)).toBeNull();
    expect(excelSerialToTanggal("Transfer 05 Agustus 2026")).toBeNull();
    expect(excelSerialToTanggal(10)).toBeNull();
  });

  it("resolveTanggalTransfer: grup pertama yang aktif menang (E27)", () => {
    const header: unknown[] = Array(209).fill("");
    header[198] = 46268;
    header[200] = 46273;
    header[202] = 46275;
    const cells: unknown[] = Array(209).fill("");
    cells[200] = 1000; // deposit grup 2
    cells[199] = 0;
    expect(resolveTanggalTransfer(header, cells, "")).toBe("8-Sep-2026");
    // Grup 1 aktif mengalahkan grup 2 walau grup 2 juga aktif.
    cells[199] = 500;
    expect(resolveTanggalTransfer(header, cells, "")).toBe("3-Sep-2026");
    // Serial grup rusak -> catatan kol 208; kosong -> "Belum di kirim".
    header[198] = "";
    expect(resolveTanggalTransfer(header, cells, "Transfer 05 Agustus 2026")).toBe(
      "Transfer 05 Agustus 2026"
    );
    expect(resolveTanggalTransfer(header, cells, "")).toBe("Belum di kirim");
    // Tanpa aktivitas: catatan dipakai bila ada.
    const idle: unknown[] = Array(209).fill("");
    expect(resolveTanggalTransfer(header, idle, "Transfer 05 Agustus 2026")).toBe(
      "Transfer 05 Agustus 2026"
    );
    expect(resolveTanggalTransfer(header, idle, "")).toBe("Belum di kirim");
  });

  it("slipImageFilename: aman untuk download lintas OS/browser", () => {
    expect(slipImageFilename("53JCUM03186MJKSM", "2026-08")).toBe(
      "slip-53JCUM03186MJKSM-2026-08.png"
    );
    expect(slipImageFilename("a/b c", "")).toBe("slip-a_b_c-loket.png");
  });
});
