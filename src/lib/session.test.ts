// @vitest-environment node
// (jose butuh realm Node; lib session memang server-only)
import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  createSessionToken,
  isPublicPath,
  verifySessionToken,
} from "./session";

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "0123456789abcdef0123456789abcdef-test";

describe("session token", () => {
  it("round-trip create/verify + tolak token rusak", async () => {
    const token = await createSessionToken({
      userId: "u-1",
      username: "admin",
      name: "Administrator",
      role: "ADMIN",
      tokenVersion: 1,
    });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
    const payload = await verifySessionToken(token);
    expect(payload).toMatchObject({ userId: "u-1", role: "ADMIN" });
    expect(await verifySessionToken(`${token}rusak`)).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });

  it("menolak token lama tanpa tokenVersion / versi tidak sah", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const base = {
      userId: "u-1",
      username: "admin",
      name: "Administrator",
      role: "ADMIN",
    };
    const legacy = await new SignJWT(base)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifySessionToken(legacy)).toBeNull();

    const zero = await createSessionToken({ ...base, role: "ADMIN", tokenVersion: 0 });
    expect(await verifySessionToken(zero)).toBeNull();
  });
});

describe("isPublicPath", () => {
  it("login + api/auth/login lolos, lainnya tidak", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/auth/login")).toBe(true);
    expect(isPublicPath("/api/auth/me")).toBe(false);
    expect(isPublicPath("/user-management")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });
});
