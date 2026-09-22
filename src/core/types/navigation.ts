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
  { title: "Bagging Generator", href: "/bagging", icon: "Package" },
  { title: "Bailout Generator", href: "/bailout", icon: "PackageOpen" },
  { title: "Reconcile Validator", href: "/reconcile", icon: "Scale" },
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
 * Saring menu sidebar berdasarkan role sesi.
 * Item tanpa `roles` selalu tampil; item ber-`roles` hanya tampil bila
 * role cocok. Role tak dikenal (tamu) tidak melihat menu terbatas —
 * mis. USER tak melihat "User Management".
 */
export function filterNavByRole(
  items: NavItem[],
  role?: string | null
): NavItem[] {
  return items.filter(
    (item) =>
      item.roles == null ||
      item.roles.length === 0 ||
      (role != null && item.roles.includes(role))
  );
}
