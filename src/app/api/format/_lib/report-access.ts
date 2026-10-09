/**
 * Loading, authorising and serialising stored FormatCheckReport rows for the
 * /api/format/reports routes.
 *
 * Access rule (shared by list, get, patch and letter download): a user sees a
 * report when they ran it (checkedById) or when they can access the manuscript
 * it was produced from (findAccessibleManuscript: uploader, explicit
 * permission, publisher member, journal editor/admin). Reports from ad-hoc
 * uploads therefore stay private to the editor who ran them.
 */

import type { FormatCheckReport as FormatCheckReportRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAccessibleManuscript } from "@/lib/manuscript-access";
import {
  buildLetter,
  composeAuthorLetter,
  profiles,
  resolveProfile,
  type CheckResult,
  type CheckStatus,
  type FormatCheckReport,
  type JournalProfile,
} from "./format-lib";
import {
  findJournal,
  profileSummary,
  type JournalRecord,
  type ManuscriptSummary,
  type ProfileSummary,
} from "./run-check";
import { formattingBlockFromPlan, parseStoredPlan, type FormattingBlock } from "./run-format";

export type Overrides = Record<string, { status?: CheckStatus; note?: string }>;

export const CHECK_STATUSES: readonly CheckStatus[] = ["pass", "fail", "review", "not_applicable", "unknown"];

/** Shape of GET and PATCH /api/format/reports/[id]. */
export interface ReportDetailBody {
  report: FormatCheckReport & { id: string };
  overrides: Overrides;
  letterText: string;
  manuscript: ManuscriptSummary;
  profile: ProfileSummary;
  /** Journal-Ready Formatter output, null until formatting has run for this report. */
  formatting: FormattingBlock | null;
  /** True when a source file is stored, i.e. POST .../format can (re)run formatting. */
  canFormat: boolean;
}

/** Shape of each entry of GET /api/format/reports. */
export interface ReportListEntry {
  id: string;
  checkedAt: string;
  profileId: string;
  profileVersion: string;
  manuscriptId: string | null;
  journalId: string | null;
  fileName: string | null;
  summary: Record<CheckStatus | "total", number>;
}

// ------------------------------------------------------------------
// JSON column parsing (defensive: columns are untyped Json in Prisma)
// ------------------------------------------------------------------

export function parseResults(json: unknown): CheckResult[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (r): r is CheckResult => !!r && typeof r === "object" && typeof (r as CheckResult).checkId === "string"
  );
}

