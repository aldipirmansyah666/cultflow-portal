import { describe, expect, it } from "vitest";
import {
  buildBailoutMessage,
  defaultRedaksiDateISO,
  formatIDCurrency,
  formatIDDate,
  getBailoutDisplayName,
} from "../bailoutMessage";

describe("formatIDCurrency / formatIDDate", () => {
  it("format rupiah minus", () => {
    expect(formatIDCurrency(-1507495)).toBe("Rp - 1.507.495");
    expect(formatIDCurrency(5000)).toBe("Rp 5.000");
  });

  it("format tanggal Indonesia", () => {
    expect(formatIDDate(new Date(2026, 8, 13))).toBe("13 September 2026");
  });
});

describe("getBailoutDisplayName", () => {
  it("sapaan personal bila dikenal, nama asli bila tidak", () => {
    expect(getBailoutDisplayName("DIKASA")).toBe("Pak Erwin");
    expect(getBailoutDisplayName("LOKET ASING")).toBe("LOKET ASING");
  });
});

describe("buildBailoutMessage", () => {
  // 2026-09-18 = Jumat (weekday); cetak H-1 = 17 September 2026
  it("template weekday + tanggal cetak H-1", () => {
    const msg = buildBailoutMessage("DIKASA", -100000, "2026-09-18");
    expect(msg).toContain("Dear Pak Erwin");
    expect(msg).toContain("17 September 2026");
    expect(msg).toContain("Rp - 100.000");
    expect(msg).toContain("sebelum pukul 09.00 WIB");
    expect(msg).toContain("Hatur Nuhun");
  });

  // 2026-09-20 = Minggu (weekend)
  it("template weekend bila redaksi Sabtu/Minggu", () => {
    const msg = buildBailoutMessage("DIKASA", -100000, "2026-09-20");
    expect(msg).toContain("menghindari penumpukan di hari Senin");
  });

  it("agen terklasifikasi tetap weekday saat weekend", () => {
    const msg = buildBailoutMessage(
      "PT. TRINERGI UTAMA JAYA - TUJ",
      -5000,
      "2026-09-20"
    );
    expect(msg).toContain("sebelum pukul 09.00 WIB");
    expect(msg).not.toContain("hari Senin");
  });

  it("defaultRedaksiDateISO = kemarin", () => {
    const ref = new Date(2026, 8, 20, 12, 0, 0);
    expect(defaultRedaksiDateISO(ref)).toBe("2026-09-19");
  });
});
