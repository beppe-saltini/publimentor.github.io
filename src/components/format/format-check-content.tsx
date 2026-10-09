"use client";

/**
 * Journal-Ready Formatter screen for one journal.
 *
 * Flow: journal (from the route) -> journal requirements (profile) ->
 * manuscript or file -> "Check & format" or "Check only" -> profile-driven
 * checklist with editable statuses -> formatted manuscript panel (downloads,
 * operations, author actions) -> author letter -> save / download; plus a
 * list of previous reports for the selected manuscript.
 */

import { toast } from "sonner";
import { FormatRunControls } from "./format-run-controls";
import { FormatSummaryBar } from "./format-summary-bar";
import { FormatChecklist } from "./format-checklist";
import { FormatLetterPanel } from "./format-letter-panel";
import { FormatPreviousReports } from "./format-previous-reports";
import { FormatResultPanel } from "./format-result-panel";
import { useFormatCheck } from "./use-format-check";

export interface FormatCheckContentProps {
  journalSlug: string;
  publisherId?: string;
  /** Hide the page heading when the host page renders its own. */
  hideHeading?: boolean;
}

export function FormatCheckContent({ journalSlug, publisherId, hideHeading }: FormatCheckContentProps) {
  const state = useFormatCheck({ journalSlug });

  const handleSave = async () => {
    try {
      await state.save();
      toast.success("Report saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the report");
    }
  };

  const handleOpenReport = async (reportId: string) => {
    try {
      await state.openReport(reportId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the report");
    }
  };

  const handleRebuild = async () => {
    try {
      const block = await state.rebuild();
      if (block) toast.success("Formatting rebuilt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rebuild the formatting");
    }
  };

  const hasReport = Boolean(state.report);
  const sourceType = state.report?.stats?.sourceType ?? state.manuscript?.sourceType ?? null;
  const busy = state.running || state.saving || state.rebuilding;
  // Rebuilding needs a report with a stored source file on the server.
  const canRebuild = Boolean(state.reportId) && state.canFormat;

  return (
    <div className="space-y-6 max-w-6xl">
      {!hideHeading && (
        <div>
          <h1 className="text-2xl font-bold">Journal-Ready Formatter &amp; Compliance Checker</h1>
          <p className="text-gray-500">
            Check an accepted manuscript against the journal&apos;s final-file requirements, rebuild it in the
            journal&apos;s structure and assemble the letter to the authors.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <FormatRunControls
          journalSlug={journalSlug}
          journalName={state.journalName}
          profile={state.profile}
          profiles={state.profiles}
          selectedProfileId={state.selectedProfileId}
          onProfileChange={state.setSelectedProfileId}
          publisherId={publisherId}
          selectedManuscriptId={state.selectedManuscriptId}
          onManuscriptChange={state.setSelectedManuscriptId}
          file={state.file}
          onFileChange={state.setFile}
          onRun={(mode) => void state.run(mode)}
          running={state.running}
          runMode={state.runMode}
          stage={state.stage}
          uploadPercent={state.uploadPercent}
          error={state.runError}
        />
        <FormatPreviousReports
          reports={state.reports}
          loading={state.loadingReports}
          activeReportId={state.reportId}
          onOpen={(id) => void handleOpenReport(id)}
          disabled={state.running}
          hasManuscript={Boolean(state.selectedManuscriptId)}
        />
      </div>

      {hasReport && (
        <>
          <FormatSummaryBar
            counts={state.counts}
            report={state.report}
            manuscript={state.manuscript}
            profile={state.profile}
          />
          <FormatResultPanel
            formatting={state.formatting}
            sourceType={sourceType}
            onRebuild={canRebuild ? () => void handleRebuild() : undefined}
            canFormat={state.canFormat}
            rebuilding={state.rebuilding}
            disabled={state.running || state.saving}
          />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
            <FormatChecklist
              report={state.report}
              checks={state.checks}
              overrides={state.overrides}
              onOverride={state.setOverride}
              disabled={busy}
            />
            <div className="xl:sticky xl:top-4">
              <FormatLetterPanel
                reportId={state.reportId}
                letterText={state.letterText}
                itemCount={state.letterItemCount}
                edited={state.letterEdited}
                dirty={state.dirty}
                saving={state.saving}
                onLetterChange={state.setLetterText}
                onResetLetter={state.resetLetter}
                onSave={() => void handleSave()}
                composed={state.letterComposed}
                letterDownloadBase={state.formatting?.downloads.letter ?? null}
                onRebuild={state.formatting && canRebuild ? () => void handleRebuild() : undefined}
                rebuilding={state.rebuilding}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
