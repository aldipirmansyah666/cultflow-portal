import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * Guard server-side untuk seluruh route /reconcile.
 *
 * Semua role yang login boleh masuk. Proxy hanya melakukan pengecekan
 * optimistis dari JWT; layout ini adalah otorisasi sebenarnya (getSession
 * juga memvalidasi token_version ke DB).
 */
export default async function ReconcileLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  return children;
}
