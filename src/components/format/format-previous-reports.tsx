"use client";

/**
 * "Previous reports" list for the selected manuscript (GET /api/format/reports).
 * Clicking a row reopens the saved report with its overrides and letter text.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "./report-utils";
import type { ReportListItem } from "./types";

export interface FormatPreviousReportsProps {
  reports: ReportListItem[];
  loading: boolean;
  activeReportId: string | null;
  onOpen: (reportId: string) => void;
  disabled?: boolean;
  hasManuscript: boolean;
}

export function FormatPreviousReports({
  reports,
  loading,
  activeReportId,
  onOpen,
  disabled,
  hasManuscript,
}: FormatPreviousReportsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Previous reports
        </CardTitle>
        <CardDescription>Saved checks for the selected manuscript.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasManuscript ? (
          <p className="text-sm text-gray-500">Select a manuscript to see its saved reports.</p>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading reports…
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="previous-reports-empty">
            No saved reports yet.
          </p>
        ) : (
          <ul className="space-y-1.5" aria-label="Previous reports">
            {reports.map((item) => {
              const active = item.id === activeReportId;
              const fails = item.summary?.fail;
              return (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onOpen(item.id)}
                    className={cn(
                      "w-full justify-between h-auto py-2 px-3 text-left",
                      active && "bg-gray-100",
                    )}
                  >
                    <span className="flex flex-col items-start">
                      <span className="text-sm text-gray-900">{formatDateTime(item.checkedAt) || item.id}</span>
                      <span className="text-xs text-gray-500">{item.profileId}</span>
                    </span>
                    {typeof fails === "number" && (
                      <Badge variant={fails > 0 ? "destructive" : "secondary"}>
                        {fails} fail{fails === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
