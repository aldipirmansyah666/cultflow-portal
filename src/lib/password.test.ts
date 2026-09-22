import { describe, expect, it } from "vitest";
import {
  hashPassword,
  isBcryptHash,
  isLegacyHash,
  verifyPassword,
} from "./password";

describe("hashPassword / isBcryptHash", () => {
  it("menghasilkan hash bcrypt yang terverifikasi", async () => {
    const hash = await hashPassword("rahasia123");
    expect(isBcryptHash(hash)).toBe(true);
    expect(isLegacyHash(hash)).toBe(false);
    expect(await verifyPassword("rahasia123", hash)).toBe(true);
    expect(await verifyPassword("salah", hash)).toBe(false);
  });

  it("mengenali format legacy", () => {
    expect(isBcryptHash("$2b$10$abc")).toBe(true);
    expect(isBcryptHash("salt$deadbeef")).toBe(false);
    expect(isLegacyHash("salt$deadbeef")).toBe(true);
  });
});

describe("verifyPassword legacy SHA-256", () => {
  it("salt$hash dan tanpa-salt", async () => {
    const subtle = crypto.subtle;
    const hex = async (s: string) =>
      Array.from(
        new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(s)))
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const salted = `abc123$${await hex(`abc123katasandi`)}`;
    expect(await verifyPassword("katasandi", salted)).toBe(true);
    expect(await verifyPassword("salah", salted)).toBe(false);
    expect(await verifyPassword("katasandi", await hex("katasandi"))).toBe(true);
    expect(await verifyPassword("katasandi", "format-rusak$")).toBe(false);
  });
});
