/**
 * Paragraph-level view of word/document.xml.
 *
 * Operations in a FormatPlan refer to text the planner saw ("Abstract",
 * "Fig. 1 | ...", a raw reference). This module turns DOM paragraphs into
 * comparable text, decides which paragraphs are headings (real Heading
 * styles, or the short bold pseudo-headings most manuscripts use), computes
 * the extent of a section, and finds the paragraph an operation refers to.
 */
import type { StyleMap } from "./styles";
import {
  childElements,
  childW,
  closestW,
  getW,
  isW,
  localName,
  renderedText,
  type XmlElement,
  type XmlNode,
} from "./xml";

/** Elements whose subtree is not part of the paragraph's own text. */
const RUN_STOP = ["p", "pPr", "del", "moveFrom", "rPr"];

/** Runs of a paragraph that are visible in the "current" (all accepted) view. */
export function visibleRuns(p: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (node: XmlNode) => {
    for (const child of childElements(node)) {
      if (isW(child, "r")) {
        out.push(child);
        continue;
      }
      if (RUN_STOP.some((s) => isW(child, s))) continue;
      visit(child);
    }
  };
  visit(p);
  return out;
}

/** Text drawn for one run (w:t, tabs and breaks); deleted text is not drawn. */
export function runText(run: XmlElement): string {
  let text = "";
  for (const child of childElements(run)) {
    const name = localName(child);
    if (name === "t") text += renderedText(child);
    else if (name === "tab") text += "\t";
    else if (name === "br" || name === "cr") text += "\n";
    else if (name === "noBreakHyphen") text += "-";
  }
  return text;
}

/** Text of a paragraph as Word shows it with all changes accepted. */
export function paragraphText(p: XmlElement): string {
  return visibleRuns(p).map(runText).join("");
}

/** Text of a paragraph with all changes *rejected* (deleted text back, inserted text gone). */
export function paragraphOriginalText(p: XmlElement): string {
  let text = "";
  const visit = (node: XmlNode) => {
    for (const child of childElements(node)) {
      if (isW(child, "ins") || isW(child, "moveTo") || isW(child, "pPr")) continue;
      if (isW(child, "p")) continue;
      if (isW(child, "r")) {
        for (const c of childElements(child)) {
          const name = localName(c);
          if (name === "t" || name === "delText") text += renderedText(c);
          else if (name === "tab") text += "\t";
          else if (name === "br" || name === "cr") text += "\n";
        }
        continue;
      }
      visit(child);
    }
  };
  visit(p);
  return text;
}

/** Paragraph mark carries a tracked deletion (paragraph will merge into the next). */
export function isParagraphMarkDeleted(p: XmlElement): boolean {
  const pPr = childW(p, "pPr");
  const rPr = pPr && childW(pPr, "rPr");
  return !!(rPr && childW(rPr, "del"));
}

export function isParagraphMarkInserted(p: XmlElement): boolean {
  const pPr = childW(p, "pPr");
  const rPr = pPr && childW(pPr, "rPr");
  return !!(rPr && childW(rPr, "ins"));
}

/** Fully deleted: nothing visible remains and the mark is deleted too. */
export function isParagraphDeleted(p: XmlElement): boolean {
  return isParagraphMarkDeleted(p) && paragraphText(p).trim() === "";
}

export function paragraphStyleId(p: XmlElement): string | null {
  const pPr = childW(p, "pPr");
  const pStyle = pPr && childW(pPr, "pStyle");
  return pStyle ? getW(pStyle, "val") : null;
}

/**
 * Normalize text for matching: lower-case, collapse whitespace, strip
 * leading numbering ("2.1 ", "III. "), trailing punctuation and
 * typographic variants of quotes/dashes.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^(\d+(\.\d+)*\.?|[ivx]+\.)\s+/, "")
    .replace(/[\s:.;,\u2026]+$/, "");
}

/** Tokens for Jaccard similarity (letters/digits only, length >= 2). */
function tokens(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(" ")
      .filter((t) => t.length >= 2)
  );
}

export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface HeadingContext {
  styles: StyleMap;
  /** Normalized texts that are top-level section names in the target journal. */
  topLevelNames: Set<string>;
}

export interface HeadingInfo {
  level: number;
  /** "style": a real Heading style; "bold": short bold/caps pseudo-heading. */
  source: "style" | "bold";
}

const BOLD_HEADING_MAX_WORDS = 12;

/**
 * Classify a paragraph as a heading. Real heading styles win; otherwise a
 * short paragraph whose visible runs are all bold (or all caps) counts as a
 * pseudo-heading. Its level is 1 when the journal knows it as a top-level
 * section (Results, Discussion, ...) and 2 otherwise, which is how Nature-
 * style manuscripts distinguish sections from bold subsection titles.
 */
