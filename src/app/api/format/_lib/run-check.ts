/**
 * Shared pipeline behind POST /api/format/check and /api/format/check-manuscript.
 *
 *   file bytes  ->  buildManuscriptModel  ->  runFormatChecks(profile, llm)
 *               ->  persist FormatCheckReport  ->  store source  ->  audit
 *               ->  [format=true] runFormatting -> persist plan/files -> response body
 *
 * The two routes differ only in where the bytes come from (multipart upload
 * vs. the manuscript library), so everything after the file is obtained lives
 * here and is tested once. Checks and formatting run sequentially inside the
 * same request (maxDuration 300 s); run-format.ts keeps the Crossref work
 * within that budget.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditLogger } from "@/lib/audit";
import type { AcceptedFileType } from "./file-input";
import { MIME_FOR_TYPE } from "./file-input";
import {
  buildManuscriptModel,
  profiles,
  resolveProfile,
  runFormatChecks,
  type FormatCheckReport,
  type JournalProfile,
  type ManuscriptModel,
} from "./format-lib";
import { runFormatting, storeSource, type FormattingBlock } from "./run-format";

/**
 * Audit action for a format check. prisma/schema.prisma has no
 * FORMAT_CHECK_PERFORMED value (adding enum values is out of scope), so the
 * closest existing COMPLIANCE action is used; `metadata.kind` disambiguates.
 */
export const FORMAT_CHECK_AUDIT_ACTION = "INTEGRITY_CHECK_PERFORMED" as const;

/** The journal fields needed to pick a profile and to stamp the report. */
export interface JournalRecord {
  id: string;
  slug: string;
  name: string;
  formatGuidelines: { rules: unknown } | null;
}

const JOURNAL_SELECT = {
  id: true,
  slug: true,
  name: true,
  formatGuidelines: { select: { rules: true } },
} as const;

/** Journal by slug (preferred) or by id (fallback to the manuscript's journal). */
export async function findJournal(ref: { slug?: string | null; id?: string | null }): Promise<JournalRecord | null> {
  if (ref.slug) {
    return prisma.journal.findUnique({ where: { slug: ref.slug }, select: JOURNAL_SELECT });
  }
  if (ref.id) {
    return prisma.journal.findUnique({ where: { id: ref.id }, select: JOURNAL_SELECT });
  }
  return null;
}

/** Thrown when the parser cannot read the file; routes answer 422. */
export class ManuscriptParseError extends Error {
  constructor(cause: unknown) {
    super("Could not read the manuscript file");
    this.name = "ManuscriptParseError";
    this.cause = cause;
  }
}

/** Shape of `manuscript` in every check/report response. */
export interface ManuscriptSummary {
  title?: string;
  wordCount: number;
  pageCount?: number;
  sourceType: string;
  fileName?: string;
}

/** Shape of `profile` in every check/report response. */
export interface ProfileSummary {
  id: string;
  name: string;
  version: string;
  family?: string;
  checks?: Array<{
    id: string;
    category: string;
    question: string;
    guideline?: string;
    severity?: string;
    phrase?: string;
    sourceRef?: string;
  }>;
}

export interface CheckResponseBody {
  reportId: string;
  report: FormatCheckReport;
  manuscript: ManuscriptSummary;
  profile: ProfileSummary;
  /** Present when formatting ran (format=true and the engine succeeded). */
  formatting?: FormattingBlock;
  /** Set instead of `formatting` when the engine failed; the checks are still valid. */
  formattingError?: string;
}

/**
 * Pick the profile for a check: an explicit `profileId` override (already
 * validated by the route, see isKnownProfileId) wins over the journal's.
 */
export function resolveRequestedProfile(journal: JournalRecord | null, profileId?: string | null): JournalProfile {
  if (profileId && profiles[profileId]) return profiles[profileId];
  return resolveProfile(journal);
}

export function isKnownProfileId(profileId: string): boolean {
  return Object.prototype.hasOwnProperty.call(profiles, profileId);
}

export function profileSummary(profile: JournalProfile): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    version: profile.version,
    ...(profile.family ? { family: profile.family } : {}),
    // The check catalog lets the UI show the editor's question and the author phrase
    // for every row without importing the server-side detector code.
    checks: profile.checks.map((c) => ({
      id: c.id,
      category: c.category,
      question: c.question,
      guideline: c.guideline,
      severity: c.severity,
      phrase: c.phrase,
      sourceRef: c.sourceRef,
    })),
  };
}

export function manuscriptSummaryFromModel(model: ManuscriptModel, fallbackTitle?: string | null): ManuscriptSummary {
  return {
    title: model.title ?? fallbackTitle ?? undefined,
    wordCount: model.wordCount,
    pageCount: model.pageCount,
    sourceType: model.sourceType,
    fileName: model.fileName,
  };
}

