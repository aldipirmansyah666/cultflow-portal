/**
 * Corporate portal PT. Cipta Usaha Makmur — RBAC + mock Users collection.
 *
 * Layer aditif di atas `core/types/navigation.ts` (yang dipertahankan
 * apa adanya agar tes eksisting tidak rusak). Sidebar me-render
 * NAV_ITEMS legacy + CORPORATE_NAV di bawahnya.
 */

export type CorporateRole =
  | "Super Admin"
  | "Deposit Staff"
  | "Helpdesk Agent"
  | "Logistics Courier"
  | "HR Staff";

export type CorporateUserStatus = "active" | "suspended" | "offboarded";

/** Skema koleksi 'Users' portal korporat. */
export interface CorporateUser {
  id: string;
  full_name: string;
  email: string;
  role: CorporateRole;
  avatar_url: string | null;
  status: CorporateUserStatus;
}

export interface CorporateNavItem {
  title: string;
  href: string;
  icon: string;
  desc: string;
  roles: CorporateRole[];
}

/** 5 menu sidebar korporat. Dashboard terlihat semua role. */
export const CORPORATE_NAV: CorporateNavItem[] = [
  {
    title: "Dashboard Overview",
    href: "/",
    icon: "LayoutDashboard",
    desc: "Ringkasan lintas divisi",
    roles: [
      "Super Admin",
      "Deposit Staff",
      "Helpdesk Agent",
      "Logistics Courier",
      "HR Staff",
    ],
  },
  {
    title: "Tim Deposit & Float",
    href: "/deposit-float",
    icon: "Wallet",
    desc: "Monitor float & likuiditas agen",
    roles: ["Super Admin", "Deposit Staff"],
  },
  {
    title: "Call Center & Support",
    href: "/support",
    icon: "Headset",
    desc: "Tiket helpdesk & SLA",
    roles: ["Super Admin", "Helpdesk Agent"],
  },
  {
    title: "Kurir & Logistik",
    href: "/logistik",
    icon: "Truck",
    desc: "Armada, resi & bagging",
    roles: ["Super Admin", "Logistics Courier"],
  },
  {
    title: "HR & Management",
    href: "/hr",
    icon: "Users",
    desc: "Karyawan, cuti & kinerja",
    roles: ["Super Admin", "HR Staff"],
  },
];

/** Mock users untuk toggle login pengujian (satu per role). */
export const CORPORATE_MOCK_USERS: CorporateUser[] = [
  {
    id: "u-super-admin",
    full_name: "Aldi Pirmansyah",
    email: "superadmin@cum.co.id",
    role: "Super Admin",
    avatar_url: null,
    status: "active",
  },
  {
    id: "u-deposit",
    full_name: "Sinta Deposit",
    email: "deposit@cum.co.id",
    role: "Deposit Staff",
    avatar_url: null,
    status: "active",
  },
  {
    id: "u-helpdesk",
    full_name: "Budi Helpdesk",
    email: "helpdesk@cum.co.id",
    role: "Helpdesk Agent",
    avatar_url: null,
    status: "active",
  },
  {
    id: "u-courier",
    full_name: "Agus Kurir",
    email: "kurir@cum.co.id",
    role: "Logistics Courier",
    avatar_url: null,
    status: "active",
  },
  {
    id: "u-hr",
    full_name: "Rina HR",
    email: "hr@cum.co.id",
    role: "HR Staff",
    avatar_url: null,
    status: "active",
  },
];

export const MOCK_ROLE_STORAGE_KEY = "cum:mock-role";

export function isCorporateRole(value: unknown): value is CorporateRole {
  return (
    value === "Super Admin" ||
    value === "Deposit Staff" ||
    value === "Helpdesk Agent" ||
    value === "Logistics Courier" ||
    value === "HR Staff"
  );
}

/** true bila role boleh membuka href korporat. */
export function canAccessCorporate(
  role: CorporateRole | null | undefined,
  href: string,
): boolean {
  const item = CORPORATE_NAV.find((n) => n.href === href);
  if (!item) return false;
  if (!role) return false;
  return item.roles.includes(role);
}

/** Saring menu korporat berdasarkan role (null = hanya yang publik, di sini kosong). */
export function filterCorporateNavByRole(
  role: CorporateRole | null | undefined,
): CorporateNavItem[] {
  if (!role) return [];
  return CORPORATE_NAV.filter((item) => item.roles.includes(role));
}

/** Cari mock user berdasarkan role. */
export function mockUserForRole(role: CorporateRole): CorporateUser {
  const found = CORPORATE_MOCK_USERS.find((u) => u.role === role);
  return found ?? CORPORATE_MOCK_USERS[0]!;
}

/** Inisial avatar dari nama lengkap (maks 2 huruf). */
export function corporateInitials(fullName: string): string {
  return (
    fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}
