import { describe, expect, it } from "vitest";
import {
  EXCEL_MAX_CELL_CHARS,
  MatrixLimitError,
  detectSpreadsheetKind,
  fileExtensionOf,
  loadWorkbookFromBuffer,
  parseCsvMatrix,
  parseHtmlTableMatrices,
  parseXmlSpreadsheetMatrices,
  validateMatrixLimits,
  writeAoaToBuffer,
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

describe("validateMatrixLimits — T4 mode truncate", () => {  it("memotong sel berlebih ke batas tanpa throw + mengisi laporan", () => {
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

describe("detectSpreadsheetKind — sniffing magic bytes", () => {
  it("mengenali OLE2 legacy, HTML, SpreadsheetML 2003, CSV, dan ZIP", async () => {
    const ole = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    expect(detectSpreadsheetKind(ole)).toBe("ole-legacy");

    const html = Buffer.from(
      '<html xmlns:o="urn:schemas-microsoft-com:office:excel"><table><tr><td>produk</td></tr></table>'
    );
    expect(detectSpreadsheetKind(html)).toBe("html");

    const xml2003 = Buffer.from(
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Row/></Workbook>'
    );
    expect(detectSpreadsheetKind(xml2003)).toBe("xml-spreadsheet");

    const csv = Buffer.from("produk;resi\nPKH;P26123\n");
    expect(detectSpreadsheetKind(csv)).toBe("csv-text");

    const xlsx = await writeAoaToBuffer({ Sheet1: [["produk", "resi"], ["PKH", "P26123"]] });
    expect(detectSpreadsheetKind(xlsx)).toBe("xlsx");
  });

  it("fileExtensionOf mengambil ekstensi lowercase", () => {
    expect(fileExtensionOf("trx_Rekon_DATA_2026-10-05.XLS")).toBe(".xls");
    expect(fileExtensionOf("a/b/c.csv")).toBe(".csv");
    expect(fileExtensionOf(undefined)).toBe("");
  });
});

describe("loadWorkbookFromBuffer — routing format", () => {
  it("xlsx asli dibaca via exceljs (bukan parser CSV)", async () => {
    const xlsx = await writeAoaToBuffer({
      Rekon: [["produk", "nomor_resi"], ["PKH", "P26123"], ["EC3", "SHPE1"]],
    });
    const wb = await loadWorkbookFromBuffer(xlsx, {
      defval: null,
      fileName: "trx_rekon_data_2026-10-05.xlsx",
    });
    expect(wb.sheetNames).toEqual(["Rekon"]);
    expect(wb.matrices.get("Rekon")).toHaveLength(3);
  });

  it(".xls OLE2 ditolak dengan pesan konversi (tanpa fallback CSV)", async () => {
    const ole = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    await expect(
      loadWorkbookFromBuffer(ole, { defval: null, fileName: "lama.xls" })
    ).rejects.toThrow(/\.xls lama/);
  });

  it("HTML ber-ekstensi .xls diekstrak tabelnya (bukan ditolak / 4 baris mentah)", async () => {
    const html = Buffer.from(
      '<html xmlns:o="urn:schemas-microsoft-com:office:excel"><table>' +
        "<tr><th>produk</th><th>nomor_resi</th></tr>" +
        "<tr><td>PKH</td><td>P26123</td></tr>" +
        "<tr><td>EC3</td><td>SHPE1</td></tr>" +
        "</table></html>"
    );
    const wb = await loadWorkbookFromBuffer(html, {
      defval: null,
      fileName: "trx_rekon_data_2026-10-05.xls",
    });
    expect(wb.sheetNames).toEqual(["Table1"]);
    expect(wb.matrices.get("Table1")).toEqual([
      ["produk", "nomor_resi"],
      ["PKH", "P26123"],
      ["EC3", "SHPE1"],
    ]);
  });

  it("HTML tanpa <table> tetap ditolak dengan pesan jelas", async () => {
    const html = Buffer.from(
      "<html><head><title>Halo</title></head><body><p>Tidak ada tabel</p></body></html>"
    );
    await expect(
      loadWorkbookFromBuffer(html, { defval: null, fileName: "rekon.xls" })
    ).rejects.toThrow(/tidak ada tabel data/);
  });

  it("teks CSV ber-ekstensi .xlsx ditolak sebagai mismatch", async () => {
    const csv = Buffer.from("produk;resi\nPKH;P26123\n");
    await expect(
      loadWorkbookFromBuffer(csv, { defval: null, fileName: "rekon.xlsx" })
    ).rejects.toThrow(/ekstensinya ".xlsx"/);
  });

  it("CSV valid tetap terparse normal", async () => {
    const csv = Buffer.from("produk;resi\nPKH;P26123\nEC3;SHPE1\n");
    const wb = await loadWorkbookFromBuffer(csv, {
      defval: null,
      fileName: "rekon.csv",
    });
    expect(wb.sheetNames).toEqual(["Sheet1"]);
    expect(wb.matrices.get("Sheet1")).toHaveLength(3);
  });

  it("SpreadsheetML 2003 diekstrak per worksheet", async () => {
    const xml = Buffer.from(
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">' +
        '<Worksheet ss:Name="Rekon"><Table>' +
        "<Row><Cell><Data>produk</Data></Cell><Cell><Data>nomor_resi</Data></Cell></Row>" +
        "<Row><Cell><Data>PKH</Data></Cell><Cell><Data>P26123</Data></Cell></Row>" +
        "</Table></Worksheet></Workbook>"
    );
    const wb = await loadWorkbookFromBuffer(xml, {
      defval: null,
      fileName: "rekon.xml",
    });
    expect(wb.sheetNames).toEqual(["Rekon"]);
    expect(wb.matrices.get("Rekon")).toEqual([
      ["produk", "nomor_resi"],
      ["PKH", "P26123"],
    ]);
  });
});

describe("parseHtmlTableMatrices — ekstraksi tabel HTML", () => {
  it("tag dalam dibuang, entitas didekode, baris kosong dibuang", () => {
    const { sheets } = parseHtmlTableMatrices(
      "<table><tr><th><b>produk</b></th><th>nomor_resi</th></tr>" +
        "<tr><td>PKH &amp; Rekan</td><td>P26123</td></tr>" +
        "<tr><td></td><td></td></tr></table>",
      null
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.matrix).toEqual([
      ["produk", "nomor_resi"],
      ["PKH & Rekan", "P26123"],
    ]);
  });

  it("colspan menjaga posisi kolom, multi-tabel jadi multi-sheet", () => {
    const { sheets } = parseHtmlTableMatrices(
      "<table><tr><td colspan='2'>Judul</td></tr>" +
        "<tr><td>produk</td><td>resi</td></tr></table>" +
        "<table><tr><td>lain</td></tr></table>",
      null
    );
    expect(sheets).toHaveLength(2);
    expect(sheets[0]?.matrix[0]).toEqual(["Judul", null]);
    expect(sheets[1]?.name).toBe("Table2");
  });
});

describe("parseXmlSpreadsheetMatrices", () => {
  it("ss:Index memberi lompatan kolom yang benar", () => {
    const { sheets } = parseXmlSpreadsheetMatrices(
      '<Workbook><Worksheet ss:Name="S"><Table>' +
        '<Row><Cell><Data>a</Data></Cell><Cell ss:Index="3"><Data>c</Data></Cell></Row>' +
        "</Table></Worksheet></Workbook>",
      null
    );
    expect(sheets[0]?.matrix).toEqual([["a", null, "c"]]);
  });
});