/** Prisma's Json columns reject `undefined`; round-trip through JSON to drop them. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export interface PerformCheckInput {
  userId: string;
  buffer: Buffer;
  fileName: string;
  fileType: AcceptedFileType;
  journal: JournalRecord | null;
  /** Set when the file belongs to a library manuscript the user may access. */
  manuscript?: { id: string; title?: string | null } | null;
  /** Explicit journal-profile override (validated by the route). */
  profileId?: string | null;
  /** Run the Journal-Ready Formatter after the checks (default true). */
  format?: boolean;
  /** Request start (ms since epoch) so the formatter can budget Crossref lookups. */
  startedAt?: number;
  /**
   * Storage key the bytes were downloaded from when the browser uploaded the
   * file directly (format-reports/uploads/...). The object is reused as the
   * report's source in place: nothing is copied and storeSource is skipped.
   */
  sourcePath?: string | null;
}

/**
 * Run the full check and persist it. Parse failures surface as
 * ManuscriptParseError; everything else propagates to the route's 500 handler.
 */
export async function performFormatCheck(input: PerformCheckInput): Promise<CheckResponseBody> {
  const startedAt = input.startedAt ?? Date.now();
  const profile = resolveRequestedProfile(input.journal, input.profileId);

  let model: ManuscriptModel;
  try {
    model = await buildManuscriptModel({
      buffer: input.buffer,
      fileName: input.fileName,
      mimeType: MIME_FOR_TYPE[input.fileType],
    });
  } catch (error) {
    throw new ManuscriptParseError(error);
  }

  const report = await runFormatChecks(model, profile, { llm: true });

  // The report carries its own ISO timestamp; fall back to "now" if it is malformed.
  const checkedAt = new Date(report.checkedAt);
  const checkedAtSafe = Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt;

  const row = await prisma.formatCheckReport.create({
    data: {
      manuscriptId: input.manuscript?.id ?? null,
      journalId: input.journal?.id ?? null,
      profileId: report.profileId,
      profileVersion: report.profileVersion,
      sourceType: model.sourceType,
      fileName: input.fileName,
      results: toJson(report.results),
      letterText: report.letter.text,
      stats: toJson(report.stats),
      checkedById: input.userId,
      checkedAt: checkedAtSafe,
      profileOverride: input.profileId ?? null,
      // A direct upload is the source already; the multipart path stores it below.
      sourcePath: input.sourcePath ?? null,
    },
    select: { id: true },
  });

  // Keep the source even when formatting is off so the editor can format later
  // via POST /reports/[id]/format. Storage trouble must not fail the check.
  let sourcePath: string | null = input.sourcePath ?? null;
  if (!sourcePath) {
    try {
      sourcePath = await storeSource(row.id, input.buffer, input.fileType);
      await prisma.formatCheckReport.update({ where: { id: row.id }, data: { sourcePath } });
    } catch (error) {
      console.error("[format] Could not store the source file:", error);
    }
  }

  await auditLogger.log({
    action: FORMAT_CHECK_AUDIT_ACTION,
    category: "COMPLIANCE",
    actorType: "user",
    actorId: input.userId,
    entityType: input.manuscript ? "Manuscript" : "FormatCheckReport",
    entityId: input.manuscript?.id ?? row.id,
    description: `Pre-accept format check against ${profile.name} (${profile.id}@${profile.version})`,
    metadata: {
      kind: "format_check",
      reportId: row.id,
      profileId: report.profileId,
      profileVersion: report.profileVersion,
      journalId: input.journal?.id ?? null,
      summary: report.summary,
    },
  });

  const body: CheckResponseBody = {
    reportId: row.id,
    report,
    manuscript: manuscriptSummaryFromModel(model, input.manuscript?.title),
    profile: profileSummary(profile),
  };

  if (input.format !== false && sourcePath) {
    try {
      const formatted = await runFormatting({
        reportId: row.id,
        model,
        profile,
        report,
        sourceBuffer: input.buffer,
        fileType: input.fileType,
        journalName: input.journal?.name ?? profile.name,
        elapsedMs: Date.now() - startedAt,
        sourcePath,
      });
      await prisma.formatCheckReport.update({ where: { id: row.id }, data: formatted.data });
      body.formatting = formatted.block;
      // The composed letter (plan items + unaddressed failed checks) replaces the check-only letter.
      body.report = { ...report, letter: { ...report.letter, text: formatted.block.letter.text } };
    } catch (error) {
      // The checks stand on their own; report the failure instead of losing them.
      console.error("[format] Formatting failed:", error);
      body.formattingError = "The journal-ready document could not be generated. The checks above are unaffected.";
    }
  } else if (input.format !== false) {
    body.formattingError = "The source file could not be stored, so no journal-ready document was generated.";
  }

  return body;
}
