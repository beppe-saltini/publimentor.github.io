"use client";

import { usePathname } from "next/navigation";
import { DashboardShell } from "./dashboard-shell";

interface DashboardNestedLayoutProps {
  children: React.ReactNode;
}

/**
 * Wraps dashboard routes in the full shell except simplified editor routes.
 */
export function DashboardNestedLayout({ children }: DashboardNestedLayoutProps) {
  const pathname = usePathname();
  const isEditorRoute = pathname?.startsWith("/dashboard/editor");

  if (isEditorRoute) {
    return <>{children}</>;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
