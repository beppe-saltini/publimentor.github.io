/**
 * Formatting step shared by the check routes and POST /api/format/reports/[id]/format.
 *
 *   source bytes + ManuscriptModel + FormatCheckReport
 *     -> formatManuscript (engine)  -> store formatted/tracked .docx
 *     -> row fields (formatPlan, paths, changeLogText, letterText, formattedAt)
 *     -> `formatting` response block
 *
 * The same block is rebuilt from a stored row by formattingBlockFromPlan so
 * GET /api/format/reports/[id] and the fresh POST answers have one shape:
 *   { summary, operations, authorActions, letter, downloads }
 * where every download is a /api/format/reports/{id}/file?kind=... URL.
 *
 * Reference repair talks to Crossref (roughly 0.3 s per entry with the
 * engine's politeness delay), so it is skipped when the list is longer than
 * REFERENCE_LOOKUP_CAP or when less than MIN_REPAIR_BUDGET_MS of the route's
 * 300 s budget remains after the checks; the references are then formatted
 * offline and the block says so in `notes`.
 */

import { Prisma } from "@prisma/client";
import {
  composeAuthorLetter,
  formatManuscript,
  type FormatCheckReport,
  type FormatOperation,
  type FormatPlan,
  type JournalProfile,
  type ManuscriptModel,
} from "./format-lib";
import { DOCX_MIME, MIME_FOR_TYPE, type AcceptedFileType } from "./file-input";
import { formatReportPaths, putObject } from "./format-storage";

/** Longest reference list we still look up on Crossref inside one request. */
export const REFERENCE_LOOKUP_CAP = 150;
/** Remaining request time below which Crossref lookups are skipped. */
export const MIN_REPAIR_BUDGET_MS = 90_000;
/** Vercel function limit for the routes (maxDuration = 300). */
export const ROUTE_BUDGET_MS = 300_000;

/** composeAuthorLetter's result (declared here so this module types independently of the engine). */
export interface ComposedLetterItem {
  text: string;
  checkIds?: string[];
  /** "plan": engine author action; "check": failed check the engine did not address. */
  origin: "plan" | "check";
}
export interface ComposedLetter {
  preamble: string;
  items: ComposedLetterItem[];
  closing: string;
  text: string;
}

export interface FormattingSummary {
  automatic: number;
  needsAuthor: number;
  referencesMatched: number;
  referencesTotal: number;
}

export interface FormattingDownloads {
  formatted: string;
  tracked?: string;
  changeLog: string;
  letter: string;
}

export interface FormattingBlock {
  summary: FormattingSummary;
  operations: FormatOperation[];
  authorActions: Array<FormatPlan["authorActions"][number] & { origin: "plan" | "check" }>;
  letter: ComposedLetter;
  downloads: FormattingDownloads;
  /** When the stored output was generated (ISO), absent on a fresh run until persisted. */
  formattedAt?: string;
  /** Degradations the editor should know about (e.g. Crossref lookups skipped). */
  notes?: string[];
}

/** Columns written on the report row once formatting has run. */
export type FormattingRowData = Pick<
  Prisma.FormatCheckReportUncheckedUpdateInput,
  "formatPlan" | "sourcePath" | "formattedPath" | "trackedPath" | "changeLogText" | "formattedAt" | "letterText"
>;

// ------------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------------

/** Same as run-check's toJson (kept local so run-check can import this module without a cycle). */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Download URLs for a report; `tracked` only when a tracked file exists. */
export function downloadsFor(reportId: string, hasTracked: boolean): FormattingDownloads {
  const base = `/api/format/reports/${reportId}/file?kind=`;
  return {
    formatted: `${base}formatted`,
    ...(hasTracked ? { tracked: `${base}tracked` } : {}),
    changeLog: `${base}change-log`,
    letter: `${base}letter`,
  };
}

export function summaryFromPlan(plan: FormatPlan): FormattingSummary {
  return {
    automatic: plan.stats?.automatic ?? plan.operations.filter((o) => o.automatic).length,
    needsAuthor: plan.stats?.needsAuthor ?? plan.operations.filter((o) => !o.automatic).length,
    referencesMatched: plan.references.filter((r) => r.matched).length,
    referencesTotal: plan.references.length,
  };
}

/** The layout is only needed to render the .docx, which is stored; drop it before persisting. */
export function stripLayout(plan: FormatPlan): FormatPlan {
  const { layout: _layout, ...rest } = plan;
  void _layout;
  return rest;
}

/** Defensive parse of the formatPlan Json column; null when absent or malformed. */
export function parseStoredPlan(json: unknown): FormatPlan | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const p = json as Partial<FormatPlan>;
  if (typeof p.profileId !== "string" || !Array.isArray(p.operations)) return null;
  return {
    profileId: p.profileId,
    targetStructureVersion: typeof p.targetStructureVersion === "string" ? p.targetStructureVersion : "unknown",
    operations: p.operations,
    references: Array.isArray(p.references) ? p.references : [],
    authorActions: Array.isArray(p.authorActions) ? p.authorActions : [],
    stats: p.stats ?? { automatic: 0, needsAuthor: 0 },
  };
}

/**
 * Letter items carry their origin so the UI can tell engine-detected actions
 * from check-derived ones; the plan's authorActions get the same tag.
 */
