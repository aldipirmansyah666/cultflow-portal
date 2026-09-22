import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NAV_ITEMS } from "@/core/types/navigation";

const state = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
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

import { MobileSidebar, Sidebar } from "./Sidebar";

beforeEach(() => {
  state.pathname = "/";
});

describe("Sidebar", () => {
  it("me-render semua 8 menu utama untuk ADMIN", () => {
    render(<Sidebar collapsed={false} role="ADMIN" />);
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole("link", { name: new RegExp(item.title) })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("menyembunyikan User Management untuk USER dan tamu", () => {
    for (const role of ["USER", null, undefined] as const) {
      const { unmount } = render(<Sidebar collapsed={false} role={role} />);
      expect(
        screen.queryByRole("link", { name: /User Management/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Data Lengkap Utama/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("menandai halaman aktif dengan aria-current", () => {
    state.pathname = "/bagging";
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("link", { name: /Bagging Generator/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: /Bailout Generator/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("menandai menu aktif dengan slate-900 kontras tinggi", () => {
    state.pathname = "/bagging";
    render(<Sidebar collapsed={false} />);
    expect(
      screen.getByRole("link", { name: /Bagging Generator/ }),
    ).toHaveClass("bg-slate-900", "text-white");
  });

  it("menyembunyikan label saat collapsed", () => {
    render(<Sidebar collapsed={true} />);
    expect(screen.queryByText("Bagging Generator")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bagging Generator" })).toBeInTheDocument();
  });

  it("me-render logo CultFlow sebagai gambar", () => {
    render(<Sidebar collapsed={false} />);
    const logo = screen.getByAltText("CultFlow Logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", expect.stringContaining("cultflow-icon.png"));
  });

  it("me-render kartu creator Aldi Pirmansyah", () => {
    render(<Sidebar collapsed={false} />);
    expect(screen.getByText("CultFlow Engine v2.0")).toBeInTheDocument();
    expect(screen.getByText("Aldi Pirmansyah")).toBeInTheDocument();
  });

  it("menampilkan inisial AP saat collapsed", () => {
    render(<Sidebar collapsed={true} />);
    expect(screen.getByLabelText(/Built by Aldi Pirmansyah/)).toBeInTheDocument();
  });
});

describe("MobileSidebar", () => {
  it("me-render menu navigasi", () => {
    render(<MobileSidebar open={true} onClose={() => {}} />);
    expect(
      screen.getByRole("link", { name: /Reconcile Validator/ }),
    ).toHaveAttribute("href", "/reconcile");
  });
});
