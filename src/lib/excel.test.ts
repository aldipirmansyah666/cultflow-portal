import { describe, expect, it } from "vitest";
import {
  EXCEL_MAX_CELL_CHARS,
  MatrixLimitError,
  parseCsvMatrix,
  validateMatrixLimits,
  type MatrixLimitReport,
} from "./excel";

describe("parseCsvMatrix — T1 kutip liar (stray quotes)", () => {
  it("kutip di tengah kata (8\" inci) diperlakukan literal, baris bawah tidak tertelan", () => {
    const csv = "produk;resi\nPKH;26MNG1\nPKH;8\" inci\nPKH;P26123\n";
    const result = parseCsvMatrix(csv, null);

    expect(result.delimiter).toBe(";");
    // Header + 3 baris data tetap utuh (tidak bergabung jadi 1 sel raksasa).
    expect(result.matrix).toHaveLength(4);
    expect(result.matrix[0]).toEqual(["produk", "resi"]);
    expect(result.matrix[1]).toEqual(["PKH", "26MNG1"]);
    expect(result.matrix[2]).toEqual(["PKH", '8" inci']);
    expect(result.matrix[3]).toEqual(["PKH", "P26123"]);
  });

  it("kutip liar menempel kode resi (26\"ASD) tidak memicu mode kutip", () => {
    const csv = 'produk;resi\nPKH;26"ASD123\nPKH;TTSPOS9\n';
    const result = parseCsvMatrix(csv, null);

    expect(result.matrix).toHaveLength(3);
    expect(result.matrix[1]).toEqual(["PKH", '26"ASD123']);
    expect(result.matrix[2]).toEqual(["PKH", "TTSPOS9"]);
  });

  it("field kutip valid RFC-4180 (\"a;b\", multi-baris, escape \"\") tetap didukung", () => {
    const csv = 'a;b\n"p;q";ok\n"multi\nline";ok2\n"esc ""q""";ok3\n';
    const result = parseCsvMatrix(csv, null);

    expect(result.matrix).toHaveLength(4);
    expect(result.matrix[1]).toEqual(["p;q", "ok"]);
    expect(result.matrix[2]).toEqual(["multi\nline", "ok2"]);
    expect(result.matrix[3]).toEqual(['esc "q"', "ok3"]);
  });
});

describe("validateMatrixLimits — T3 MatrixLimitError sel raksasa", () => {
  it("melempar MatrixLimitError CELL_TOO_LONG dengan alamat + preview + konteks file", () => {
    const giant = "Z".repeat(EXCEL_MAX_CELL_CHARS + 7233); // > 32.767
    const matrix: unknown[][] = [["produk", "resi"], ["PKH", giant]];

    let caught: unknown = null;
    try {
      validateMatrixLimits(matrix, {
        maxRows: 20030,
        maxCols: 200,
        fileName: "tes.csv",
        sheetName: "Sheet1",
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(MatrixLimitError);
    const err = caught as MatrixLimitError;
    expect(err.name).toBe("MatrixLimitError");
    expect(err.code).toBe("CELL_TOO_LONG");
    expect(err.fileName).toBe("tes.csv");
    expect(err.sheetName).toBe("Sheet1");
    // Pelanggaran menunjuk sel B2 (baris 2 kolom 2) dengan panjang aktual.
    expect(err.violations).toHaveLength(1);
    expect(err.violations[0]).toMatchObject({
      row: 2,
      col: 2,
      address: "B2",
      length: giant.length,
    });
    // Pesan: alamat + angka + preview + konteks file (mudah diaudit).
    expect(err.message).toContain("tes.csv");
    expect(err.message).toContain("Sheet1");
    expect(err.message).toContain("B2");
    expect(err.message).toContain("Isi awal");
    expect(err.hint.length).toBeGreaterThan(0);
  });

  it("matriks normal lolos tanpa throw", () => {
    expect(() =>
      validateMatrixLimits(
        [["produk", "resi"], ["PKH", "P26123"]],
        { maxRows: 20030, maxCols: 200 }
      )
    ).not.toThrow();
  });
});

describe("validateMatrixLimits — T4 mode truncate", () => {
  it("memotong sel berlebih ke batas tanpa throw + mengisi laporan", () => {
    const giant = "Z".repeat(EXCEL_MAX_CELL_CHARS + 7233);
    const matrix: unknown[][] = [["ok"], [giant]];
    const report: MatrixLimitReport = { truncatedCells: [], warnings: [] };

    expect(() =>
      validateMatrixLimits(
        matrix,
        { maxRows: 20030, maxCols: 200, onOversizeCell: "truncate" },
        report
      )
    ).not.toThrow();

    // Sel dipotong tepat ke batas Excel.
    expect(typeof matrix[1]?.[0]).toBe("string");
    expect((matrix[1]?.[0] as string).length).toBe(EXCEL_MAX_CELL_CHARS);
    // Laporan audit terisi: lokasi sel + ringkasan peringatan.
    expect(report.truncatedCells).toHaveLength(1);
    expect(report.truncatedCells[0]).toMatchObject({ address: "A2" });
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.join(" ")).toContain("A2");
  });
});
