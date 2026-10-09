/**
 * applyPlanToDocx: apply a FormatPlan to the authors' original Word file as
 * tracked changes (author "PubliMentor"), so they can review every edit in
 * Word's Review pane and accept or reject it.
 *
 * Pipeline: unzip -> parse word/document.xml -> coalesce fragmented runs ->
 * apply operations as w:ins/w:del -> serialize without pretty-printing ->
 * zip. Nothing else in the package is touched, except that Heading1/Heading2
 * are added to word/styles.xml when the document defines no heading styles
 * (inserted section headings need them).
 */
import type { FormatOperation, FormatPlan, FormattedDocument, TargetStructure } from "./types";
import { createApplyContext, type AppliedOperation } from "./ooxml/context";
import { mergeRuns } from "./ooxml/merge-runs";
import { applyOperation } from "./ooxml/operations";
import {
  DOCUMENT_PART,
  DOCX_CONTENT_TYPE,
  STYLES_PART,
  ensurePartRegistered,
  openDocx,
  writeDocx,
} from "./ooxml/package";
import { ensureHeadingStyles, hasHeadingStyles, parseStyleMap } from "./ooxml/styles";
import { createRevisionContext, revisionDate } from "./ooxml/tracked";
import { parseXml, serializeXml } from "./ooxml/xml";

export {
  acceptAllChanges,
  extractParagraphTexts,
  listTrackedChanges,
  validateTrackedChanges,
  type TrackedChange,
  type ValidationResult,
} from "./ooxml/inspect";
export type { AppliedOperation } from "./ooxml/context";

export const TRACKED_CHANGES_AUTHOR = "PubliMentor";

const STYLES_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
const STYLES_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";

export interface ApplyDocxOptions {
  /** Revision author shown in Word. Default "PubliMentor". */
  author?: string;
  /** Original file name, used to derive the output name. */
  fileName?: string;
  /** Fixed revision timestamp (tests); defaults to now. */
  date?: Date;
}

/** A tracked FormattedDocument plus the per-operation outcome log. */
export interface TrackedDocument extends FormattedDocument {
  kind: "tracked";
  applied: AppliedOperation[];
  stats: { applied: number; skipped: number; manual: number; runsMerged: number };
}

/**
 * Apply `plan` to the original .docx and return it with tracked changes.
 * Operations whose text cannot be located are logged as skipped, never
 * guessed: a wrong edit in a manuscript is worse than a missing one.
 */
export async function applyPlanToDocx(
  original: Buffer,
  plan: FormatPlan,
  target: TargetStructure,
  options: ApplyDocxOptions = {}
): Promise<TrackedDocument> {
  const author = options.author ?? TRACKED_CHANGES_AUTHOR;
  const opened = await openDocx(original);
  const doc = parseXml(opened.documentXml);

  const runsMerged = mergeRuns(doc);

  // Heading styles: reuse the document's, or add Heading1/Heading2.
  let styleMap = parseStyleMap(opened.stylesXml);
  const parts: Record<string, string> = {};
  if (!hasHeadingStyles(styleMap)) {
    const ensured = ensureHeadingStyles(opened.stylesXml);
    if (ensured.added) {
      parts[STYLES_PART] = ensured.xml;
      styleMap = parseStyleMap(ensured.xml);
      if (!opened.stylesXml) await ensurePartRegistered(opened.zip, STYLES_PART, STYLES_REL_TYPE, STYLES_CONTENT_TYPE);
    }
  }

  const rev = createRevisionContext(doc, author, revisionDate(options.date));
  const ctx = createApplyContext(doc, rev, target, plan, styleMap);
  for (const op of orderOperations(plan.operations)) applyOperation(ctx, op);

  parts[DOCUMENT_PART] = serializeXml(doc, opened.documentXml);
  const buffer = await writeDocx(opened.zip, parts);

  const count = (status: AppliedOperation["status"]) => ctx.log.filter((l) => l.status === status).length;
  return {
    kind: "tracked",
    buffer,
    fileName: trackedOutputFileName(options.fileName, target.profileId),
    contentType: DOCX_CONTENT_TYPE,
    applied: ctx.log,
    stats: { applied: count("applied"), skipped: count("skipped"), manual: count("manual"), runsMerged },
  };
}

/**
 * Apply operations in an order that keeps later look-ups valid: text-level
 * edits first (they match on the original wording), then heading renames
 * (destinations are resolved by slot aliases either way), then structural
 * moves and insertions, and finally the KRT.
 */
export function orderOperations(operations: FormatOperation[]): FormatOperation[] {
  const rank: Record<FormatOperation["kind"], number> = {
    retitle_legend: 0,
    retitle_supplemental: 0,
    add_see_also: 0,
    rewrite_reference: 0,
    add_doi: 0,
    convert_citations: 0,
    split_summary: 0,
    rename_heading: 1,
    merge_sections: 2,
    move_block: 3,
    collect_legends: 3,
    insert_section: 4,
    insert_placeholder: 4,
    prefill_krt: 5,
    note: 6,
  };
  return operations
    .map((op, i) => ({ op, i }))
    .sort((a, b) => rank[a.op.kind] - rank[b.op.kind] || a.i - b.i)
    .map(({ op }) => op);
}

/** "<base>-<profile>-tracked.docx", base from the original name. */
export function trackedOutputFileName(fileName: string | undefined, profileId: string): string {
  const base = (fileName ?? "manuscript")
    .replace(/^.*[\\/]/, "")
    .replace(/\.(docx|doc|pdf)$/i, "")
    .replace(/[^\w.-]+/g, "_") || "manuscript";
  return `${base}-${profileId}-tracked.docx`;
}
