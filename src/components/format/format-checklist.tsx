"use client";

/**
 * Profile-driven checklist: results grouped by category in profile order.
 * Each group is a titled list of FormatCheckRow items.
 */

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListChecks } from "lucide-react";
import { FormatCheckRow } from "./format-check-row";
import { groupResults } from "./report-utils";
import type { CheckDefinition, CheckStatus, FormatCheckReport, OverrideMap } from "./types";

export interface FormatChecklistProps {
  report: FormatCheckReport | undefined;
  checks?: CheckDefinition[];
  overrides: OverrideMap;
  onOverride: (checkId: string, status: CheckStatus | undefined) => void;
  disabled?: boolean;
}

export function FormatChecklist({ report, checks, overrides, onOverride, disabled }: FormatChecklistProps) {
  const groups = useMemo(() => groupResults(report?.results, checks, overrides), [report?.results, checks, overrides]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-5 w-5" />
          Checklist
        </CardTitle>
        <CardDescription>
          Pre-filled from the detectors. Adjust any status; every item marked Fail goes into the letter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="checklist-empty">
            No checks to show yet. Run the checks to populate the checklist.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.category} aria-labelledby={`group-${group.category}`}>
                <h3
                  id={`group-${group.category}`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600"
                >
                  {group.label}
                  <span className="ml-2 font-normal text-gray-400">({group.rows.length})</span>
                </h3>
                <ul className="space-y-2">
                  {group.rows.map((row) => (
                    <FormatCheckRow
                      key={row.result.checkId}
                      row={row}
                      onStatusChange={onOverride}
                      disabled={disabled}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
