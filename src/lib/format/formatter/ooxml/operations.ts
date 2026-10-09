/**
 * Maps each FormatOperation kind onto tracked-change primitives.
 *
 * Field conventions (shared with the planner, see layout.ts / legends.ts):
 *  - rename_heading:      before = current heading text, after = new text
 *  - move_block:          before = heading of the section (or first line of
 *                         the block) to move and slotId/after = destination;
 *                         slotId alone = move the section already matching
 *                         that slot to its journal position; slotId + after
 *                         (content snippet) = move that paragraph into the
 *                         slot, creating the slot heading
 *  - collect_legends:     every "Figure N"/"Fig. N |" paragraph moves to the
 *                         legends slot
 *  - insert_section /
 *    insert_placeholder:  slotId = slot to create/fill, after = text (else
 *                         the slot's placeholderTemplate; `after` equal to
 *                         the slot heading just creates the heading)
 *  - merge_sections:      before = heading(s) to dissolve, " / "-separated;
 *                         slotId = destination
 *  - text kinds:          see replace-text.ts
 *  - prefill_krt:         inserts the Key Resources Table skeleton
 *  - note:                no document change
 * Structural operations run only when `automatic` is true; the insert kinds
 * turn non-automatic operations into highlighted placeholders; everything
 * else non-automatic is logged as "manual" for the author letter.
 */
import type { FormatOperation } from "../types";
import { logOp, type ApplyContext } from "./context";
import {
  bodySectPr,
  findHeadingByText,
  findSlot,
  findSlotByKind,
  findSlotHeading,
  resolveDestination,
  sectionStartAnchor,
  slotOrderAnchor,
} from "./destinations";
import { buildKrtTable } from "./krt";
import {
  allParagraphs,
  blockIndexOf,
  bodyBlocks,
  classifyHeading,
  isParagraphDeleted,
  locateParagraph,
  normalizeText,
  paragraphText,
  runText,
  sectionEnd,
  visibleRuns,
  type Located,
} from "./paragraphs";
import { applyTextOperation } from "./replace-text";
import { stripTruncation } from "./text-diff";
import {
  createInsertedParagraph,
  deleteParagraph,
  deleteTable,
  markBlockInserted,
  replaceParagraphText,
  type RunSpec,
} from "./tracked";
import { childW, getW, isW, type XmlElement, type XmlNode } from "./xml";

const LEGEND_START_RE = /^(figure|fig\.?)\s*s?\d+[a-z]?\s*(\||[.:—–-]|$)/i;
const BRACKET_TOKEN_SPLIT_RE = /(\[[^\]]+\])/;
const BRACKET_TOKEN_RE = /^\[[^\]]+\]$/;

export function applyOperation(ctx: ApplyContext, op: FormatOperation): void {
  switch (op.kind) {
    case "rename_heading":
      return renameHeading(ctx, op);
    case "move_block":
      return moveBlock(ctx, op);
    case "collect_legends":
      return collectLegends(ctx, op);
    case "insert_section":
    case "insert_placeholder":
      return insertSection(ctx, op);
    case "merge_sections":
      return mergeSections(ctx, op);
    case "prefill_krt":
      return prefillKrt(ctx, op);
    case "note":
      return logOp(ctx, op.id, op.kind, op.automatic ? "skipped" : "manual", op.description);
    default:
      return applyTextOperation(ctx, op);
  }
}

/* -------------------------------------------------------------- helpers */

function skip(ctx: ApplyContext, op: FormatOperation, why: string): void {
  logOp(ctx, op.id, op.kind, op.automatic ? "skipped" : "manual", why);
}

/** Structural operations need `automatic`; otherwise they are the authors' call. */
function manualGuard(ctx: ApplyContext, op: FormatOperation): boolean {
  if (op.automatic) return false;
  logOp(ctx, op.id, op.kind, "manual", op.needsAuthorInput ?? op.description);
  return true;
}

/** Every visible run with text is bold (used to spot title-only legend lines). */
function allRunsBold(p: XmlElement): boolean {
  const runs = visibleRuns(p).filter((r) => runText(r).trim() !== "");
  return runs.length > 0 && runs.every((r) => {
    const rPr = childW(r, "rPr");
    const b = rPr && childW(rPr, "b");
    return !!b && !["0", "false"].includes(getW(b, "val") ?? "");
  });
}

