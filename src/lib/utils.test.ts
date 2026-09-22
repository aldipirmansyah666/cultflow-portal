import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("menggabungkan class sederhana", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("mengabaikan nilai falsy", () => {
    expect(cn("px-2", false, null, undefined, "py-1")).toBe("px-2 py-1");
  });

  it("me-resolve konflik tailwind dengan tailwind-merge", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("mendukung conditional object", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });
});
