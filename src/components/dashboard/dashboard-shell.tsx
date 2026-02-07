"use client";

import { useState, useCallback } from "react";
import { Sidebar, MobileSidebar } from "./sidebar";
import { Header } from "./header";

interface DashboardShellProps {
  journalSlug?: string;
  children: React.ReactNode;
}

/**
 * DashboardShell provides the responsive layout for the dashboard.
 * - Desktop (lg+): static sidebar + header + content
 * - Mobile (<lg): hamburger menu triggers slide-over sidebar drawer
 */
export function DashboardShell({ journalSlug, children }: DashboardShellProps) {
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
      <Sidebar journalSlug={journalSlug} />
      
      {/* Mobile sidebar drawer */}
      <MobileSidebar
        journalSlug={journalSlug}
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
