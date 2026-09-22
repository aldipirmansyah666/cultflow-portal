import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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