/** Split text into runs, highlighting "[TOKEN]" placeholders and prefixed notes. */
function placeholderRuns(ctx: ApplyContext, text: string, highlightAll: boolean): RunSpec[] {
  const color = ctx.target.placeholderStyle.highlight;
  if (highlightAll || text.startsWith(ctx.target.placeholderStyle.prefix.trim())) return [{ text, highlight: color }];
  return text
    .split(BRACKET_TOKEN_SPLIT_RE)
    .filter((part) => part !== "")
    .map((part) => (BRACKET_TOKEN_RE.test(part) ? { text: part, highlight: color } : { text: part }));
}

/** Clone + mark inserted before `anchor`, then delete the originals. */
function moveBlocks(ctx: ApplyContext, blocks: XmlElement[], anchor: XmlNode | null): void {
  for (const block of blocks) {
    const clone = block.cloneNode(true) as XmlElement;
    markBlockInserted(clone, ctx.rev);
    ctx.body.insertBefore(clone, anchor);
  }
  for (const block of blocks) {
    if (isW(block, "p")) deleteParagraph(block, ctx.rev);
    else if (isW(block, "tbl")) deleteTable(block, ctx.rev);
  }
}

/** Blocks [start, end) of the body, excluding ones already deleted by us. */
function liveBlocks(ctx: ApplyContext, start: number, end: number): XmlElement[] {
  return bodyBlocks(ctx.body)
    .slice(start, end)
    .filter((b) => !(isW(b, "p") && isParagraphDeleted(b)));
}

/** True when inserting before `anchor` would leave `range` where it already is. */
function alreadyThere(ctx: ApplyContext, range: XmlElement[], end: number, anchor: XmlNode | null): boolean {
  if (anchor && range.includes(anchor as XmlElement)) return true;
  const blocks = bodyBlocks(ctx.body);
  return anchor === blocks[end] || (anchor === bodySectPr(ctx) && end === blocks.length);
}

/* ----------------------------------------------------------- operations */

function renameHeading(ctx: ApplyContext, op: FormatOperation): void {
  if (manualGuard(ctx, op)) return;
  if (!op.before || !op.after) return skip(ctx, op, "rename_heading needs before/after");
  const found = findHeadingByText(ctx, op.before);
  if (!found) return skip(ctx, op, `heading "${op.before}" not found`);
  const result = replaceParagraphText(found.paragraph, op.after, ctx.rev);
  logOp(ctx, op.id, op.kind, "applied", `"${result.deleted}" -> "${result.inserted}"`);
}

function moveBlock(ctx: ApplyContext, op: FormatOperation): void {
  if (manualGuard(ctx, op)) return;
  const blocks = bodyBlocks(ctx.body);
  const slotRef = findSlot(ctx.target, op.slotId);
  // `after` names a destination only when it is, exactly, an existing heading;
  // otherwise it is the planner's snippet of the content to move.
  const afterIsHeading = !!op.after && !!locateParagraph(blocks, op.after, ctx.heading, { headingsOnly: true, minScore: 1 });

  // Which block moves?
  let sourceText = op.before ? stripTruncation(op.before) : undefined;
  let contentMove = false;
  if (!sourceText && op.after && slotRef && !afterIsHeading) {
    sourceText = stripTruncation(op.after); // planner: content snippet to move into the slot
    contentMove = true;
  }
  const firstLine = sourceText?.split("\n")[0] ?? "";
  let found: Located | null = null;
  if (contentMove) {
    // The snippet may span what Word holds as several paragraphs: fall back to its first words.
    const opening = firstLine.split(/\s+/).slice(0, 8).join(" ");
    found =
      locateParagraph(blocks, firstLine, ctx.heading, { bodyOnly: true, minScore: 0.85 }) ??
      locateParagraph(blocks, opening, ctx.heading, { bodyOnly: true, minScore: 0.9 });
  }
  else if (sourceText) {
    found =
      locateParagraph(blocks, firstLine, ctx.heading, { headingsOnly: true, minScore: 0.9 }) ??
      locateParagraph(blocks, firstLine, ctx.heading, { minScore: 0.85 });
  }
  const ownSlotMove = !sourceText && !!slotRef;
  if (ownSlotMove) found = findSlotHeading(ctx, slotRef.slot);
  if (!found) return skip(ctx, op, sourceText ? `block "${sourceText.slice(0, 60)}" not found` : `no section matches slot ${op.slotId}`);

  let end = found.index + 1;
  if (classifyHeading(found.paragraph, ctx.heading)) end = sectionEnd(blocks, found.index, ctx.heading);
  else if (sourceText) {
    // Multi-paragraph block quoted line by line.
    for (const line of sourceText.split("\n").slice(1)) {
      const next = blocks[end];
      if (next && isW(next, "p") && normalizeText(paragraphText(next)) === normalizeText(line)) end++;
      else break;
    }
  }
  const range = liveBlocks(ctx, found.index, end);

  // Where does it go? A section that *is* its slot moves to the slot's position
  // in the journal order; anything else goes into the destination section.
  const isOwnSlotHeading = ownSlotMove || (!!slotRef && !op.after && findSlotHeading(ctx, slotRef.slot)?.paragraph === found.paragraph);
  const anchor = isOwnSlotHeading
    ? slotOrderAnchor(ctx, op.slotId!, [found.paragraph])
    : resolveDestination(ctx, {
        slotId: op.slotId,
        after: contentMove ? undefined : op.after,
        createIfMissing: true,
        position: contentMove ? "start" : "end",
        exclude: [found.paragraph],
      })?.anchor;
  if (anchor === undefined) return skip(ctx, op, "destination not found (needs after or slotId)");
  if (alreadyThere(ctx, range, end, anchor)) return skip(ctx, op, "block already at destination");
  const label = paragraphText(range[0]).slice(0, 40);
  moveBlocks(ctx, range, anchor);
  logOp(ctx, op.id, op.kind, "applied", `moved ${range.length} block(s) "${label}"`);
}

