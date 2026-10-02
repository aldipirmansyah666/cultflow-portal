import { describe, expect, it } from "vitest";
import {
  MAX_EXCEL_SIZE_BYTES,
  MAX_FEE_EXCEL_SIZE_BYTES,
  validateFileSize,
} from "./fileValidation";

function fakeFile(name: string, size: number): File {
  return { name, size } as File;
}

describe("fileValidation limits", () => {
  it("limit global tetap 5 MB", () => {
    expect(MAX_EXCEL_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("limit fee 15 MB menampung rekap bulanan ±9 MB", () => {
    expect(MAX_FEE_EXCEL_SIZE_BYTES).toBe(15 * 1024 * 1024);
    const sembilanMb = 9 * 1024 * 1024;
    // Lolos di limit fee, ditolak di limit global.
    expect(
      validateFileSize(fakeFile("rekap.xlsx", sembilanMb), MAX_FEE_EXCEL_SIZE_BYTES)
    ).toBeNull();
    expect(
      validateFileSize(fakeFile("rekap.xlsx", sembilanMb), MAX_EXCEL_SIZE_BYTES)
    ).toContain("Maksimal 5 MB");
  });

  it("menolak di atas limit fee + file kosong", () => {
    expect(
      validateFileSize(
        fakeFile("besar.xlsx", MAX_FEE_EXCEL_SIZE_BYTES + 1),
        MAX_FEE_EXCEL_SIZE_BYTES
      )
    ).toContain("Maksimal 15 MB");
    expect(validateFileSize(fakeFile("nol.xlsx", 0))).toContain("kosong");
  });
});
