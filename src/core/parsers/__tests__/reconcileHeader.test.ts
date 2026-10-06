import { describe, expect, it } from "vitest";
import {
  columnLetter,
  extractReconcileInputRows,
  findReconcileHeader,
} from "../reconcileHeader";

describe("findReconcileHeader — toleran judul & sinonim", () => {
  it("melewati judul laporan + baris kosong di atas header", () => {
    const matrix: unknown[][] = [
      ["LAPORAN PENGIRIMAN BULANAN"],
      [null, null],
      ["No", "Produk", "Nomor Resi", "Ket"],
      ["1", "PKH", "P26123", "ok"],
    ];
    const header = findReconcileHeader(matrix);
    expect(header).toMatchObject({ row: 2, produkCol: 1, resiCol: 2 });
  });

  it("mendukung header Inggris (Product + Connote/AWB)", () => {
    const matrix: unknown[][] = [
      ["No", "Product", "Connote"],
      ["1", "PKH", "P26123"],
    ];
    expect(findReconcileHeader(matrix)).toMatchObject({ row: 0, produkCol: 1, resiCol: 2 });

    const awb: unknown[][] = [["Jenis", "AWB"], ["EC3", "SHPE1"]];
    expect(findReconcileHeader(awb)).toMatchObject({ row: 0, produkCol: 0, resiCol: 1 });
  });

  it("tak peka huruf/besar-kecil dan format (No_Resi, NOMOR RESI)", () => {
    const matrix: unknown[][] = [
      ["PRODUK", "No_Resi"],
      ["PKH", "TTSPOS9"],
    ];
    expect(findReconcileHeader(matrix)).toMatchObject({ produkCol: 0, resiCol: 1 });
  });

  it("mengabaikan baris judul satu-sel (produk+resi dalam sel yang sama)", () => {
    const matrix: unknown[][] = [
      ["Rekap Produk dan Resi Bulanan"],
      ["Produk", "Nomor Resi"],
      ["PKH", "P26123"],
    ];
    // Baris 0 cocok di SATU sel -> bukan header (kolom harus berbeda).
    expect(findReconcileHeader(matrix)).toMatchObject({ row: 1 });
  });

  it("memilih header berdata dibanding footer tanpa data", () => {
    const matrix: unknown[][] = [
      ["Produk", "Nomor Resi"],
      ["PKH", "P26123"],
      ["PKH", "TTSPOS9"],
      ["Total produk & resi : 2"],
    ];
    expect(findReconcileHeader(matrix)).toMatchObject({ row: 0 });
  });

  it("mengembalikan null bila kolom tak dikenal", () => {
    expect(findReconcileHeader([["Foo", "Bar"]])).toBeNull();
    expect(findReconcileHeader([])).toBeNull();
  });

  it("header jauh di bawah (baris 13) tetap ketemu tanpa batas eksplisit", () => {
    const matrix: unknown[][] = [
      ...Array.from({ length: 12 }, (_, i) => [`Judul laporan baris ${i + 1}`, "", ""]),
      ["No", "Produk", "Nomor Resi"],
      ["1", "PKH", "P26123"],
    ];
    // Default: pindai seluruh sheet.
    expect(findReconcileHeader(matrix)).toMatchObject({ row: 12, produkCol: 1, resiCol: 2 });
    // Batas eksplisit sempit tetap dihormati (simulasi plafon lama).
    expect(findReconcileHeader(matrix, { maxScanRows: 4 })).toBeNull();
    expect(findReconcileHeader(matrix, { maxScanRows: 15 })).toMatchObject({ row: 12 });
  });

  it("regresi trx_rekon: produk di kolom G + header nomor_resi (case-insensitive)", () => {
    // Kolom G = indeks 6. Header "nomor_resi" dinormalisasi jadi "nomorresi"
    // (alias prioritas pertama) — bukan sekadar "resi".
    const matrix: unknown[][] = [
      ["REKON PENGIRIMAN 2026-10-05"],
      ["No", "Tgl", "Asal", "Tujuan", "Berat", "Layanan", "produk", "nomor_resi"],
      ["1", "2026-10-05", "JKT", "BDG", "1", "REG", "PKH", "P26123"],
      ["2", "2026-10-05", "JKT", "SBY", "2", "REG", "EC3", "SHPE456"],
    ];
    expect(findReconcileHeader(matrix)).toMatchObject({
      row: 1,
      produkCol: 6,
      resiCol: 7,
    });

    // Varian kapitalisasi/underscore lain tetap terdeteksi.
    for (const resiHeader of ["Nomor_Resi", "NOMOR RESI", "No_Resi", "AWB", "RESI"]) {
      const m: unknown[][] = [
        ["a", "b", "c", "d", "e", "f", "PRODUK", resiHeader],
        ["a", "b", "c", "d", "e", "f", "PKH", "P26123"],
      ];
      expect(findReconcileHeader(m)).toMatchObject({ produkCol: 6, resiCol: 7 });
    }
  });
});

describe("extractReconcileInputRows", () => {
  it("tahan baris tidak rata + buang baris kosong & gema header", () => {
    const matrix: unknown[][] = [
      ["Produk", "Nomor Resi", "Ket"],
      ["PKH", "P26123"],
      ["EC3"], // baris pendek: resi kosong -> tetap diambil
      ["", ""],
      ["Produk", "Nomor Resi"], // gema header cetakan -> dibuang
      ["PJB", "26KOM7", "x"],
    ];
    const header = findReconcileHeader(matrix);
    expect(header).not.toBeNull();
    expect(extractReconcileInputRows(matrix, header!)).toEqual([
      { produk: "PKH", nomor_resi: "P26123" },
      { produk: "EC3", nomor_resi: "" },
      { produk: "PJB", nomor_resi: "26KOM7" },
    ]);
  });
});

describe("columnLetter", () => {
  it("A, Z, AA", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
  });
});
