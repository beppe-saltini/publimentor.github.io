"use client";

/**
 * State and API glue for the format-check screen. Keeps the components
 * presentational: pick the journal profile, run checks (upload or stored
 * manuscript) with or without formatting, hold the report and the formatting
 * block, editor overrides and the letter, save, rebuild the formatting, list
 * and reopen previous reports.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postFileCheck } from "./direct-upload";
import { normalizeFormatting } from "./format-result-utils";
import { assembleLetter, readJsonResponse, summarize } from "./report-utils";
import type {
  CheckRunResponse,
  CheckStatus,
  FormatCheckReport,
  FormattingBlock,
  ManuscriptInfo,
  OverrideMap,
  ProfileInfo,
  ProfileListItem,
  ReportListItem,
  RunMode,
  RunStage,
  SavedReportResponse,
} from "./types";

export const ACTIVE_MANUSCRIPT_KEY = "active_manuscript_id";

/** Timings (ms) after which the indicative progress stage advances. The
 * formatting stage only applies to "Check & format" runs. */
const STAGE_TIMINGS: Array<{ stage: RunStage; after: number; formatOnly?: boolean }> = [
  { stage: "rules", after: 1500 },
  { stage: "ai", after: 4500 },
  { stage: "formatting", after: 9000, formatOnly: true },
];

function readActiveManuscriptId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(ACTIVE_MANUSCRIPT_KEY);
  } catch {
    return null;
  }
}

function writeActiveManuscriptId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.sessionStorage.setItem(ACTIVE_MANUSCRIPT_KEY, id);
    else window.sessionStorage.removeItem(ACTIVE_MANUSCRIPT_KEY);
  } catch {
    // sessionStorage can be unavailable (privacy mode); the selection still works in memory.
  }
}

interface LoadedReport {
  reportId: string;
  report: FormatCheckReport;
  manuscript: ManuscriptInfo | null;
  profile: ProfileInfo | null;
  formatting: FormattingBlock | null;
  /** Whether the server can (re)format this report; see SavedReportResponse.canFormat. */
  canFormat: boolean;
}

interface SavedSnapshot {
  overrides: string;
  letterText: string;
}

export interface UseFormatCheckOptions {
  journalSlug: string;
}

