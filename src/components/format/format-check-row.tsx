"use client";

/**
 * One checklist row: the editor question, the status control (pre-set from
 * the detector result, editable as an override), detector/confidence badges,
 * the summary line, expandable evidence quotes and the author phrase that
 * would go in the letter when the row fails.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, ChevronDown, ChevronRight, Hand, RotateCcw, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusControl } from "./status-control";
import { phraseFor, type ChecklistRow } from "./report-utils";
import { STATUS_LABELS, type CheckStatus } from "./types";

export interface FormatCheckRowProps {
  row: ChecklistRow;
  onStatusChange: (checkId: string, status: CheckStatus | undefined) => void;
  disabled?: boolean;
}

const DETECTOR_META = {
  rule: { label: "Rule", Icon: Ruler, title: "Detected by a deterministic rule" },
  llm: { label: "AI", Icon: Bot, title: "Assessed by the AI reviewer" },
  manual: { label: "Manual", Icon: Hand, title: "Needs a manual decision by the editor" },
} as const;

const STATUS_BORDER: Record<CheckStatus, string> = {
  pass: "border-l-green-500",
  fail: "border-l-red-500",
  review: "border-l-amber-500",
  not_applicable: "border-l-gray-300",
  unknown: "border-l-gray-300",
};

export function FormatCheckRow({ row, onStatusChange, disabled }: FormatCheckRowProps) {
  const { result, definition, status, overridden } = row;
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidence = result.evidence ?? [];
  const question = definition?.question ?? result.summary ?? result.checkId;
  const detector = DETECTOR_META[result.detector ?? "rule"] ?? DETECTOR_META.rule;
  const phrase = phraseFor(result, definition);
  const evidenceId = `evidence-${result.checkId}`;

  return (
    <li
      data-check-id={result.checkId}
      data-status={status}
      className={cn("rounded-md border border-gray-200 border-l-4 bg-white p-3 space-y-2", STATUS_BORDER[status])}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{question}</p>
          {definition?.question && result.summary && (
            <p className="text-sm text-gray-600 mt-0.5">{result.summary}</p>
          )}
          {definition?.guideline && (
            <p className="text-xs text-gray-500 mt-1">{definition.guideline}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge variant="outline" title={detector.title} className="gap-1">
            <detector.Icon aria-hidden="true" />
            {detector.label}
          </Badge>
          {result.confidence && (
            <Badge variant="secondary" title="Detector confidence">
              {result.confidence} confidence
            </Badge>
          )}
          {status === "unknown" && !overridden && <Badge variant="secondary">{STATUS_LABELS.unknown}</Badge>}
          <StatusControl
            value={status}
            onChange={(next) => onStatusChange(result.checkId, next)}
            label={`Status for: ${question}`}
            disabled={disabled}
          />
          {overridden && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Reset status to detected (${STATUS_LABELS[result.status]})`}
              title={`Detected: ${STATUS_LABELS[result.status]}`}
              onClick={() => onStatusChange(result.checkId, undefined)}
              disabled={disabled}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {evidence.length > 0 && (
        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
            aria-expanded={evidenceOpen}
            aria-controls={evidenceId}
            onClick={() => setEvidenceOpen((open) => !open)}
          >
            {evidenceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {evidence.length} evidence {evidence.length === 1 ? "quote" : "quotes"}
          </button>
          {evidenceOpen && (
            <ul id={evidenceId} className="mt-2 space-y-1.5">
              {evidence.map((item, index) => (
                <li
                  key={`${result.checkId}-ev-${index}`}
                  className="rounded border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700"
                >
                  <q className="italic">{item.quote}</q>
                  {item.location && <span className="ml-2 text-gray-500 not-italic">({item.location})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Without a catalog the phrase can fall back to the summary already shown above; skip the duplicate. */}
      {status === "fail" && phrase !== question && (
        <p className="text-xs text-gray-700 bg-red-50 border border-red-100 rounded px-2.5 py-1.5">
          <span className="font-semibold text-red-700">In the letter: </span>
          {phrase}
        </p>
      )}
      {status !== "fail" && (definition?.phrase || result.letterPhrase) && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer select-none">Letter phrase if this fails</summary>
          <p className="mt-1 text-gray-600">{phrase}</p>
        </details>
      )}
    </li>
  );
}