export function classifyHeading(p: XmlElement, ctx: HeadingContext): HeadingInfo | null {
  if (isParagraphDeleted(p)) return null;
  const text = paragraphText(p).trim();
  if (text === "") return null;

  const styleId = paragraphStyleId(p);
  if (styleId) {
    const info = ctx.styles.get(styleId);
    if (info?.headingLevel) return { level: info.headingLevel, source: "style" };
    if (/^heading\s*([1-9])$/i.test(styleId) && !info) {
      return { level: Number(/([1-9])$/.exec(styleId)![1]), source: "style" };
    }
  }

  const words = text.split(/\s+/).length;
  if (words > BOLD_HEADING_MAX_WORDS) return null;
  // Sentences are body text; headings end without a full stop.
  if (/[.!?]$/.test(text)) return null;
  if (/^(fig\.?|figure|table|supplementary|video)\s*s?\d/i.test(text)) return null;

  const runs = visibleRuns(p).filter((r) => runText(r).trim() !== "");
  if (runs.length === 0) return null;
  const pPr = childW(p, "pPr");
  const markRPr = pPr && childW(pPr, "rPr");
  const paraBold = !!(markRPr && isBoldRPr(markRPr));
  const allBold = runs.every((r) => {
    const rPr = childW(r, "rPr");
    return rPr ? isBoldRPr(rPr) : paraBold;
  });
  const letters = text.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length >= 3 && letters === letters.toUpperCase();
  if (!allBold && !allCaps) return null;

  const level = ctx.topLevelNames.has(normalizeText(text)) ? 1 : 2;
  return { level, source: "bold" };
}

function isBoldRPr(rPr: XmlElement): boolean {
  const b = childW(rPr, "b");
  if (!b) return false;
  const val = getW(b, "val");
  return val === null || !["0", "false", "off"].includes(val);
}

/** Top-level block children of w:body (paragraphs and tables), excluding sectPr. */
export function bodyBlocks(body: XmlElement): XmlElement[] {
  return childElements(body).filter((el) => localName(el) !== "sectPr");
}

/**
 * Index (exclusive) of the end of the section started by the heading at
 * `headingIndex`: the next block that is a heading of the same or a higher
 * level, or blocks.length.
 */
export function sectionEnd(blocks: XmlElement[], headingIndex: number, ctx: HeadingContext): number {
  const start = classifyHeading(blocks[headingIndex], ctx);
  const level = start?.level ?? 1;
  for (let i = headingIndex + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (!isW(block, "p")) continue;
    const info = classifyHeading(block, ctx);
    if (info && info.level <= level) return i;
  }
  return blocks.length;
}

export interface LocateOptions {
  /** Only consider heading paragraphs. */
  headingsOnly?: boolean;
  /** Only consider body (non-heading) paragraphs. */
  bodyOnly?: boolean;
  /** Only consider paragraphs at or after this block index. */
  from?: number;
  /** Lowest acceptable score (0..1). Default 0.6. */
  minScore?: number;
  /** Paragraphs never to return (e.g. the source of a merge). */
  exclude?: XmlElement[];
}

export interface Located {
  index: number;
  paragraph: XmlElement;
  score: number;
}

/**
 * Find the paragraph best matching `query`. Exact normalized equality scores
 * 1, a prefix relation scores 0.9 (the planner often quotes only the start
 * of a long paragraph, or a PDF-derived string with line-break hyphens), and
 * token Jaccard similarity is the fallback for references.
 */
export function locateParagraph(
  paragraphs: XmlElement[],
  query: string,
  ctx: HeadingContext,
  options: LocateOptions = {}
): Located | null {
  const q = normalizeText(query);
  if (q === "") return null;
  const minScore = options.minScore ?? 0.6;
  let best: Located | null = null;
  for (let i = options.from ?? 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!isW(p, "p") || isParagraphDeleted(p)) continue;
    if (options.exclude?.includes(p)) continue;
    if (options.headingsOnly && !classifyHeading(p, ctx)) continue;
    if (options.bodyOnly && classifyHeading(p, ctx)) continue;
    const text = normalizeText(paragraphText(p));
    if (text === "") continue;
    const score = matchScore(q, text);
    if (score >= minScore && (!best || score > best.score)) best = { index: i, paragraph: p, score };
    if (score === 1) break;
  }
  return best;
}

function matchScore(query: string, text: string): number {
  if (query === text) return 1;
  const shorter = Math.min(query.length, text.length);
  if (shorter >= 20 && (text.startsWith(query) || query.startsWith(text))) return 0.9;
  if (query.length >= 20 && text.includes(query)) return 0.85;
  const dehyphenated = query.replace(/- /g, "");
  if (dehyphenated !== query && dehyphenated === text) return 0.95;
  return textSimilarity(query, text) * 0.84;
}

/** Index of `p` among `blocks`, walking up to the top-level block that contains it. */
export function blockIndexOf(blocks: XmlElement[], p: XmlElement, body: XmlElement): number {
  let node: XmlNode = p;
  while (node.parentNode && node.parentNode !== body) node = node.parentNode;
  return blocks.indexOf(node as XmlElement);
}

/** All paragraphs under `body`, in document order, including those in tables. */
export function allParagraphs(body: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (node: XmlNode) => {
    for (const child of childElements(node)) {
      if (isW(child, "p")) out.push(child);
      visit(child);
    }
  };
  visit(body);
  return out;
}

/** The w:p that owns a node (or null when the node is outside any paragraph). */
export function owningParagraph(node: XmlNode): XmlElement | null {
  return closestW(node, "p");
}
