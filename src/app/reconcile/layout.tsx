import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession, isAdminSession } from "@/lib/session";

/**
 * Guard server-side untuk seluruh route /reconcile.
 *
 * Proxy hanya melakukan pengecekan optimistis dari JWT; layout ini adalah
 * otorisasi sebenarnya (getSession juga memvalidasi token_version ke DB).
 */
export default async function ReconcileLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminSession(session)) notFound();
  return children;
}
