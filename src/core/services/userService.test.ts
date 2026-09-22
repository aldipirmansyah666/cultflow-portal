import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateUser,
  countUsers,
  createUser,
  deleteUser,
  findUserByUsername,
  getUsers,
  normalizeRole,
  toSafeUser,
  updateUser,
  type DbUser,
} from "./userService";

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  "0123456789abcdef0123456789abcdef-test-only";

const ADMIN_ROW: DbUser = {
  id: "id-admin",
  name: "Administrator",
  username: "admin",
  password: "$2b$10$abcdefghijklmnopqrstuuTESTHASH",
  role: "ADMIN",
  created_at: "2026-01-01T00:00:00Z",
};

/** Fake rantai query minimal (select/eq/limit/order/single/insert/update/delete). */
function fakeClient(
  handler: (op: string, table: string, payload?: unknown) => unknown
): SupabaseClient {
  const listChain = (): unknown => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.limit = () => chain;
    chain.order = () => chain;
    chain.select = () => chain;
    chain.single = () => handler("single", "");
    chain.then = (
      resolve: (v: unknown) => void,
      reject?: (e: unknown) => void
    ) => {
      try {
        resolve(handler("list", ""));
      } catch (e) {
        reject?.(e);
      }
    };
    return chain;
  };
  const tableFn = (_table: string) => ({
    select: () => listChain(),
    insert: (payload: unknown) => {
      const res = handler("insert", "", payload);
      return {
        select: () => ({
          single: () => res,
        }),
      };
    },
    update: (payload: unknown) => ({
      eq: () => handler("update-eq", "", payload),
    }),
    delete: () => ({
      eq: () => handler("delete-eq", ""),
    }),
  });
  return { from: tableFn } as unknown as SupabaseClient;
}

describe("normalizeRole / toSafeUser", () => {
  it("hanya ADMIN yang lolos, password dibuang", () => {
    expect(normalizeRole("ADMIN")).toBe("ADMIN");
    expect(normalizeRole("admin")).toBe("USER");
    expect(normalizeRole(undefined)).toBe("USER");
    expect(toSafeUser(ADMIN_ROW)).toEqual({
      id: "id-admin",
      name: "Administrator",
      username: "admin",
      role: "ADMIN",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect("password" in toSafeUser(ADMIN_ROW)).toBe(false);
  });
});

describe("getUsers / findUserByUsername / countUsers", () => {
  it("getUsers mengembalikan baris + order menaik", async () => {
    const seen: string[] = [];
    const client = fakeClient((op) => {
      seen.push(op);
      if (op === "list") return { data: [ADMIN_ROW], error: null };
      throw new Error(`op tak terduga: ${op}`);
    });
    expect(await getUsers(client)).toEqual([ADMIN_ROW]);
    expect(seen).toContain("list");
  });

  it("findUserByUsername null bila kosong; error dilempar", async () => {
    const empty = fakeClient(() => ({ data: [], error: null }));
    expect(await findUserByUsername(empty, "x")).toBeNull();

    const failing = fakeClient(() => ({
      data: null,
      error: { message: "db down" },
    }));
    await expect(findUserByUsername(failing, "x")).rejects.toThrow(
      "Gagal mencari user"
    );
  });

  it("countUsers memakai head-count", async () => {
    const client = fakeClient((op) => {
      if (op === "list") return { data: [], count: 7, error: null };
      throw new Error(`op tak terduga: ${op}`);
    });
    expect(await countUsers(client)).toBe(7);
  });
});

describe("createUser / updateUser / deleteUser", () => {
  it("createUser sukses + 23505 dipetakan", async () => {
    const ok = fakeClient((op) => {
      if (op === "insert") return { data: ADMIN_ROW, error: null };
      throw new Error(`op tak terduga: ${op}`);
    });
    expect(
      await createUser(ok, {
        name: "N",
        username: "u",
        passwordHash: "h",
        role: "USER",
      })
    ).toEqual(ADMIN_ROW);

    const dupe = fakeClient(() => ({
      data: null,
      error: { code: "23505", message: "dup" },
    }));
    await expect(
      createUser(dupe, { name: "N", username: "u", passwordHash: "h", role: "USER" })
    ).rejects.toThrow("Username sudah digunakan");
  });

  it("updateUser menolak patch kosong; deleteUser melempar saat error", async () => {
    const ok = fakeClient(() => ({ data: null, error: null }));
    await expect(updateUser(ok, "id-1", {})).rejects.toThrow(
      "Tidak ada perubahan"
    );
    await updateUser(ok, "id-1", { role: "ADMIN" });
    await deleteUser(ok, "id-1");

    const failing = fakeClient(() => ({
      data: null,
      error: { message: "boom" },
    }));
    await expect(deleteUser(failing, "id-1")).rejects.toThrow(
      "Gagal menghapus user"
    );
  });
});

describe("authenticateUser", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sukses + flag rehash untuk hash legacy", async () => {
    const { hashPassword } = await import("@/lib/password");
    const bcryptHash = await hashPassword("benar123");
    const client = fakeClient((op) => {
      if (op === "list")
        return {
          data: [{ ...ADMIN_ROW, password: bcryptHash }],
          error: null,
        };
      throw new Error(`op tak terduga: ${op}`);
    });
    const ok = await authenticateUser(client, "admin", "benar123");
    expect(ok?.user.username).toBe("admin");
    expect(ok?.needsRehash).toBe(false);
    expect("password" in (ok?.user ?? {})).toBe(false);

    const legacy = fakeClient((op) => {
      if (op === "list")
        return {
          data: [{ ...ADMIN_ROW, password: "plc$salt$" }],
          error: null,
        };
      throw new Error(`op tak terduga: ${op}`);
    });
    // hash "salt$" invalid -> verify false -> null (tanpa bocor)
    expect(await authenticateUser(legacy, "admin", "x")).toBeNull();
  });

  it("null untuk user tak ada / password salah", async () => {
    const empty = fakeClient(() => ({ data: [], error: null }));
    expect(await authenticateUser(empty, "ghost", "x")).toBeNull();

    const { hashPassword } = await import("@/lib/password");
    const bcryptHash = await hashPassword("benar123");
    const client = fakeClient((op) => {
      if (op === "list")
        return { data: [{ ...ADMIN_ROW, password: bcryptHash }], error: null };
      throw new Error(`op tak terduga: ${op}`);
    });
    expect(await authenticateUser(client, "admin", "salah")).toBeNull();
  });
});
