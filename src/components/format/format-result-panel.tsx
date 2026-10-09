"use client";

/**
 * "Formatted manuscript" panel: what the Journal-Ready Formatter did with the
 * manuscript. Summary chips (automatic changes, items for the authors,
 * references matched), download buttons for the rebuilt .docx, the
 * tracked-changes .docx (Word sources only), the change log and the letter,
 * an expandable operations list grouped by kind with before/after snippets,
 * and the author actions the engine could not finish.
 *
 * Without a formatting block (a "Check only" run or an older report) the
 * panel shows an empty state with a "Format now" action.
 */

import { useId, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ChevronDown, ChevronRight, Download, FileDiff, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clipSnippet, groupOperations, letterFileHref, summaryChipLabels, type OperationGroup } from "./format-result-utils";
import type { FormatAuthorAction, FormatOperation, FormattingBlock } from "./types";

export interface FormatResultPanelProps {
  formatting: FormattingBlock | null | undefined;
  /** "pdf" | "docx": explains why the tracked-changes file may be missing. */
  sourceType?: string | null;
  /** Re-runs the formatting on the server (POST /api/format/reports/[id]/format). */
  onRebuild?: () => void;
  rebuilding?: boolean;
  disabled?: boolean;
  /**
   * False when the server has no source file for this report (older reports),
   * so formatting cannot be (re)run: the rebuild action is replaced by a note.
   */
  canFormat?: boolean;
}

