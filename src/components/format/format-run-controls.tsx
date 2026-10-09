"use client";

/**
 * Step 1-3 of the flow: show the journal, pick the journal requirements
 * (profile), pick a manuscript (ManuscriptSelector, sessionStorage
 * "active_manuscript_id") or upload a PDF/DOCX, then run "Check & format"
 * (checks + Journal-Ready Formatter) or "Check only", with a staged progress
 * indicator.
 */

import { useId, useRef, type ChangeEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, FileText, ListChecks, Loader2, Upload, Wand2, X } from "lucide-react";
import { ManuscriptSelector } from "@/components/manuscript";
import { cn } from "@/lib/utils";
import { fileKind, requiresWordFile } from "./report-utils";
import type { ProfileInfo, ProfileListItem, RunMode, RunStage } from "./types";

export interface FormatRunControlsProps {
  journalSlug: string;
  journalName?: string | null;
  /** Profile resolved by the last run (or reopened report). */
  profile?: ProfileInfo | null;
  /** Selectable profiles from GET /api/format/profiles. */
  profiles?: ProfileListItem[];
  /** Explicit profile selection; null falls back to the journal's default. */
  selectedProfileId?: string | null;
  onProfileChange?: (id: string | null) => void;
  publisherId?: string;
  selectedManuscriptId: string | null;
  onManuscriptChange: (id: string | null) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onRun: (mode: RunMode) => void;
  running: boolean;
  /** Mode of the run in flight; decides whether the formatting stage shows. */
  runMode?: RunMode;
  stage: RunStage;
  /** Direct-upload progress (0-100) while `stage` is "uploading"; null when unknown. */
  uploadPercent?: number | null;
  error?: string | null;
}

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Value of the "journal default" option in the profile select. */
export const DEFAULT_PROFILE_OPTION = "__journal_default__";

const STAGES: Array<{ id: RunStage; label: string; percent: number; formatOnly?: boolean; uploadOnly?: boolean }> = [
  // Only when a chosen file is sent; its percent is replaced by the real upload progress.
  { id: "uploading", label: "Uploading file", percent: 10, uploadOnly: true },
  { id: "parsing", label: "Parsing manuscript", percent: 20 },
  { id: "rules", label: "Running rule checks", percent: 45 },
  { id: "ai", label: "AI review of judgement calls", percent: 70 },
  { id: "formatting", label: "Formatting (references on Crossref)", percent: 90, formatOnly: true },
];

const SELECT_CLASSES =
  "border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

