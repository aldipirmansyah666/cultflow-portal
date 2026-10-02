/**
 * Tipe item navigasi sidebar.
 *
 * `icon` menyimpan *nama* ikon Lucide (bukan komponennya) agar definisi
 * menu tetap serializable dan mudah dikelola dari satu tempat.
 * Daftar nama valid dipetakan ke komponen di `Sidebar` via `NAV_ICONS`.
 */
export interface NavItem {
  title: string;
  href: string;
  icon: string;
  badge?: string | number;
  roles?: string[];
}

/**
 * Menu utama portal. Urutan di sini = urutan tampil di Sidebar.
 * `roles` yang terisi berarti menu hanya untuk role tersebut
 * (filtering diterapkan saat auth tersedia).
 */
export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { title: "Data Lengkap Utama", href: "/data-utama", icon: "Database" },
  { title: "Lookup Profil Agen", href: "/lookup-agen", icon: "Search" },
  { title: "Monitoring Resi", href: "/monitoring-resi", icon: "PackageSearch" },
  { title: "Bagging Generator", href: "/bagging", icon: "Package" },
  { title: "Bailout Generator", href: "/bailout", icon: "PackageOpen" },
  { title: "Reconcile Validator", href: "/reconcile", icon: "Scale" },
  { title: "Rekap Fee Loket", href: "/fee-rekap", icon: "Wallet" },
  { title: "WA Logs", href: "/logs", icon: "MessagesSquare" },
  {
    title: "User Management",
    href: "/user-management",
    icon: "Users",
    roles: ["ADMIN"],
  },
];

/** true bila `pathname` berada di bawah route `href` (`/` hanya cocok persis). */
export function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Cari item menu yang paling cocok untuk `pathname` (untuk breadcrumb/header). */
export function resolveNavItem(pathname: string): NavItem | undefined {
  return [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isNavActive(pathname, item.href));
}

/**
 * Saring menu sidebar berdasarkan role sesi — case-insensitive.
 * Item tanpa `roles` selalu tampil; item ber-`roles` hanya tampil bila
 * role cocok setelah di-UPPER-case + trim di kedua sisi.
 * "ADMIN", "admin", " Admin " semuanya melihat "User Management".
 */
export function filterNavByRole(
  items: NavItem[],
  role?: string | null
): NavItem[] {
  const normalizedRole =
    typeof role === "string" ? role.trim().toUpperCase() : null;
  return items.filter((item) => {
    if (item.roles == null || item.roles.length === 0) return true;
    if (normalizedRole == null) return false;
    return item.roles.some(
      (r) => typeof r === "string" && r.trim().toUpperCase() === normalizedRole
    );
  });
}

/** True bila role adalah ADMIN (helper presentasi, case-insensitive). */
export function isAdminNavRole(role: unknown): boolean {
  return typeof role === "string" && role.trim().toUpperCase() === "ADMIN";
}