function collectLegends(ctx: ApplyContext, op: FormatOperation): void {
  if (manualGuard(ctx, op)) return;
  const slotId = op.slotId ?? findSlotByKind(ctx.target, "legends")?.slot.id;
  const dest = resolveDestination(ctx, { slotId, after: op.after, createIfMissing: true });
  if (!dest) return skip(ctx, op, "no legends slot in target structure");

  const blocks = bodyBlocks(ctx.body);
  const destStart = dest.headingIndex ?? -1;
  const destEnd = destStart >= 0 ? sectionEnd(blocks, destStart, ctx.heading) : -1;
  const legends: XmlElement[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!isW(block, "p") || isParagraphDeleted(block)) continue;
    if (i > destStart && i < destEnd) continue; // already in the legends section
    const text = paragraphText(block).trim();
    if (!LEGEND_START_RE.test(text) || classifyHeading(block, ctx.heading)) continue;
    const group = [block];
    // A title-only legend line ("Figure 1. Title", often all bold) is followed by its body paragraph.
    const next = blocks[i + 1];
    const titleOnly = allRunsBold(block) || !/[.!?]\s+[A-Z(]/.test(text.replace(/^(figure|fig\.?)\s*s?\d+[a-z]?\s*/i, ""));
    if (titleOnly && next && isW(next, "p") && !isParagraphDeleted(next)) {
      const nextText = paragraphText(next).trim();
      if (nextText && !LEGEND_START_RE.test(nextText) && !classifyHeading(next, ctx.heading)) {
        group.push(next);
        i++;
      }
    }
    legends.push(group);
  }
  if (legends.length === 0) return skip(ctx, op, "no interspersed figure legends found");
  for (const group of legends) moveBlocks(ctx, group, dest.anchor);
  logOp(ctx, op.id, op.kind, "applied", `gathered ${legends.length} legend(s)`);
}

