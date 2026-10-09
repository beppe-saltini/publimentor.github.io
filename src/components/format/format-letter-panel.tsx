"use client";

/**
 * Letter panel: the author letter, editable, with Copy, Download (.docx /
 * .txt from the saved report) and Save (PATCH overrides + letter text).
 *
 * Two sources feed the text: the live assembly from the checklist (preamble +
 * "* " items for every failing check after overrides) or, when the formatter
 * ran, the composed letter (plan actions + failing checks + closing). In the
 * composed case "Rebuild" re-runs the formatting on the server
 * (POST /api/format/reports/[id]/format) and refreshes the text.
 */

import { useId } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Download, Loader2, Mail, RefreshCw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { letterFileHref } from "./format-result-utils";

export interface FormatLetterPanelProps {
  reportId: string | null;
  letterText: string;
  itemCount: number;
  /** True when the editor typed into the letter (it no longer tracks the source). */
  edited: boolean;
  /** True when overrides or the letter differ from what is saved on the server. */
  dirty: boolean;
  saving: boolean;
  onLetterChange: (text: string) => void;
  onResetLetter: () => void;
  onSave: () => void;
  /** True when the text comes from the formatter's composed letter. */
  composed?: boolean;
  /** Base download URL from the formatting block ("/api/format/reports/{id}/file?kind=letter"). */
  letterDownloadBase?: string | null;
  /** Re-runs the formatting and refreshes the composed letter. */
  onRebuild?: () => void;
  rebuilding?: boolean;
}

export function letterDownloadHref(reportId: string, format: "docx" | "txt"): string {
  return `/api/format/reports/${encodeURIComponent(reportId)}/letter?format=${format}`;
}

export function FormatLetterPanel({
  reportId,
  letterText,
  itemCount,
  edited,
  dirty,
  saving,
  onLetterChange,
  onResetLetter,
  onSave,
  composed = false,
  letterDownloadBase,
  onRebuild,
  rebuilding = false,
}: FormatLetterPanelProps) {
  const textareaId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letterText);
      toast.success("Letter copied to clipboard");
    } catch {
      toast.error("Could not copy the letter. Select the text and copy it manually.");
    }
  };

  const href = (format: "docx" | "txt") =>
    letterDownloadBase ? letterFileHref(letterDownloadBase, format) : reportId ? letterDownloadHref(reportId, format) : null;

  const description = composed
    ? itemCount === 0
      ? "Composed by the formatter: nothing is left for the authors, so the letter only reports the automatic changes."
      : `Composed by the formatter: ${itemCount} ${itemCount === 1 ? "item" : "items"} for the authors plus the automatic changes.`
    : itemCount === 0
      ? "No items are marked Fail; the letter contains only the preamble."
      : `${itemCount} ${itemCount === 1 ? "item" : "items"} assembled from the checks marked Fail.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Letter to the authors
        </CardTitle>
        <CardDescription data-testid="letter-description">
          {description}
          {edited &&
            (composed
              ? " You have edited the text; Rebuild replaces it with a fresh composed letter."
              : " You have edited the text, so it no longer follows the checklist automatically.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={textareaId}>Letter text</Label>
          <Textarea
            id={textareaId}
            value={letterText}
            onChange={(event) => onLetterChange(event.target.value)}
            className="min-h-[18rem] font-mono text-xs leading-relaxed"
            spellCheck
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!letterText}>
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          {edited && !composed && (
            <Button type="button" variant="outline" size="sm" onClick={onResetLetter}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Rebuild from checklist
            </Button>
          )}
          {edited && composed && (
            <Button type="button" variant="outline" size="sm" onClick={onResetLetter}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Undo edits
            </Button>
          )}
          {composed && onRebuild && (
            <Button type="button" variant="outline" size="sm" onClick={onRebuild} disabled={rebuilding || saving}>
              {rebuilding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {rebuilding ? "Rebuilding…" : "Rebuild"}
            </Button>
          )}
          {reportId ? (
            <>
              <Button asChild variant="outline" size="sm">
                <a href={href("docx") ?? undefined} download data-testid="download-docx">
                  <Download className="h-4 w-4 mr-2" />
                  Download .docx
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={href("txt") ?? undefined} download data-testid="download-txt">
                  <Download className="h-4 w-4 mr-2" />
                  Download .txt
                </a>
              </Button>
            </>
          ) : (
            <span className="text-xs text-gray-500">Run the checks to enable downloads.</span>
          )}
          <Button type="button" size="sm" onClick={onSave} disabled={!reportId || saving || !dirty} className="ml-auto">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </div>
        {reportId && dirty && (
          <p className="text-xs text-amber-700" data-testid="unsaved-note">
            Downloads use the saved version. Save first to include your latest overrides and edits.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