export function useFormatCheck({ journalSlug }: UseFormatCheckOptions) {
  const [selectedManuscriptId, setSelectedManuscriptIdState] = useState<string | null>(readActiveManuscriptId);
  const [file, setFile] = useState<File | null>(null);
  const [journalName, setJournalName] = useState<string | null>(null);

  // Profile registry (GET /api/format/profiles) and the editor's selection.
  // `selectedProfileId` is null until the editor picks one or a run resolves
  // the journal's default; it is sent as `profileId` with every run.
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState<string | null>(null);
  const profilePickedRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("format");
  const [stage, setStage] = useState<RunStage>("idle");
  // Real progress of the direct upload (null until the PUT reports something).
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const [loaded, setLoaded] = useState<LoadedReport | null>(null);
  // The last catalog seen per profile id, so a reopened report whose payload
  // omits `profile.checks` still gets questions and categories.
  const catalogsRef = useRef<Map<string, ProfileInfo>>(new Map());

  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [customLetter, setCustomLetter] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSnapshot | null>(null);
  const [saving, setSaving] = useState(false);

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportsVersion, setReportsVersion] = useState(0);

  const aliveRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Journal display name (best effort; the slug is shown until it arrives).
  useEffect(() => {
    if (!journalSlug) return;
    let cancelled = false;
    fetch(`/api/journals/${encodeURIComponent(journalSlug)}`)
      .then((res) => readJsonResponse<{ journal?: { name?: string } }>(res))
      .then((data) => {
        if (!cancelled && data.journal?.name) setJournalName(data.journal.name);
      })
      .catch(() => {
        /* name is cosmetic */
      });
    return () => {
      cancelled = true;
    };
  }, [journalSlug]);

  // Selectable profiles. A failed load leaves the picker with only the
  // resolved profile, which is still usable.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/format/profiles")
      .then((res) => readJsonResponse<{ profiles?: ProfileListItem[] }>(res, "Could not load the journal profiles"))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.profiles)
          ? data.profiles.filter((p) => p && typeof p.id === "string" && p.id.length > 0)
          : [];
        setProfiles(list);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Previous reports for the selected manuscript.
  useEffect(() => {
    if (!selectedManuscriptId) {
      setReports([]);
      return;
    }
    let cancelled = false;
    setLoadingReports(true);
    const params = new URLSearchParams({ manuscriptId: selectedManuscriptId });
    if (journalSlug) params.set("journalSlug", journalSlug);
    fetch(`/api/format/reports?${params.toString()}`)
      .then((res) => readJsonResponse<{ reports?: ReportListItem[] }>(res, "Could not load previous reports"))
      .then((data) => {
        if (!cancelled) setReports(Array.isArray(data.reports) ? data.reports : []);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingReports(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedManuscriptId, journalSlug, reportsVersion]);

  const profile = useMemo<ProfileInfo | null>(() => {
    if (!loaded) return null;
    const fromPayload = loaded.profile;
    if (fromPayload?.checks?.length) return fromPayload;
    const remembered = catalogsRef.current.get(loaded.report.profileId);
    if (remembered) return { ...(fromPayload ?? remembered), checks: remembered.checks };
    return fromPayload ?? { id: loaded.report.profileId, name: loaded.report.profileId, version: loaded.report.profileVersion };
  }, [loaded]);

  const checks = profile?.checks;
  const formatting = loaded?.formatting ?? null;
  const assembled = useMemo(() => assembleLetter(loaded?.report, checks, overrides), [loaded?.report, checks, overrides]);
  // When the formatter ran, its composed letter (plan actions + failing
  // checks + closing) is the letter; otherwise the live checklist assembly is.
  const composedText = formatting?.letter?.text?.trim() ? formatting.letter.text : null;
  const autoLetterText = composedText ?? assembled.text;
  const letterText = customLetter ?? autoLetterText;
  const letterItemCount = composedText ? formatting?.letter.items.length ?? 0 : assembled.items.length;
  const counts = useMemo(() => summarize(loaded?.report.results, overrides), [loaded?.report.results, overrides]);
  const dirty = saved !== null && (saved.overrides !== JSON.stringify(overrides) || saved.letterText !== letterText);

  const setSelectedManuscriptId = useCallback((id: string | null) => {
    setSelectedManuscriptIdState(id);
    writeActiveManuscriptId(id);
  }, []);

  const setSelectedProfileId = useCallback((id: string | null) => {
    profilePickedRef.current = id !== null;
    setSelectedProfileIdState(id);
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  /** Replace the loaded report and reset editor state around it. */
  const adopt = useCallback(
    (next: LoadedReport, nextOverrides: OverrideMap, savedLetter: string | null | undefined) => {
      if (next.profile?.checks?.length) catalogsRef.current.set(next.profile.id, next.profile);
      const catalog = next.profile?.checks?.length
        ? next.profile.checks
        : catalogsRef.current.get(next.report.profileId)?.checks;
      const composed = next.formatting?.letter?.text?.trim() ? next.formatting.letter.text : null;
      const auto = composed ?? assembleLetter(next.report, catalog, nextOverrides).text;
      const letter = typeof savedLetter === "string" && savedLetter.trim() && savedLetter !== auto ? savedLetter : null;
      setLoaded(next);
      setOverrides(nextOverrides);
      setCustomLetter(letter);
      setSaved({ overrides: JSON.stringify(nextOverrides), letterText: letter ?? auto });
      // The picker defaults to the resolved profile until the editor chooses one.
      if (!profilePickedRef.current) setSelectedProfileIdState(next.profile?.id ?? next.report.profileId ?? null);
    },
    [],
  );

  const run = useCallback(
    async (mode: RunMode = "format") => {
      if (running) return;
      if (!file && !selectedManuscriptId) {
        setRunError("Select a manuscript or upload a file first.");
        return;
      }
      const format = mode === "format";
      setRunError(null);
      setRunning(true);
      setRunMode(mode);
      setUploadPercent(null);
      // A chosen file is uploaded first (direct upload, see direct-upload.ts);
      // the indicative check stages start when the check request goes out.
      setStage(file ? "uploading" : "parsing");
      clearTimers();
      let checkStarted = false;
      const startCheckStages = () => {
        if (checkStarted || !aliveRef.current) return;
        checkStarted = true;
        setStage("parsing");
        for (const { stage: next, after, formatOnly } of STAGE_TIMINGS) {
          if (formatOnly && !format) continue;
          timersRef.current.push(
            setTimeout(() => {
              if (aliveRef.current) setStage(next);
            }, after),
          );
        }
      };

      try {
        let response: Response;
        if (file) {
          response = await postFileCheck(
            { file, journalSlug, manuscriptId: selectedManuscriptId, profileId: selectedProfileId, format },
            {
              onUploadProgress: (percent) => {
                if (aliveRef.current) setUploadPercent(percent);
              },
              onCheckStart: startCheckStages,
            },
          );
        } else {
          startCheckStages();
          response = await fetch("/api/format/check-manuscript", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              manuscriptId: selectedManuscriptId,
              journalSlug: journalSlug || undefined,
              profileId: selectedProfileId ?? undefined,
              format,
            }),
          });
        }
        const data = await readJsonResponse<CheckRunResponse>(response, "Format check failed");
        if (!data?.report || !data.reportId) throw new Error("The server returned no report.");
        if (!aliveRef.current) return;
        const block = normalizeFormatting(data.formatting);
        // When formatting ran the server stores the composed letter as the
        // report's letter text; the checker's own letter is then superseded.
        adopt(
          {
            reportId: data.reportId,
            report: data.report,
            manuscript: data.manuscript ?? null,
            profile: data.profile ?? null,
            formatting: block,
            // A fresh run always stores its source file.
            canFormat: true,
          },
          {},
          block?.letter.text.trim() ? block.letter.text : data.report.letter?.text,
        );
        setStage("done");
        setReportsVersion((v) => v + 1);
      } catch (error) {
        if (aliveRef.current) {
          setRunError(error instanceof Error ? error.message : "Format check failed");
          setStage("idle");
        }
      } finally {
        clearTimers();
        if (aliveRef.current) setRunning(false);
      }
    },
    [adopt, file, journalSlug, running, selectedManuscriptId, selectedProfileId],
  );

  const setOverride = useCallback((checkId: string, status: CheckStatus | undefined) => {
    setOverrides((current) => {
      const next = { ...current };
      const detected = loaded?.report.results.find((r) => r.checkId === checkId)?.status;
      if (status === undefined || status === detected) {
        if (next[checkId]?.note) next[checkId] = { note: next[checkId].note };
        else delete next[checkId];
      } else {
        next[checkId] = { ...next[checkId], status };
      }
      return next;
    });
  }, [loaded]);

  const setLetterText = useCallback(
    (text: string) => {
      setCustomLetter(text === autoLetterText ? null : text);
    },
    [autoLetterText],
  );

  const resetLetter = useCallback(() => setCustomLetter(null), []);

  const save = useCallback(async () => {
    if (!loaded || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/format/reports/${encodeURIComponent(loaded.reportId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides, letterText }),
      });
      const data = await readJsonResponse<SavedReportResponse>(response, "Could not save the report");
      if (!aliveRef.current) return;
      const nextOverrides = (data.overrides ?? overrides) as OverrideMap;
      adopt(
        {
          reportId: loaded.reportId,
          report: data.report ?? loaded.report,
          manuscript: data.manuscript ?? loaded.manuscript,
          profile: data.profile ?? loaded.profile,
          formatting: data.formatting === undefined ? loaded.formatting : normalizeFormatting(data.formatting),
          canFormat: data.canFormat ?? loaded.canFormat,
        },
        nextOverrides,
        data.letterText ?? letterText,
      );
      setReportsVersion((v) => v + 1);
      return true;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Could not save the report");
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [adopt, letterText, loaded, overrides, saving]);

  /**
   * Re-run the formatting on the server from the stored source file
   * (POST /api/format/reports/[id]/format) and refresh the panel. The route
   * answers with the full report detail (report, overrides, letterText,
   * profile, formatting), which is adopted wholesale so the screen mirrors
   * what the server stored; a bare formatting block is accepted too. Either
   * way the composed letter replaces local hand edits.
   */
  const rebuild = useCallback(async () => {
    if (!loaded || rebuilding) return;
    setRebuilding(true);
    try {
      const response = await fetch(`/api/format/reports/${encodeURIComponent(loaded.reportId)}/format`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedProfileId ? { profileId: selectedProfileId } : {}),
      });
      const data = await readJsonResponse<Partial<SavedReportResponse> | null>(response, "Could not rebuild the formatting");
      const block = normalizeFormatting(data);
      if (!block) throw new Error("The server returned no formatting result.");
      if (!aliveRef.current) return;
      if (data && typeof data === "object" && data.report) {
        // Full detail body: adopt it like a reopened report. The stored
        // letter is the composed one, so adopt() sees no hand edit.
        adopt(
          {
            reportId: loaded.reportId,
            report: data.report,
            manuscript: data.manuscript ?? loaded.manuscript,
            profile: data.profile ?? loaded.profile,
            formatting: block,
            canFormat: data.canFormat ?? loaded.canFormat,
          },
          (data.overrides ?? overrides) as OverrideMap,
          data.letterText ?? block.letter.text,
        );
      } else {
        setLoaded((current) => (current && current.reportId === loaded.reportId ? { ...current, formatting: block } : current));
        if (block.letter.text.trim()) {
          setCustomLetter(null);
          setSaved((current) => (current ? { ...current, letterText: block.letter.text } : current));
        }
      }
      setReportsVersion((v) => v + 1);
      return block;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Could not rebuild the formatting");
    } finally {
      if (aliveRef.current) setRebuilding(false);
    }
  }, [adopt, loaded, overrides, rebuilding, selectedProfileId]);

  const openReport = useCallback(
    async (reportId: string) => {
      setRunError(null);
      const response = await fetch(`/api/format/reports/${encodeURIComponent(reportId)}`);
      const data = await readJsonResponse<SavedReportResponse>(response, "Could not open the report");
      if (!aliveRef.current) return;
      if (!data?.report) throw new Error("The saved report is empty.");
      adopt(
        {
          reportId,
          report: data.report,
          manuscript: data.manuscript ?? null,
          profile: data.profile ?? null,
          formatting: normalizeFormatting(data.formatting),
          // Older reports (before formatting existed) have no stored source.
          canFormat: data.canFormat ?? true,
        },
        (data.overrides ?? {}) as OverrideMap,
        data.letterText,
      );
      setStage("done");
    },
    [adopt],
  );

  return {
    journalSlug,
    journalName,
    selectedManuscriptId,
    setSelectedManuscriptId,
    file,
    setFile,
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    running,
    runMode,
    stage,
    uploadPercent,
    runError,
    run,
    reportId: loaded?.reportId ?? null,
    report: loaded?.report,
    manuscript: loaded?.manuscript ?? null,
    profile,
    checks,
    overrides,
    setOverride,
    counts,
    letter: assembled,
    letterText,
    letterItemCount,
    letterComposed: composedText !== null,
    letterEdited: customLetter !== null,
    setLetterText,
    resetLetter,
    dirty,
    saving,
    save,
    formatting,
    canFormat: loaded?.canFormat ?? false,
    rebuilding,
    rebuild,
    reports,
    loadingReports,
    openReport,
  };
}

export type FormatCheckState = ReturnType<typeof useFormatCheck>;