export function FormatResultPanel({
  formatting,
  sourceType,
  onRebuild,
  rebuilding,
  disabled,
  canFormat = true,
}: FormatResultPanelProps) {
  const [operationsOpen, setOperationsOpen] = useState(false);
  const operationsId = useId();

  const noSourceNote = !canFormat ? (
    <p className="text-xs text-gray-500" data-testid="no-source-note">
      The source file of this report is not stored, so formatting cannot be run again. Run the check again
      with the manuscript file to format it.
    </p>
  ) : null;

  const rebuildButton = onRebuild && canFormat ? (
    <Button type="button" variant="outline" size="sm" onClick={onRebuild} disabled={disabled || rebuilding}>
      {rebuilding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
      {rebuilding ? "Formatting…" : formatting ? "Re-run formatting" : "Format now"}
    </Button>
  ) : null;

  if (!formatting) {
    return (
      <Card data-testid="format-result-empty">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Formatted manuscript
          </CardTitle>
          <CardDescription>
            Formatting was not run for this report. Format it to rebuild the manuscript in the journal&apos;s
            structure, repair the references on Crossref and compose the author letter.
          </CardDescription>
        </CardHeader>
        {(rebuildButton || noSourceNote) && <CardContent>{rebuildButton ?? noSourceNote}</CardContent>}
      </Card>
    );
  }

  const { summary, downloads, operations, authorActions, notes = [] } = formatting;
  const chips = summaryChipLabels(summary);
  const groups = groupOperations(operations);
  const isWord = (sourceType ?? "").toLowerCase() === "docx";

  return (
    <Card data-testid="format-result-panel">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Formatted manuscript
            </CardTitle>
            <CardDescription className="mt-1.5">
              Rebuilt in the journal&apos;s structure. Review the changes before sending the files to the authors.
            </CardDescription>
          </div>
          {rebuildButton}
        </div>
        {noSourceNote}
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="flex flex-wrap gap-2" aria-label="Formatting summary" data-testid="format-summary-chips">
          <li className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-800">
            {chips.automatic}
          </li>
          <li
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              summary.needsAuthor > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-200 bg-gray-50 text-gray-700",
            )}
          >
            {chips.needsAuthor}
          </li>
          <li
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              summary.referencesTotal > 0 && summary.referencesMatched < summary.referencesTotal
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-blue-200 bg-blue-50 text-blue-900",
            )}
          >
            {chips.references}
          </li>
        </ul>

        {notes.length > 0 && (
          <ul
            role="note"
            aria-label="Formatting notes"
            data-testid="format-notes"
            className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            {notes.map((note, index) => (
              <li key={`${index}-${note.slice(0, 24)}`}>{note}</li>
            ))}
          </ul>
        )}

        <section aria-labelledby={`${operationsId}-downloads`} className="space-y-2">
          <h3 id={`${operationsId}-downloads`} className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Downloads
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <a href={downloads.formatted} download data-testid="download-formatted">
                <Download className="h-4 w-4 mr-2" />
                Formatted manuscript (.docx)
              </a>
            </Button>
            {downloads.tracked && (
              <Button asChild variant="outline" size="sm">
                <a href={downloads.tracked} download data-testid="download-tracked">
                  <FileDiff className="h-4 w-4 mr-2" />
                  Tracked changes (.docx)
                </a>
              </Button>
            )}
            {downloads.changeLog && (
              <Button asChild variant="outline" size="sm">
                <a href={downloads.changeLog} download data-testid="download-change-log">
                  <Download className="h-4 w-4 mr-2" />
                  Change log (.txt)
                </a>
              </Button>
            )}
            {downloads.letter && (
              <>
                <Button asChild variant="outline" size="sm">
                  <a href={letterFileHref(downloads.letter, "docx")} download data-testid="download-letter-docx">
                    <Download className="h-4 w-4 mr-2" />
                    Letter (.docx)
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={letterFileHref(downloads.letter, "txt")} download data-testid="download-letter-txt">
                    <Download className="h-4 w-4 mr-2" />
                    Letter (.txt)
                  </a>
                </Button>
              </>
            )}
          </div>
          {!downloads.tracked && (
            <p className="text-xs text-gray-500" data-testid="tracked-note">
              {isWord
                ? "No tracked-changes file was produced for this run."
                : "A tracked-changes version is only available when the source is a Word (.docx) file; this manuscript was supplied as a PDF, so only the rebuilt document is offered."}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-800 hover:text-gray-950"
            aria-expanded={operationsOpen}
            aria-controls={operationsId}
            onClick={() => setOperationsOpen((open) => !open)}
            data-testid="toggle-operations"
          >
            {operationsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {operations.length} {operations.length === 1 ? "operation" : "operations"} in {groups.length}{" "}
            {groups.length === 1 ? "group" : "groups"}
          </button>
          {operationsOpen && (
            <div id={operationsId} className="space-y-4" data-testid="operations-list">
              {groups.length === 0 ? (
                <p className="text-sm text-gray-500">The engine recorded no operations.</p>
              ) : (
                groups.map((group) => <OperationGroupView key={group.kind} group={group} />)
              )}
            </div>
          )}
        </section>

        <section aria-labelledby={`${operationsId}-actions`} className="space-y-2">
          <h3 id={`${operationsId}-actions`} className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            For the authors
            <span className="ml-2 font-normal text-gray-400">({authorActions.length})</span>
          </h3>
          {authorActions.length === 0 ? (
            <p className="text-sm text-gray-500" data-testid="author-actions-empty">
              Nothing is left for the authors; every change was applied automatically.
            </p>
          ) : (
            <ul className="space-y-1.5" aria-label="Author actions">
              {authorActions.map((action, index) => (
                <AuthorActionRow key={`${index}-${action.text.slice(0, 24)}`} action={action} />
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function OperationGroupView({ group }: { group: OperationGroup }) {
  return (
    <section aria-label={group.label}>
      <h4 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {group.label}
        <span className="font-normal text-gray-400">({group.operations.length})</span>
        {group.needsAuthor > 0 && (
          <Badge variant="outline" className="font-normal normal-case tracking-normal text-amber-800 border-amber-200">
            {group.needsAuthor} for the authors
          </Badge>
        )}
      </h4>
      <ul className="space-y-1.5">
        {group.operations.map((op) => (
          <OperationRow key={op.id} operation={op} />
        ))}
      </ul>
    </section>
  );
}

function OperationRow({ operation }: { operation: FormatOperation }) {
  const before = clipSnippet(operation.before);
  const after = clipSnippet(operation.after);
  return (
    <li
      data-operation-id={operation.id}
      data-automatic={operation.automatic ? "true" : "false"}
      className={cn(
        "rounded-md border border-gray-200 border-l-4 bg-white p-2.5 space-y-1.5",
        operation.automatic ? "border-l-green-500" : "border-l-amber-500",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-gray-900 min-w-0 flex-1">{operation.description}</p>
        <Badge variant={operation.automatic ? "secondary" : "outline"} className={operation.automatic ? "" : "text-amber-800 border-amber-200"}>
          {operation.automatic ? "Automatic" : "Needs the authors"}
        </Badge>
      </div>
      {(before || after) && (
        <div className="grid gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
          {before ? (
            <q className="block rounded border border-red-100 bg-red-50 px-2 py-1 text-red-900 not-italic" data-snippet="before">
              {before}
            </q>
          ) : (
            <span className="hidden sm:block" aria-hidden="true" />
          )}
          <ArrowRight className="hidden h-3.5 w-3.5 mt-1.5 text-gray-400 sm:block" aria-hidden="true" />
          {after && (
            <q className="block rounded border border-green-100 bg-green-50 px-2 py-1 text-green-900 not-italic" data-snippet="after">
              {after}
            </q>
          )}
        </div>
      )}
      {operation.needsAuthorInput && (
        <p className="text-xs text-amber-800">
          <span className="font-semibold">In the letter: </span>
          {operation.needsAuthorInput}
        </p>
      )}
    </li>
  );
}

function AuthorActionRow({ action }: { action: FormatAuthorAction }) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-1.5 text-sm text-gray-800">
      <span className="flex-1 min-w-0">{action.text}</span>
      <Badge
        variant="outline"
        className="shrink-0 font-normal"
        title={action.origin === "check" ? "From a failing check in the report" : "The formatter could not complete this step"}
      >
        {action.origin === "check" ? "Check" : "Formatter"}
      </Badge>
    </li>
  );
}
