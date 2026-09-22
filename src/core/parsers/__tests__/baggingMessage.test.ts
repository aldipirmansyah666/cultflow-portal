import { describe, expect, it } from "vitest";
import {
  buildBaggingMessage,
  buildBaggingWaUrl,
  formatTimeWIB,
  generateKodeUnik,
  HIMBAUAN_OPTIONS,
  MAAF_OPTIONS,
  normalizeWaNumber,
  pickRandom,
  SALAM_OPTIONS,
} from "../baggingMessage";

describe("buildBaggingMessage (redaksi otentik 100%)", () => {
  it("identik dengan template otentik bila parts di-inject", () => {
    const text = buildBaggingMessage({
      agenName: "IND EXPRESS",
      tanggal: "21/09/2026",
      resiList: ["SHPE001", "P260002"],
      salam: "Selamat pagi",
      maaf: "maaf mengganggu waktunya sebentar pak",
      himbauan: "Boleh dibantu untuk segera diproses bagging ya pak",
      kodeUnik: "9E5QT3",
      timeWIB: "08:15",
    });
    expect(text).toBe(
      [
        "Selamat pagi pak, maaf mengganggu waktunya sebentar pak, kami sampaikan ada paket di agen bapak IND EXPRESS pada Tanggal 21/09/2026 yang belum dibagging ya pak?",
        "Boleh dibantu untuk segera diproses bagging ya pak.",
        "",
        "Berikut informasi resinya :",
        "SHPE001",
        "P260002",
        "",
        "Silahkan abaikan pesan ini apabila sudah melakukan bagging dan apabila terdapat Pertanyaan / kendala silahkan hubungi nomor +62 822-1756-9689 / +62 819-1066-6926.",
        "Demi keamanan dan kenyamanan, mohon simpan nomor ini sebagai KONTAK di HP Anda.",
        "",
        "--- ",
        "_Ref: BGG-9E5QT3 | 08:15 WIB_",
      ].join("\n")
    );
  });

  it("daftar resi line-by-line tanpa nomor/layanan", () => {
    const text = buildBaggingMessage({
      agenName: "A",
      tanggal: "T",
      resiList: [{ resi: "R1", layanan: "PE" }, "R2"],
      salam: "Halo",
      maaf: MAAF_OPTIONS[0],
      himbauan: HIMBAUAN_OPTIONS[0],
      kodeUnik: "ABCDEF",
      timeWIB: "10:00",
    });
    expect(text).toContain("Berikut informasi resinya :\nR1\nR2\n\n");
    expect(text).not.toContain("(PE)");
  });

  it("varian acak dari opsi resmi (anti-spam)", () => {
    const salams = new Set(
      Array.from({ length: 40 }, () =>
        buildBaggingMessage({
          agenName: "A",
          tanggal: "T",
          resiList: ["R"],
          kodeUnik: "XXXXXX",
          timeWIB: "10:00",
        }).split("\n")[0]
      )
    );
    expect(salams.size).toBeGreaterThan(1);
    for (const line of salams) {
      const salam = line.split(" pak,")[0];
      expect(SALAM_OPTIONS).toContain(salam);
    }
  });

  it("kode unik 6 alfanumerik kapital + footer ber-waktu", () => {
    expect(generateKodeUnik(6, () => 0)).toHaveLength(6);
    expect(generateKodeUnik()).toMatch(/^[A-Z0-9]{6}$/);
    const text = buildBaggingMessage({
      agenName: "A",
      tanggal: "T",
      resiList: ["R"],
      salam: "Selamat pagi",
      maaf: MAAF_OPTIONS[0],
      himbauan: HIMBAUAN_OPTIONS[0],
      kodeUnik: "9E5QT3",
      timeWIB: "08:15",
    });
    expect(text.endsWith("--- \n_Ref: BGG-9E5QT3 | 08:15 WIB_")).toBe(true);
  });

  it("formatTimeWIB konversi UTC ke WIB", () => {
    // 2026-09-21T01:05:00Z = 08:05 WIB
    expect(formatTimeWIB(Date.parse("2026-09-21T01:05:00Z"))).toBe("08:05");
  });

  it("pickRandom deterministik dengan stub", () => {
    expect(pickRandom(SALAM_OPTIONS, () => 0)).toBe("Selamat pagi");
    expect(pickRandom(HIMBAUAN_OPTIONS, () => 0.999)).toBe(
      "Mohon bantuannya untuk diproses bagging hari ini"
    );
  });

  it("melempar error untuk input kosong", () => {
    const base = { agenName: "A", tanggal: "T", resiList: ["R"] };
    expect(() => buildBaggingMessage({ ...base, agenName: "  " })).toThrow(
      "agenName tidak boleh kosong"
    );
    expect(() => buildBaggingMessage({ ...base, tanggal: "" })).toThrow(
      "tanggal tidak boleh kosong"
    );
    expect(() => buildBaggingMessage({ ...base, resiList: [] })).toThrow(
      "resiList tidak boleh kosong"
    );
    expect(
      () => buildBaggingMessage({ ...base, resiList: ["  ", { resi: "" }] })
    ).toThrow("resiList tidak boleh kosong");
  });
});

describe("normalizeWaNumber & buildBaggingWaUrl", () => {
  it("08xx -> 628xx, +62/0062 dibersihkan", () => {
    expect(normalizeWaNumber("081313061606")).toBe("6281313061606");
    expect(normalizeWaNumber("+62 813-1306-1606")).toBe("6281313061606");
    expect(normalizeWaNumber("6281313061606")).toBe("6281313061606");
    expect(normalizeWaNumber("006281313061606")).toBe("6281313061606");
  });

  it("tak valid -> string kosong", () => {
    expect(normalizeWaNumber("")).toBe("");
    expect(normalizeWaNumber(null)).toBe("");
    expect(normalizeWaNumber("12345")).toBe("");
    expect(normalizeWaNumber("021544123")).toBe("");
    expect(normalizeWaNumber("abc")).toBe("");
  });

  it("URL memakai nomor bila valid, fallback tanpa nomor", () => {
    expect(buildBaggingWaUrl("halo pak", "6281313061606")).toBe(
      "https://wa.me/6281313061606?text=halo%20pak"
    );
    expect(buildBaggingWaUrl("halo pak", "")).toBe(
      "https://wa.me/?text=halo%20pak"
    );
  });
});
