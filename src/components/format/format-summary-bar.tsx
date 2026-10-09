"use client";

/**
 * Summary strip above the checklist: total / pass / fail / review / N/A /
 * unknown counts (after overrides) plus the number of letter items and the
 * manuscript statistics the API reported.
 */

import { cn } from "@/lib/utils";
import type { StatusCounts } from "./report-utils";
import type { FormatCheckReport, ManuscriptInfo, ProfileInfo } from "./types";

export interface FormatSummaryBarProps {
  counts: StatusCounts;
  report?: FormatCheckReport;
  manuscript?: ManuscriptInfo | null;
  profile?: ProfileInfo | null;
}

const TILES: Array<{ key: keyof StatusCounts; label: string; className: string }> = [
  { key: "total", label: "Total", className: "bg-gray-50 text-gray-900" },
  { key: "pass", label: "Pass", className: "bg-green-50 text-green-800" },
  { key: "fail", label: "Fail", className: "bg-red-50 text-red-800" },
  { key: "review", label: "Review", className: "bg-amber-50 text-amber-800" },
  { key: "not_applicable", label: "N/A", className: "bg-gray-50 text-gray-600" },
  { key: "unknown", label: "Unknown", className: "bg-gray-50 text-gray-600" },
];

export function FormatSummaryBar({ counts, report, manuscript, profile }: FormatSummaryBarProps) {
  const stats = report?.stats;
  const details: string[] = [];
  if (manuscript?.title) details.push(manuscript.title);
  if (typeof stats?.wordCount === "number" || typeof manuscript?.wordCount === "number") {
    details.push(`${(stats?.wordCount ?? manuscript?.wordCount ?? 0).toLocaleString()} words`);
  }
  const pages = stats?.pageCount ?? manuscript?.pageCount;
  if (typeof pages === "number") details.push(`${pages} pages`);
  if (typeof stats?.referenceCount === "number") details.push(`${stats.referenceCount} references`);
  if (typeof stats?.figureLegendCount === "number") details.push(`${stats.figureLegendCount} figure legends`);
  const sourceType = stats?.sourceType ?? manuscript?.sourceType;
  if (sourceType) details.push(sourceType.toUpperCase());

  return (
    <section aria-label="Check summary" className="space-y-2" data-testid="summary-bar">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {TILES.map((tile) => (
          <div key={tile.key} className={cn("rounded-md border border-gray-200 px-3 py-2 text-center", tile.className)}>
            <div className="text-lg font-semibold leading-tight">{counts[tile.key]}</div>
            <div className="text-xs">{tile.label}</div>
          </div>
        ))}
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center text-blue-900">
          <div className="text-lg font-semibold leading-tight">{counts.letterItems}</div>
          <div className="text-xs">{counts.letterItems === 1 ? "item in the letter" : "items in the letter"}</div>
        </div>
      </div>
      {(details.length > 0 || profile) && (
        <p className="text-xs text-gray-500">
          {profile && (
            <span>
              Profile: <span className="font-medium text-gray-700">{profile.name}</span> v{profile.version}
            </span>
          )}
          {profile && details.length > 0 && <span> · </span>}
          {details.join(" · ")}
        </p>
      )}
    </section>
  );
}
