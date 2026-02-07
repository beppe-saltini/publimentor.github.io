"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  FileText,
  Users,
  Settings,
  Home,
  Search,
  AlertTriangle,
  CheckSquare,
  Shield,
  Upload,
  X,
  Heart,
  Wrench,
} from "lucide-react";

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

/** Extract journal slug from /dashboard/journals/[slug]/... paths */
function useJournalSlug(): string | undefined {
  const pathname = usePathname();
  const match = pathname.match(/^\/dashboard\/journals\/([^/]+)/);
  return match ? match[1] : undefined;
}

function SidebarContent({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const journalSlug = useJournalSlug();

  const mainNavItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/dashboard/manuscripts", label: "Manuscripts", icon: Upload },
    { href: "/dashboard/journals", label: "My Journals", icon: BookOpen },
    { href: "/dashboard/favourites", label: "Favourite Journals", icon: Heart },
  ];

  // Standalone tools — accessible without a journal context
  const toolNavItems = [
    { href: "/dashboard/tools/reviewers", label: "Find Reviewers", icon: Search },
    { href: "/dashboard/tools/coi", label: "COI Screening", icon: AlertTriangle },
    { href: "/dashboard/tools/integrity", label: "Integrity Check", icon: Shield },
    { href: "/dashboard/tools/format", label: "Format Check", icon: CheckSquare },
  ];

  const journalNavItems = journalSlug
    ? [
        { href: `/dashboard/journals/${journalSlug}`, label: "Overview", icon: Home },
        { href: `/dashboard/journals/${journalSlug}/submissions`, label: "Submissions", icon: FileText },
        { href: `/dashboard/journals/${journalSlug}/reviewers`, label: "Reviewer Suggestions", icon: Search },
        { href: `/dashboard/journals/${journalSlug}/coi`, label: "COI Screening", icon: AlertTriangle },
        { href: `/dashboard/journals/${journalSlug}/integrity`, label: "Integrity Screening", icon: Shield },
        { href: `/dashboard/journals/${journalSlug}/format`, label: "Format Check", icon: CheckSquare },
        { href: `/dashboard/journals/${journalSlug}/members`, label: "Members", icon: Users },
        { href: `/dashboard/journals/${journalSlug}/settings`, label: "Settings", icon: Settings },
      ]
    : [];

  return (
    <>
      <div className="mb-8 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-3" onClick={onClose}>
          <Image
            src="/logo.png"
            alt="PubliMentor"
            width={40}
            height={40}
            className="h-10 w-10"
          />
          <span className="text-lg font-bold text-[#1a3a5c]">PubliMentor</span>
        </Link>
        {/* Close button only visible on mobile */}
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Main
          </h3>
          <ul className="space-y-1">
            {mainNavItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    pathname === item.href
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Standalone Tools section — always visible */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            <Wrench className="h-3 w-3 inline mr-1" />
            Tools
          </h3>
          <ul className="space-y-1">
            {toolNavItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    pathname === item.href
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {journalNavItems.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Journal
            </h3>
            <ul className="space-y-1">
              {journalNavItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                      pathname === item.href
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </>
  );
}

/**
 * Desktop sidebar - hidden on mobile, visible on lg+
 */
export function Sidebar() {
  return (
    <aside className="hidden lg:block w-64 bg-white border-r min-h-screen p-4 flex-shrink-0">
      <SidebarContent />
    </aside>
  );
}

/**
 * Mobile sidebar - renders as a slide-over drawer on small screens
 */
export function MobileSidebar({ open, onClose }: SidebarProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <aside
        className="fixed inset-y-0 left-0 z-50 w-72 bg-white p-4 shadow-xl lg:hidden overflow-y-auto transition-transform"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <SidebarContent onClose={onClose} />
      </aside>
    </>
  );
}
