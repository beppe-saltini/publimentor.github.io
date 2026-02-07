"use client";

import { useState, useCallback } from "react";
import { Sidebar, MobileSidebar } from "./sidebar";
import { Header } from "./header";

interface DashboardShellProps {
  children: React.ReactNode;
}

/**
 * DashboardShell provides the responsive layout for the dashboard.
 * - Desktop (lg+): static sidebar + header + content
 * - Mobile (<lg): hamburger menu triggers slide-over sidebar drawer
 *
 * The sidebar auto-detects journal context from the URL pathname,
 * so there is no need to pass a journalSlug prop.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <Sidebar />
      
      {/* Mobile sidebar drawer */}
      <MobileSidebar
        open={mobileMenuOpen}
        onClose={closeMenu}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuToggle={toggleMenu} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
