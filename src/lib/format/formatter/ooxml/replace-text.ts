/**
 * Text-level operations: retitle_legend, retitle_supplemental, add_see_also,
 * rewrite_reference, add_doi, split_summary, convert_citations.
 *
 * `before` is the text as the planner saw it (a whole paragraph, a title, or
 * a truncated snippet ending in "…"); `after` is the replacement. The
 * paragraph is located by that text and edited with the smallest tracked
 * change that gets there: a minimal word diff for whole paragraphs, head/tail
 * anchored edits for titles, and an append when `after` merely extends
 * `before`. Nothing is guessed: an ambiguous match is logged and skipped.
 */
import type { FormatOperation } from "../types";
import { logOp, type ApplyContext } from "./context";
import { findHeadingByText, findSlotByKind } from "./destinations";
import { allParagraphs, locateParagraph, normalizeText, paragraphText } from "./paragraphs";
import { alignEdits, isTruncated, stripTruncation, type AlignedEdits, type Edit } from "./text-diff";
import { replaceParagraphRange, replaceParagraphSpan, replaceParagraphText } from "./tracked";

export function applyTextOperation(ctx: ApplyContext, op: FormatOperation): void {
  const skip = (why: string) => logOp(ctx, op.id, op.kind, op.automatic ? "skipped" : "manual", why);
  if (!op.automatic) return skip(op.needsAuthorInput ?? op.description);
  const rawBefore = op.before ?? referenceOriginal(ctx, op);
  if (!rawBefore || op.after === undefined) return skip(`${op.kind} needs before/after`);

  const beforeTruncated = isTruncated(rawBefore);
  const afterTruncated = isTruncated(op.after);
  const before = stripTruncation(rawBefore);
  const after = stripTruncation(op.after);
  if (before.trim() === "" || normalizeText(before) === normalizeText(after)) return skip("text already conforms");

  const paragraphs = allParagraphs(ctx.body);
  const found = locateParagraph(paragraphs, before, ctx.heading, { from: searchStart(ctx, op, paragraphs), minScore: 0.55 });
  if (!found) return skip(`text "${before.slice(0, 60)}" not found`);
  const current = paragraphText(found.paragraph);

  // 1. The whole paragraph is the quoted text: align on words (so a title gets its
  //    label in front and its ending changed) or, failing that, a minimal diff.
  if (!beforeTruncated && !afterTruncated && normalizeText(current) === normalizeText(before)) {
    const aligned = alignEdits(current, after, true, true);
    if (aligned) return applyAligned(ctx, op, found.paragraph, 0, aligned, skip);
    const result = replaceParagraphText(found.paragraph, after, ctx.rev);
    return logOp(ctx, op.id, op.kind, "applied", `"${result.deleted.slice(0, 50)}" -> "${result.inserted.slice(0, 50)}"`);
  }

  // 2. The quoted text is (the start of) a substring, e.g. a legend title: edit the
  //    head ("Fig. 3 |" -> "Figure 3.") and, when both texts are complete, the rest.
  const range = substringRange(current, before) ?? (beforeTruncated ? prefixRange(current, before) : null);
  if (range) {
    const aligned = alignEdits(current.slice(range.start, range.end), after, !beforeTruncated, !afterTruncated);
    if (aligned) return applyAligned(ctx, op, found.paragraph, range.start, aligned, skip);
    if (beforeTruncated || afterTruncated) return skip(`cannot align truncated snippet "${before.slice(0, 40)}"`);
    replaceParagraphSpan(found.paragraph, range.start, range.end, after, ctx.rev);
    return logOp(ctx, op.id, op.kind, "applied", `replaced "${before.slice(0, 40)}" in paragraph`);
  }

  // 3. `after` extends `before` (see-also notes, DOIs): append/prepend the extra
  //    text, which stays right even when an earlier operation edited the paragraph.
  if (!beforeTruncated && after.startsWith(before)) {
    const tail = after.slice(before.length);
    replaceParagraphRange(found.paragraph, current.length, current.length, tail, ctx.rev);
    return logOp(ctx, op.id, op.kind, "applied", `appended "${tail.trim().slice(0, 40)}"`);
  }
  if (!beforeTruncated && after.endsWith(before)) {
    const head = after.slice(0, after.length - before.length);
    replaceParagraphRange(found.paragraph, 0, 0, head, ctx.rev);
    return logOp(ctx, op.id, op.kind, "applied", `prepended "${head.trim().slice(0, 40)}"`);
  }

  // 4. Fuzzy match (PDF-derived text with different spacing/hyphenation): rewrite
  //    the paragraph, but only when the quoted text plausibly *is* the paragraph.
  if (beforeTruncated || afterTruncated) return skip(`cannot align truncated snippet "${before.slice(0, 40)}"`);
  const ratio = before.length / Math.max(current.length, 1);
  if (ratio < 0.7 || ratio > 1.4) return skip(`ambiguous match (${found.score.toFixed(2)}) for "${before.slice(0, 40)}"`);
  const result = replaceParagraphText(found.paragraph, after, ctx.rev);
  logOp(ctx, op.id, op.kind, "applied", `rewrote paragraph (fuzzy match ${found.score.toFixed(2)}): "${result.inserted.slice(0, 40)}"`);
}

/** Apply aligned edits (remainder first so head offsets stay valid), each as a minimal word diff. */
function applyAligned(ctx: ApplyContext, op: FormatOperation, p: Element, offset: number, aligned: AlignedEdits, skip: (why: string) => void): void {
  const details: string[] = [];
  for (const edit of [aligned.remainder, aligned.head].filter((e): e is Edit => e !== null)) {
    const result = replaceParagraphSpan(p, offset + edit.start, offset + edit.end, edit.text, ctx.rev);
    if (result.deleted || result.inserted) details.push(`"${result.deleted.slice(0, 40)}" -> "${result.inserted.slice(0, 40)}"`);
  }
  if (details.length === 0) return skip("text already conforms");
  logOp(ctx, op.id, op.kind, "applied", details.join(", "));
}

/** Reference edits search from the references heading on, never in the body text. */
function searchStart(ctx: ApplyContext, op: FormatOperation, paragraphs: Element[]): number {
  if (op.kind !== "rewrite_reference" && op.kind !== "add_doi") return 0;
  const slot = findSlotByKind(ctx.target, "references")?.slot;
  if (!slot) return 0;
  for (const name of [slot.heading, ...slot.aliases]) {
    const found = findHeadingByText(ctx, name);
    if (found) return paragraphs.indexOf(found.paragraph) + 1;
  }
  return 0;
}

/** Original text of the reference an operation rewrites, from plan.references. */
function referenceOriginal(ctx: ApplyContext, op: FormatOperation): string | undefined {
  if (!op.after) return undefined;
  return ctx.plan.references.find((r) => r.formatted === op.after)?.original;
}

/**
 * A truncated snippet may run past the end of the paragraph it starts in (a
 * title-only legend line followed by its body paragraph): retry with shorter
 * word prefixes of the snippet, down to five words.
 */
function prefixRange(haystack: string, needle: string): { start: number; end: number } | null {
  const words = needle.trim().split(/\s+/);
  for (let n = words.length - 1; n >= 5; n--) {
    const range = substringRange(haystack, words.slice(0, n).join(" "));
    if (range) return range;
  }
  return null;
}

/** Range of `needle` in `haystack`, tolerant of whitespace differences. */
export function substringRange(haystack: string, needle: string): { start: number; end: number } | null {
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return { start: direct, end: direct + needle.length };
  const words = needle.trim().split(/\s+/);
  if (words.length === 0 || words[0] === "") return null;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern).exec(haystack);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
