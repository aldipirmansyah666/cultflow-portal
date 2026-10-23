import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const state = vi.hoisted(() => ({ pathname: "/bailout" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { Header } from "./Header";
import { LayoutShell } from "./LayoutShell";

afterEach(() => {
  state.pathname = "/bailout";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Header", () => {
  it("menampilkan breadcrumb halaman aktif", () => {
    render(
      <Header collapsed={false} onToggleSidebar={() => {}} onOpenMobileNav={() => {}} />,
    );
    expect(screen.getByText("Bailout Generator")).toBeInTheDocument();
  });

  it("menampilkan badge Live, shortcut Ctrl K, dan menu pengguna", () => {
    render(
      <Header collapsed={false} onToggleSidebar={() => {}} onOpenMobileNav={() => {}} />,
    );
    expect(screen.getByRole("status", { name: /live/i })).toBeInTheDocument();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /menu pengguna/i }),
    ).toBeInTheDocument();
  });

  it("menampilkan badge dan toast usulan prefix pending untuk ADMIN", async () => {
    state.pathname = "/reconcile";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/auth/me") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ user: { name: "Admin", role: "ADMIN" } }),
          } as Response;
        }
        if (url === "/api/reconcile/prefix-suggestions") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              pendingCount: 1,
              suggestions: [
                {
                  id: "s-1",
                  productName: "PKH",
                  suggestedPrefix: "BAC",
                  sampleResi: "BAC001",
                  occurrenceCount: 1,
                  status: "pending",
                  createdAt: "2026-10-23T00:00:00Z",
                  updatedAt: "2026-10-23T01:00:00Z",
                },
              ],
            }),
          } as Response;
        }
        throw new Error(`fetch tak terduga: ${url}`);
      }),
    );

    render(
      <Header
        collapsed={false}
        onToggleSidebar={() => {}}
        onOpenMobileNav={() => {}}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: /notifikasi usulan prefix, 1 menunggu persetujuan/i,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Ada 1 usulan prefix baru \(BAC - PKH\) dari User/i,
      ),
    ).toBeInTheDocument();
  });

  it("tidak menampilkan lonceng usulan untuk USER", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/auth/me") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ user: { name: "User", role: "USER" } }),
          } as Response;
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: "Akses ditolak" }),
        } as Response;
      }),
    );

    render(
      <Header
        collapsed={false}
        onToggleSidebar={() => {}}
        onOpenMobileNav={() => {}}
      />,
    );

    expect(await screen.findByText("User")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /notifikasi usulan prefix/i }),
    ).not.toBeInTheDocument();
  });

  it("memanggil onToggleSidebar saat tombol toggle diklik", () => {
    const onToggle = vi.fn();
    render(
      <Header collapsed={false} onToggleSidebar={onToggle} onOpenMobileNav={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ciutkan sidebar/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("LayoutShell", () => {
  it("me-render konten halaman di dalam main", () => {
    render(
      <LayoutShell>
        <p>Konten uji</p>
      </LayoutShell>,
    );
    expect(screen.getByText("Konten uji")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("menampilkan watermark creator di footer", () => {
    render(
      <LayoutShell>
        <p>Konten uji</p>
      </LayoutShell>,
    );
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/Engineered by/)).toBeInTheDocument();
    expect(within(footer).getByText("Aldi Pirmansyah")).toBeInTheDocument();
  });

  it("toggle collapse mengubah label tombol", () => {
    render(
      <LayoutShell>
        <p>Konten uji</p>
      </LayoutShell>,
    );
    expect(
      screen.getByRole("button", { name: /ciutkan sidebar/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ciutkan sidebar/i }));
    expect(
      screen.getByRole("button", { name: /bentangkan sidebar/i }),
    ).toBeInTheDocument();
  });
});
