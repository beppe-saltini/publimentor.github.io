"use client";

import { ExternalLink, Search, UserX } from "lucide-react";
import type { DeceasedCheck } from "@/lib/reviewers/deceased-check";

interface DeceasedNoticeProps {
  check: DeceasedCheck;
  className?: string;
}

export function DeceasedNotice({ check, className = "" }: DeceasedNoticeProps) {
  if (!check.possiblyDeceased) return null;

  return (
    <div className={`rounded-md border border-slate-300 bg-slate-100 p-2 text-xs ${className}`}>
      <div className="flex items-start gap-1.5 mb-1.5">
        <UserX className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-600" />
        <p className="font-medium text-slate-800">Possibly deceased</p>
      </div>
      <a
        href={check.searchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-5 text-blue-600 hover:underline inline-flex items-center gap-1"
      >
        <Search className="h-3 w-3" />
        See the Google search behind this flag
        <ExternalLink className="h-3 w-3" />
      </a>
      {check.evidence.length > 0 && (
        <ul className="space-y-1 ml-5 mt-1.5">
          {check.evidence.slice(0, 3).map((e, i) => (
            <li key={`${e.url}-${i}`}>
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                {e.title || e.url}
                <ExternalLink className="h-3 w-3" />
              </a>
              {e.snippet && <p className="text-gray-500 line-clamp-2 mt-0.5">{e.snippet}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-gray-400 mt-1.5 italic">{check.disclaimer}</p>
    </div>
  );
}
