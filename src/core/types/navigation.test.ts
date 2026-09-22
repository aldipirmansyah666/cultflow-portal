import { describe, expect, it } from "vitest";
import {
  filterNavByRole,
  NAV_ITEMS,
  isNavActive,
  resolveNavItem,
} from "./navigation";

describe("NAV_ITEMS", () => {
  it("memiliki 8 menu dengan href yang benar", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual([
      "/",
      "/data-utama",
      "/lookup-agen",
      "/bagging",
      "/bailout",
      "/reconcile",
      "/logs",
      "/user-management",
    ]);
  });

  it("membatasi User Management untuk ADMIN", () => {
    expect(
      NAV_ITEMS.find((i) => i.href === "/user-management")?.roles,
    ).toEqual(["ADMIN"]);
  });
});

describe("filterNavByRole", () => {
  it("ADMIN melihat semua menu", () => {
    expect(filterNavByRole(NAV_ITEMS, "ADMIN")).toHaveLength(NAV_ITEMS.length);
  });

  it("USER dan tamu tidak melihat User Management", () => {
    for (const role of ["USER", null, undefined]) {
      const hrefs = filterNavByRole(NAV_ITEMS, role).map((i) => i.href);
      expect(hrefs).not.toContain("/user-management");
      expect(hrefs).toContain("/data-utama");
    }
  });
});

describe("isNavActive", () => {
  it("hanya cocok persis untuk /", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/bagging", "/")).toBe(false);
  });

  it("cocok untuk route dan sub-route", () => {
    expect(isNavActive("/bagging", "/bagging")).toBe(true);
    expect(isNavActive("/bagging/123", "/bagging")).toBe(true);
    expect(isNavActive("/bailout", "/bagging")).toBe(false);
  });
});

describe("resolveNavItem", () => {
  it("me-resolve judul untuk breadcrumb", () => {
    expect(resolveNavItem("/reconcile")?.title).toBe("Reconcile Validator");
    expect(resolveNavItem("/user-management")?.title).toBe("User Management");
  });

  it("memilih match terpanjang untuk nested route", () => {
    expect(resolveNavItem("/user-management/x")?.href).toBe("/user-management");
  });

  it("mengembalikan undefined untuk route tak dikenal", () => {
    expect(resolveNavItem("/entah")).toBeUndefined();
  });
});