function insertSection(ctx: ApplyContext, op: FormatOperation): void {
  const ref = findSlot(ctx.target, op.slotId);
  const headingOnly = !!ref && !!op.after && normalizeText(op.after) === normalizeText(ref.slot.heading);
  const text = headingOnly ? "" : op.after ?? ref?.slot.placeholderTemplate ?? op.needsAuthorInput;
  if (!text && !ref) return skip(ctx, op, "insert needs a slotId or text");
  const highlightAll = op.kind === "insert_placeholder" || !op.automatic;

  let anchor: XmlNode | null;
  let where: string;
  if (ref) {
    const dest = resolveDestination(ctx, { slotId: ref.slot.id, createIfMissing: true, position: "start" });
    if (!dest) return skip(ctx, op, `slot ${op.slotId} unresolved`);
    anchor = dest.created ? dest.anchor : dest.headingIndex !== null ? sectionStartAnchor(ctx, dest.headingIndex) : dest.anchor;
    where = dest.created ? `created "${ref.slot.heading}"` : `under existing "${ref.slot.heading}"`;
  } else if (op.before) {
    const found = findHeadingByText(ctx, op.before) ?? locateParagraph(allParagraphs(ctx.body), op.before, ctx.heading);
    if (!found) return skip(ctx, op, `anchor "${op.before}" not found`);
    const index = blockIndexOf(bodyBlocks(ctx.body), found.paragraph, ctx.body);
    anchor = bodyBlocks(ctx.body)[index + 1] ?? bodySectPr(ctx);
    where = `after "${op.before.slice(0, 40)}"`;
  } else {
    anchor = bodySectPr(ctx);
    where = "at end of document";
  }

  const paragraphs = (text ?? "").split(/\n+/).map((t) => t.trim()).filter((t) => t !== "");
  for (const paragraph of paragraphs) {
    const p = createInsertedParagraph(ctx.doc, ctx.rev, { runs: placeholderRuns(ctx, paragraph, highlightAll) });
    ctx.body.insertBefore(p, anchor);
  }
  logOp(ctx, op.id, op.kind, "applied", `${paragraphs.length} paragraph(s) ${where}${highlightAll && paragraphs.length ? " (placeholder)" : ""}`);
}

function mergeSections(ctx: ApplyContext, op: FormatOperation): void {
  if (manualGuard(ctx, op)) return;
  if (!op.before) return skip(ctx, op, "merge_sections needs before (heading(s) to dissolve)");
  const names = op.before.split(/\s+\/\s+/).map((n) => n.trim()).filter((n) => n !== "");
  const after = op.after && !op.after.includes(" / ") ? op.after : undefined;
  // Resolve every source first: the destination slot's aliases often match the
  // very sections being merged ("Data availability" -> Data and Code Availability).
  const sources = names.map((name) => findHeadingByText(ctx, name)).filter((s): s is NonNullable<typeof s> => s !== null);
  if (sources.length === 0) return skip(ctx, op, `heading(s) "${op.before}" not found`);
  const exclude = sources.map((s) => s.paragraph);
  const dest = resolveDestination(ctx, { slotId: op.slotId, after, createIfMissing: true, exclude });
  if (!dest) return skip(ctx, op, "destination not found");
  let merged = 0;
  for (const source of sources) {
    const blocks = bodyBlocks(ctx.body);
    const index = blocks.indexOf(source.paragraph);
    if (index < 0 || index === dest.headingIndex) continue;
    const end = sectionEnd(blocks, index, ctx.heading);
    const bodyRange = liveBlocks(ctx, index + 1, end);
    if (!alreadyThere(ctx, bodyRange, end, dest.anchor)) moveBlocks(ctx, bodyRange, dest.anchor);
    deleteParagraph(source.paragraph, ctx.rev);
    merged++;
  }
  if (merged === 0) return skip(ctx, op, `heading(s) "${op.before}" could not be merged`);
  logOp(ctx, op.id, op.kind, "applied", `merged ${merged} section(s) "${op.before}" into destination`);
}

function prefillKrt(ctx: ApplyContext, op: FormatOperation): void {
  const slotId = op.slotId ?? findSlotByKind(ctx.target, "krt")?.slot.id;
  const dest = resolveDestination(ctx, { slotId, after: op.after, createIfMissing: true, position: "start" });
  if (!dest) return skip(ctx, op, "no Key Resources Table slot");
  const table = buildKrtTable(ctx.doc, ctx.rev, ctx.target, {
    highlight: ctx.target.placeholderStyle.highlight,
    placeholder: `${ctx.target.placeholderStyle.prefix} fill in`.replace(/\s+/g, " ").trim(),
  });
  if (!table) return skip(ctx, op, "target has no krtTemplate");
  ctx.body.insertBefore(table, dest.anchor);
  logOp(ctx, op.id, op.kind, "applied", `Key Resources Table skeleton inserted (${ctx.target.krtTemplate?.headings.length} columns)`);
}

/** Exposed for tests. */
export const legendStartPattern = LEGEND_START_RE;