export function FormatRunControls({
  journalSlug,
  journalName,
  profile,
  profiles = [],
  selectedProfileId = null,
  onProfileChange,
  publisherId,
  selectedManuscriptId,
  onManuscriptChange,
  file,
  onFileChange,
  onRun,
  running,
  runMode = "format",
  stage,
  uploadPercent = null,
  error,
}: FormatRunControlsProps) {
  const fileInputId = useId();
  const profileSelectId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kind = fileKind(file);
  const wordOnly = requiresWordFile(journalSlug, selectedProfileId ?? profile?.id);
  // A file of an unsupported type blocks the run; no file at all is fine when
  // a stored manuscript is selected.
  const unsupportedFile = file !== null && kind === "unknown";
  const canRun = !running && !unsupportedFile && (Boolean(file) || Boolean(selectedManuscriptId));

  const stages = STAGES.filter((s) => (!s.formatOnly || runMode === "format") && (!s.uploadOnly || file !== null));
  const stageIndex = stages.findIndex((s) => s.id === stage);
  // While uploading, the bar follows the real transfer within the stage's share (0-10 %).
  const uploadProgress = stage === "uploading" && uploadPercent !== null ? Math.round((uploadPercent / 100) * 10) : null;
  const progress = stage === "done" ? 100 : uploadProgress ?? (stageIndex >= 0 ? stages[stageIndex].percent : 5);

  // Options: the registry list, plus the resolved profile when the registry
  // does not know it (or failed to load) so the select always shows it.
  const options: ProfileListItem[] = [...profiles];
  if (profile && !options.some((p) => p.id === profile.id)) {
    options.push({ id: profile.id, name: profile.name, version: profile.version });
  }
  const selectValue = selectedProfileId ?? DEFAULT_PROFILE_OPTION;
  const selectedOption = options.find((p) => p.id === selectedProfileId) ?? (selectedProfileId ? null : profile ?? null);
  const selectedVersion = selectedOption?.version;

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    onFileChange(next);
  };

  const clearFile = () => {
    onFileChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Pre-accept checks and formatting
        </CardTitle>
        <CardDescription>
          Journal <span className="font-medium text-gray-800">{journalName || journalSlug}</span>
          {profile ? (
            <>
              {" "}· profile <span className="font-medium text-gray-800">{profile.name}</span>{" "}
              <Badge variant="outline" className="ml-1 align-middle">v{profile.version}</Badge>
            </>
          ) : (
            <span className="text-gray-400"> · profile resolved when the checks run</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor={profileSelectId}>Journal requirements</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={profileSelectId}
              className={cn(SELECT_CLASSES, "sm:max-w-md")}
              value={selectValue}
              disabled={running}
              onChange={(event) => {
                const value = event.target.value;
                onProfileChange?.(value === DEFAULT_PROFILE_OPTION ? null : value);
              }}
              data-testid="profile-select"
            >
              <option value={DEFAULT_PROFILE_OPTION}>
                {profile ? `Journal default (${profile.name})` : "Journal default (resolved when the checks run)"}
              </option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.family ? ` · ${item.family}` : ""} (v{item.version})
                </option>
              ))}
            </select>
            {selectedVersion && (
              <Badge variant="outline" data-testid="profile-version">
                v{selectedVersion}
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-500">
            The profile decides the checks, the target structure and the letter phrases. It is sent with every run.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Manuscript</Label>
          <ManuscriptSelector
            value={selectedManuscriptId ?? undefined}
            publisherId={publisherId}
            onChange={(manuscript) => onManuscriptChange(manuscript?.id ?? null)}
            placeholder="Select an uploaded manuscript"
            disabled={running}
          />
          {selectedManuscriptId && !file && (
            <p className="text-xs text-gray-500">
              The stored file of the selected manuscript will be checked.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={fileInputId}>Or upload the final file (PDF or Word)</Label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={ACCEPT}
              onChange={handleFileInput}
              disabled={running}
              className="sr-only"
              data-testid="format-file-input"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
            >
              <Upload className="h-4 w-4 mr-2" />
              {file ? "Replace file" : "Choose file"}
            </Button>
            {file && (
              <div className="flex items-center gap-2 text-sm text-gray-700" data-testid="selected-file">
                <FileText className="h-4 w-4 text-gray-500" aria-hidden="true" />
                <span className="truncate max-w-[16rem]" title={file.name}>{file.name}</span>
                <Badge variant={kind === "unknown" ? "destructive" : "secondary"}>
                  {kind === "unknown" ? "Unsupported" : kind.toUpperCase()}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Remove selected file"
                  onClick={clearFile}
                  disabled={running}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          {wordOnly && (
            <p
              className={`flex items-start gap-1.5 text-xs ${kind === "pdf" ? "text-amber-700" : "text-gray-500"}`}
              data-testid="word-file-note"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              iScience requires the final main file as a modifiable Word document. A PDF can be checked and
              rebuilt, but the file-type check will fail, the letter will ask the authors for a Word file and
              no tracked-changes version can be produced.
            </p>
          )}
          {kind === "unknown" && file && (
            <p className="text-xs text-red-600" role="alert">
              Only PDF (.pdf) and Word (.docx) files are supported.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => onRun("format")} disabled={!canRun}>
            {running && runMode === "format" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            {running && runMode === "format" ? "Checking and formatting…" : "Check & format"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onRun("check")} disabled={!canRun}>
            {running && runMode === "check" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ListChecks className="h-4 w-4 mr-2" />
            )}
            {running && runMode === "check" ? "Running checks…" : "Check only"}
          </Button>
          {!file && !selectedManuscriptId && (
            <span className="text-xs text-gray-500">Select a manuscript or upload a file to start.</span>
          )}
        </div>

        {running && (
          <div className="space-y-2" role="status" aria-live="polite" data-testid="run-progress">
            <Progress value={progress} aria-label="Check progress" />
            <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {stages.map((item, index) => {
                const state = index < stageIndex ? "done" : index === stageIndex ? "active" : "pending";
                return (
                  <li
                    key={item.id}
                    data-state={state}
                    className={
                      state === "active"
                        ? "font-medium text-gray-900"
                        : state === "done"
                          ? "text-green-700"
                          : "text-gray-400"
                    }
                  >
                    {state === "done" ? "✓ " : state === "active" ? "… " : ""}
                    {item.label}
                    {item.id === "uploading" && state === "active" && uploadPercent !== null ? ` (${uploadPercent}%)` : ""}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
