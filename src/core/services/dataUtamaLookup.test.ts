import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLookupWaText,
  lookupAgenByPpid,
  suggestAgen,
  toAgenProfile,
  type DataUtamaRow,
} from "./dataUtamaService";

interface LookupCaptured {
  selects: string[];
  ilikes: [string, string][];
  ors: string[];
  limits: number[];
}

/** Fake rantai select->ilike/or->limit dengan antrean hasil. */
function fakeLookupClient(
  results: { data: unknown[]; error?: unknown }[],
  captured: LookupCaptured
): SupabaseClient {
  let n = 0;
  const terminal = () => ({
    limit: (m: number) => {
      captured.limits.push(m);
      const r = results[Math.min(n, results.length - 1)] ?? { data: [] };
      n += 1;
      return Promise.resolve({ data: r.data, error: r.error ?? null });
    },
  });
  return {
    from: () => ({
      select: (cols: string) => {
        captured.selects.push(cols);
        return {
          ilike: (c: string, v: string) => {
            captured.ilikes.push([c, v]);
            return terminal();
          },
          or: (s: string) => {
            captured.ors.push(s);
            return terminal();
          },
        };
      },
    }),
  } as unknown as SupabaseClient;
}

const SAMPLE_ROW = {
  ppid: "53BSPA29321JBNDS",
  no_dirian: "45465S1",
  location_id: "6211a4ed",
  user_mile: "dm45465s1",
  password_mile: "password",
  nama_loket_kurlog: "IND EXPRESS",
  nama_loket_onpays: "ALBI",
  alamat_lengkap_loket: "Jl Raya No 119",
  kel_desa: "SINARGALIH",
  kec: "Lemahsugih",
  kab_kot: "Majalengka",
  nama_pemilik: "Ucup Taojiri",
  no_hp_pemilik: "081313061606",
  email: "yusuf@example.com",
  no_ktp: "3210010804830141",
  no_npwp: "93.567.420.0-438.000",
} as DataUtamaRow;

describe("toAgenProfile", () => {
  it("memetakan kolom form PosIND", () => {
    expect(toAgenProfile(SAMPLE_ROW)).toEqual({
      ppid: "53BSPA29321JBNDS",
      nopend: "45465S1",
      idLoc: "6211a4ed",
      user: "dm45465s1",
      pass: "password",
      namaAgenpos: "IND EXPRESS",
      alamatAgenpos: "Jl Raya No 119",
      kelurahan: "SINARGALIH",
      kecamatan: "Lemahsugih",
      kotaKab: "Majalengka",
      namaPemilik: "Ucup Taojiri",
      noHandphone: "081313061606",
      email: "yusuf@example.com",
      nik: "3210010804830141",
      npwp: "93.567.420.0-438.000",
    });
  });

  it("fallback nama onpays + user dari email, kosong -> string kosong", () => {
    const p = toAgenProfile({ ...SAMPLE_ROW, nama_loket_kurlog: " ", user_mile: null });
    expect(p.namaAgenpos).toBe("ALBI");
    expect(p.user).toBe("yusuf@example.com");
    const blank = toAgenProfile({} as DataUtamaRow);
    expect(blank.ppid).toBe("");
    expect(blank.nik).toBe("");
  });
});

describe("buildLookupWaText", () => {
  it("mencerminkan field card, kosong -> strip", () => {
    const text = buildLookupWaText(
      toAgenProfile({ ...SAMPLE_ROW, password_mile: null })
    );
    expect(text).not.toContain("PROFIL AGENPOS");
    expect(text).not.toContain("------------------------------");
    expect(text.startsWith("PPID: 53BSPA29321JBNDS")).toBe(true);
    expect(text).toContain("Nopend/Kode Dirian: 45465S1");
    expect(text).toContain("Pass: -");
    expect(text).toContain("NIK: 3210010804830141");
  });
});

describe("suggestAgen", () => {
  it("kosong untuk kata kunci kosong + ilike 3 kolom", async () => {
    const captured: LookupCaptured = { selects: [], ilikes: [], ors: [], limits: [] };
    expect(
      await suggestAgen(
        fakeLookupClient([{ data: [] }], captured),
        "   "
      )
    ).toEqual([]);
    expect(captured.selects).toHaveLength(0);
  });

  it("memetakan saran + dedup", async () => {
    const captured: LookupCaptured = { selects: [], ilikes: [], ors: [], limits: [] };
    const out = await suggestAgen(
      fakeLookupClient([
        {
          data: [
            { ppid: "A1", nama_loket_kurlog: "Loket A" },
            { ppid: "A1", nama_loket_kurlog: "Loket A" },
            { ppid: "", nama_loket_kurlog: "", nama_loket_onpays: "" },
            { ppid: "B2", nama_loket_kurlog: "", nama_loket_onpays: "Loket B" },
          ],
        },
      ], captured),
      "lok"
    );
    expect(out).toEqual([
      { ppid: "A1", nama: "Loket A" },
      { ppid: "B2", nama: "Loket B" },
    ]);
    expect(captured.selects[0]).toBe("ppid,nama_loket_kurlog,nama_loket_onpays");
    expect(captured.ors[0]).toContain("ppid.ilike.%lok%");
    expect(captured.limits[0]).toBe(8);
  });

  it("error: log + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "42501", message: "denied" };
      await expect(
        suggestAgen(fakeLookupClient([{ data: [], error: err }], { selects: [], ilikes: [], ors: [], limits: [] }), "x")
      ).rejects.toBe(err);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("lookupAgenByPpid", () => {
  it("null untuk kunci kosong", async () => {
    const captured: LookupCaptured = { selects: [], ilikes: [], ors: [], limits: [] };
    expect(
      await lookupAgenByPpid(fakeLookupClient([{ data: [] }], captured), "  ")
    ).toBeNull();
    expect(captured.selects).toHaveLength(0);
  });

  it("exact dulu (ilike tanpa wildcard)", async () => {
    const captured: LookupCaptured = { selects: [], ilikes: [], ors: [], limits: [] };
    const row = await lookupAgenByPpid(
      fakeLookupClient([{ data: [SAMPLE_ROW] }], captured),
      "53bspa29321jbnds"
    );
    expect(row).toEqual(SAMPLE_ROW);
    expect(captured.ilikes[0]).toEqual(["ppid", "53bspa29321jbnds"]);
    expect(captured.ors).toHaveLength(0);
  });

  it("fallback fuzzy bila exact kosong; null bila keduanya kosong", async () => {
    const c1: LookupCaptured = { selects: [], ilikes: [], ors: [], limits: [] };
    const row = await lookupAgenByPpid(
      fakeLookupClient([{ data: [] }, { data: [SAMPLE_ROW] }], c1),
      "ALBI"
    );
    expect(row).toEqual(SAMPLE_ROW);
    expect(c1.ors[0]).toContain("nama_loket_onpays.ilike.%ALBI%");

    const c2: LookupCaptured = { selects: [], ilikes: [], ors: [], limits: [] };
    expect(
      await lookupAgenByPpid(
        fakeLookupClient([{ data: [] }, { data: [] }], c2),
        "TIDAKADA"
      )
    ).toBeNull();
  });

  it("error exact: log + throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { code: "PGRST204", message: "schema cache" };
      await expect(
        lookupAgenByPpid(
          fakeLookupClient([{ data: [], error: err }], { selects: [], ilikes: [], ors: [], limits: [] }),
          "X"
        )
      ).rejects.toBe(err);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