export function parseOverrides(json: unknown): Overrides {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Overrides = {};
  for (const [checkId, value] of Object.entries(json as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { status, note } = value as { status?: unknown; note?: unknown };
    const entry: Overrides[string] = {};
    if (typeof status === "string" && (CHECK_STATUSES as readonly string[]).includes(status)) {
      entry.status = status as CheckStatus;
    }
    if (typeof note === "string") entry.note = note;
    if (entry.status !== undefined || entry.note !== undefined) out[checkId] = entry;
  }
  return out;
}

export function parseStats(json: unknown, sourceType: string): FormatCheckReport["stats"] {
  const s = (json && typeof json === "object" ? json : {}) as Partial<FormatCheckReport["stats"]>;
  return {
    wordCount: typeof s.wordCount === "number" ? s.wordCount : 0,
    pageCount: typeof s.pageCount === "number" ? s.pageCount : undefined,
    referenceCount: typeof s.referenceCount === "number" ? s.referenceCount : 0,
    figureLegendCount: typeof s.figureLegendCount === "number" ? s.figureLegendCount : 0,
    sourceType: typeof s.sourceType === "string" ? s.sourceType : sourceType,
  };
}

// ------------------------------------------------------------------
// Derived values
// ------------------------------------------------------------------

/** Status counts after applying editor overrides on top of the stored results. */
export function summarize(results: CheckResult[], overrides: Overrides = {}): Record<CheckStatus | "total", number> {
  const summary: Record<CheckStatus | "total", number> = {
    pass: 0,
    fail: 0,
    review: 0,
    not_applicable: 0,
    unknown: 0,
    total: results.length,
  };
  for (const r of results) {
    const status = overrides[r.checkId]?.status ?? r.status;
    summary[status] = (summary[status] ?? 0) + 1;
  }
  return summary;
}

/** Merge a PATCH's overrides into the stored ones; an empty object for a checkId removes it. */
export function mergeOverrides(current: Overrides, incoming: Overrides): Overrides {
  const merged: Overrides = { ...current };
  for (const [checkId, value] of Object.entries(incoming)) {
    if (value.status === undefined && value.note === undefined) {
      delete merged[checkId];
    } else {
      merged[checkId] = { ...merged[checkId], ...value };
    }
  }
  return merged;
}

/**
 * Profile to use for a stored report: the editor's explicit override when the
 * row has one and it still exists, else the journal's current profile when the
 * journal still exists (so disabledChecks/phraseOverrides apply), otherwise the
 * profile recorded on the row, otherwise the generic fallback.
 */
export async function resolveReportProfile(
  row: Pick<FormatCheckReportRow, "journalId" | "profileId"> & { profileOverride?: string | null }
): Promise<{ profile: JournalProfile; journal: JournalRecord | null }> {
  const journal = row.journalId ? await findJournal({ id: row.journalId }) : null;
  if (row.profileOverride && profiles[row.profileOverride]) return { profile: profiles[row.profileOverride], journal };
  if (journal) return { profile: resolveProfile(journal), journal };
  const stored = profiles[row.profileId];
  return { profile: stored ?? resolveProfile(null), journal: null };
}

/**
 * The FormatCheckReport the engine's letter composer should see for a stored
 * row: statuses with the editor's overrides applied (a check marked "pass" or
 * "not_applicable" must not come back in the letter), summary recomputed.
 */
export function reportFromRow(
  row: Pick<FormatCheckReportRow, "profileId" | "profileVersion" | "checkedAt" | "results" | "stats" | "sourceType" | "letterText">,
  overrides: Overrides,
  profile: JournalProfile
): FormatCheckReport {
  const results = parseResults(row.results).map((r) => {
    const status = overrides[r.checkId]?.status;
    return status && status !== r.status ? { ...r, status } : r;
  });
  return {
    profileId: row.profileId,
    profileVersion: row.profileVersion,
    checkedAt: row.checkedAt.toISOString(),
    results,
    summary: summarize(results),
    letter: { ...buildLetter(profile, results), text: row.letterText },
    stats: parseStats(row.stats, row.sourceType),
  };
}

/**
 * Letter text after an overrides change: recomposed with the stored plan when
 * the report has been formatted (plan items + still-failing checks), otherwise
 * the plain check letter.
 */
export function regenerateLetterText(row: FormatCheckReportRow, profile: JournalProfile, overrides: Overrides): string {
  const plan = parseStoredPlan(row.formatPlan);
  if (!plan) return buildLetter(profile, parseResults(row.results), overrides).text;
  const report = reportFromRow(row, overrides, profile);
  return composeAuthorLetter({ plan, report, profile, sourceType: row.sourceType }).text;
}

// ------------------------------------------------------------------
// Access
// ------------------------------------------------------------------

export async function canAccessReport(userId: string, row: Pick<FormatCheckReportRow, "checkedById" | "manuscriptId">): Promise<boolean> {
  if (row.checkedById === userId) return true;
  if (!row.manuscriptId) return false;
  return (await findAccessibleManuscript(userId, row.manuscriptId)) !== null;
}

export type LoadReportResult =
  | { ok: true; row: FormatCheckReportRow }
  | { ok: false; status: 404 | 403; error: string };

export async function loadAccessibleReport(userId: string, id: string): Promise<LoadReportResult> {
  const row = await prisma.formatCheckReport.findUnique({ where: { id } });
  if (!row) return { ok: false, status: 404, error: "Report not found" };
  if (!(await canAccessReport(userId, row))) return { ok: false, status: 403, error: "Access denied" };
  return { ok: true, row };
}

/** Latest reports visible to the user, newest first, at most `limit`. */
export async function listAccessibleReports(
  userId: string,
  filter: { manuscriptId?: string; journalId?: string },
  limit = 20
): Promise<ReportListEntry[]> {
  // Over-fetch a bounded window of candidates and filter by access in memory;
  // access depends on membership tables Prisma cannot join into this query.
  const CANDIDATE_WINDOW = limit * 3;
  const rows = await prisma.formatCheckReport.findMany({
    where: {
      ...(filter.manuscriptId ? { manuscriptId: filter.manuscriptId } : {}),
      ...(filter.journalId ? { journalId: filter.journalId } : {}),
      OR: [{ checkedById: userId }, { manuscriptId: { not: null } }],
    },
    orderBy: { checkedAt: "desc" },
    take: CANDIDATE_WINDOW,
    select: {
      id: true,
      checkedAt: true,
      profileId: true,
      profileVersion: true,
      manuscriptId: true,
      journalId: true,
      fileName: true,
      checkedById: true,
      results: true,
      overrides: true,
    },
  });

  const accessCache = new Map<string, Promise<boolean>>();
  const visible: ReportListEntry[] = [];
  for (const row of rows) {
    if (visible.length >= limit) break;
    let allowed = row.checkedById === userId;
    if (!allowed && row.manuscriptId) {
      if (!accessCache.has(row.manuscriptId)) {
        accessCache.set(
          row.manuscriptId,
          findAccessibleManuscript(userId, row.manuscriptId).then((m) => m !== null)
        );
      }
      allowed = await accessCache.get(row.manuscriptId)!;
    }
    if (!allowed) continue;
    visible.push({
      id: row.id,
      checkedAt: row.checkedAt.toISOString(),
      profileId: row.profileId,
      profileVersion: row.profileVersion,
      manuscriptId: row.manuscriptId,
      journalId: row.journalId,
      fileName: row.fileName,
      summary: summarize(parseResults(row.results), parseOverrides(row.overrides)),
    });
  }
  return visible;
}

// ------------------------------------------------------------------
// Serialisation
// ------------------------------------------------------------------

/**
 * Rebuild the full FormatCheckReport from a stored row. The letter's preamble
 * and items come from buildLetter with the current overrides; the letter text
 * is the stored one, which the editor may have hand-edited.
 */
export async function reportDetailFromRow(
  row: FormatCheckReportRow,
  resolved?: { profile: JournalProfile; journal: JournalRecord | null }
): Promise<ReportDetailBody> {
  const { profile } = resolved ?? (await resolveReportProfile(row));
  const results = parseResults(row.results);
  const overrides = parseOverrides(row.overrides);
  const letter = buildLetter(profile, results, overrides);
  const stats = parseStats(row.stats, row.sourceType);

  const plan = parseStoredPlan(row.formatPlan);
  const formatting = plan
    ? formattingBlockFromPlan({
        reportId: row.id,
        plan,
        report: reportFromRow(row, overrides, profile),
        profile,
        sourceType: row.sourceType,
        hasTracked: !!row.trackedPath,
        letterText: row.letterText,
        formattedAt: row.formattedAt,
      })
    : null;

  const manuscriptRow = row.manuscriptId
    ? await prisma.manuscript.findUnique({ where: { id: row.manuscriptId }, select: { title: true, fileName: true } })
    : null;

  return {
    report: {
      id: row.id,
      profileId: row.profileId,
      profileVersion: row.profileVersion,
      checkedAt: row.checkedAt.toISOString(),
      results,
      summary: summarize(results, overrides),
      letter: { ...letter, text: row.letterText },
      stats,
    },
    overrides,
    letterText: row.letterText,
    manuscript: {
      title: manuscriptRow?.title ?? undefined,
      wordCount: stats.wordCount,
      pageCount: stats.pageCount,
      sourceType: row.sourceType,
      fileName: row.fileName ?? manuscriptRow?.fileName ?? undefined,
    },
    profile: profileSummary(profile),
    formatting,
    canFormat: !!row.sourcePath,
  };
}