function taggedAuthorActions(plan: FormatPlan, letter: ComposedLetter): FormattingBlock["authorActions"] {
  const origins = new Map<string, ComposedLetterItem["origin"]>(letter.items.map((i) => [i.text.trim(), i.origin]));
  return plan.authorActions.map((a) => ({ ...a, origin: origins.get(a.text.trim()) ?? "plan" }));
}

/**
 * Assemble the response block from a plan. `letterText` is the stored letter
 * (possibly hand-edited by the editor) and wins over the recomposed text, the
 * same way the check letter does in report-access.
 */
export function formattingBlockFromPlan(args: {
  reportId: string;
  plan: FormatPlan;
  report: FormatCheckReport;
  profile: JournalProfile;
  sourceType: string;
  hasTracked: boolean;
  letterText?: string;
  formattedAt?: Date | null;
  notes?: string[];
}): FormattingBlock {
  const composed: ComposedLetter = composeAuthorLetter({ plan: args.plan, report: args.report, profile: args.profile, sourceType: args.sourceType });
  const letter: ComposedLetter = args.letterText !== undefined ? { ...composed, text: args.letterText } : composed;
  return {
    summary: summaryFromPlan(args.plan),
    operations: args.plan.operations,
    authorActions: taggedAuthorActions(args.plan, letter),
    letter,
    downloads: downloadsFor(args.reportId, args.hasTracked),
    ...(args.formattedAt ? { formattedAt: args.formattedAt.toISOString() } : {}),
    ...(args.notes?.length ? { notes: args.notes } : {}),
  };
}

// ------------------------------------------------------------------
// Running the engine
// ------------------------------------------------------------------

export interface RunFormattingInput {
  reportId: string;
  model: ManuscriptModel;
  profile: JournalProfile;
  report: FormatCheckReport;
  sourceBuffer: Buffer;
  fileType: AcceptedFileType;
  journalName: string;
  /** Explicit wish from the caller; undefined lets the budget rules decide. */
  repairReferences?: boolean;
  /** Milliseconds already spent in this request (checks, download...). */
  elapsedMs?: number;
}

export interface RunFormattingResult {
  block: FormattingBlock;
  data: FormattingRowData;
}

/** Decide whether Crossref lookups fit the request; returns the reason when they do not. */
export function repairDecision(input: Pick<RunFormattingInput, "model" | "repairReferences" | "elapsedMs">): { repair: boolean; note?: string } {
  if (input.repairReferences === false) return { repair: false };
  const total = input.model.references?.entries?.length ?? 0;
  if (total > REFERENCE_LOOKUP_CAP) {
    return { repair: false, note: `References were formatted offline: the list has ${total} entries, above the ${REFERENCE_LOOKUP_CAP}-entry Crossref lookup cap.` };
  }
  if ((input.elapsedMs ?? 0) > ROUTE_BUDGET_MS - MIN_REPAIR_BUDGET_MS) {
    return { repair: false, note: "References were formatted offline: not enough time was left in the request for Crossref lookups." };
  }
  return { repair: true };
}

/** Store the source file; the key depends on the file type. */
export async function storeSource(reportId: string, buffer: Buffer, fileType: AcceptedFileType): Promise<string> {
  const { source } = formatReportPaths(reportId, fileType);
  await putObject(source, buffer, MIME_FOR_TYPE[fileType]);
  return source;
}

/**
 * Run the engine, store its documents and return both the response block and
 * the row columns to persist. The source must already be stored (storeSource);
 * its key is returned in `data.sourcePath` for convenience.
 */
export async function runFormatting(input: RunFormattingInput): Promise<RunFormattingResult> {
  const decision = repairDecision(input);
  const result = await formatManuscript({
    model: input.model,
    profile: input.profile,
    report: input.report,
    // Tracked changes need the original .docx bytes; a PDF source gets only the rebuilt document.
    sourceBuffer: input.model.sourceType === "docx" ? input.sourceBuffer : undefined,
    journalName: input.journalName,
    repairReferences: decision.repair,
  });

  const paths = formatReportPaths(input.reportId, input.fileType);
  await putObject(paths.formatted, result.rebuilt.buffer, result.rebuilt.contentType || DOCX_MIME);
  const hasTracked = !!result.tracked;
  if (result.tracked) await putObject(paths.tracked, result.tracked.buffer, result.tracked.contentType || DOCX_MIME);

  const formattedAt = new Date();
  const plan = stripLayout(result.plan);
  const notes = decision.note ? [decision.note] : [];
  const block: FormattingBlock = {
    summary: result.summary ?? summaryFromPlan(plan),
    operations: plan.operations,
    authorActions: taggedAuthorActions(plan, result.letter),
    letter: result.letter,
    downloads: downloadsFor(input.reportId, hasTracked),
    formattedAt: formattedAt.toISOString(),
    ...(notes.length ? { notes } : {}),
  };
  return {
    block,
    data: {
      formatPlan: toJson(plan),
      sourcePath: paths.source,
      formattedPath: paths.formatted,
      trackedPath: hasTracked ? paths.tracked : null,
      changeLogText: result.changeLog,
      formattedAt,
      letterText: result.letter.text,
    },
  };
}
