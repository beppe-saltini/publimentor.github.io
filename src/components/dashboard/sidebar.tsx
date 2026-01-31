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
} from "lucide-react";

interface SidebarProps {
  journalSlug?: string;
}

export function Sidebar({ journalSlug }: SidebarProps) {
  const pathname = usePathname();

  const mainNavItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/dashboard/manuscripts", label: "Manuscripts", icon: Upload },
    { href: "/dashboard/journals", label: "My Journals", icon: BookOpen },
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
    <aside className="w-64 bg-white border-r min-h-screen p-4">
      <div className="mb-8">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="PubliMentor"
            width={40}
            height={40}
            className="h-10 w-10"
          />
          <span className="text-lg font-bold text-[#1a3a5c]">PubliMentor</span>
        </Link>
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
    </aside>
  );
}
