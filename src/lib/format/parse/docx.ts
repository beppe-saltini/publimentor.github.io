/**
 * DOCX extraction.
 *
 * Two passes:
 *  1. mammoth converts the document to HTML, which preserves Word heading
 *     styles as <h1>-<h3>, paragraphs, lists and tables. We flatten that into
 *     line-oriented text and remember which lines are headings, so the shared
 *     structure code can skip its PDF heuristics entirely. A document whose
 *     headings are bold "Normal" paragraphs yields no <h1>-<h3>; the model
 *     builder then falls back to the PDF-style text heuristics.
 *  2. jszip reads word/document.xml for the facts HTML cannot carry: Word
 *     tables, inline images, OMML and MathType equations, tracked changes and
 *     whether heading styles are used at all.
 */

import type { DocxFacts } from "./model-types";

export interface DocxExtraction {
  text: string;
  /** Line index -> heading level, from Word heading styles. */
  explicitHeadings: Map<number, 1 | 2 | 3>;
  facts: DocxFacts;
}

const BLOCK_TAG = /<(h[1-6]|p|li|td|th|figcaption)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Flattens mammoth HTML into lines. Table rows become one line of cells
 * joined by " | " so that a Key Resources Table stays readable as text.
 */
export function htmlToLines(html: string): {
  lines: string[];
  explicitHeadings: Map<number, 1 | 2 | 3>;
} {
  const lines: string[] = [];
  const explicitHeadings = new Map<number, 1 | 2 | 3>();

  // Rows first: mark their cells so they can be joined onto one line.
  const rowRanges: Array<{ start: number; end: number }> = [];
  for (const m of html.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi)) {
    rowRanges.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  const rowFor = (pos: number): number =>
    rowRanges.findIndex((r) => pos >= r.start && pos < r.end);

  let currentRow = -1;
  let rowCells: string[] = [];
  // Blank lines mark paragraph breaks; never emit two in a row, so that the
  // line indices in `explicitHeadings` survive into the final text unchanged.
  const pushBlank = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  };
  const flushRow = () => {
    if (rowCells.length > 0) {
      lines.push(rowCells.join(" | "));
      rowCells = [];
    }
    currentRow = -1;
  };

  for (const m of html.matchAll(BLOCK_TAG)) {
    const tag = m[1].toLowerCase();
    const content = stripTags(m[3]);
    const pos = m.index ?? 0;
    const row = rowFor(pos);

    if (row >= 0) {
      if (row !== currentRow) {
        flushRow();
        currentRow = row;
      }
      if (content.length > 0) rowCells.push(content);
      continue;
    }
    flushRow();

    if (content.length === 0) {
      pushBlank();
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(3, Number(tag.slice(1))) as 1 | 2 | 3;
      pushBlank();
      explicitHeadings.set(lines.length, level);
      lines.push(content);
      continue;
    }
    lines.push(content);
  }
  flushRow();

  return { lines, explicitHeadings };
}

const RE_TABLE = /<w:tbl[\s>\/]/g;
const RE_DRAWING = /<w:drawing[\s>\/]/g;
const RE_PICT = /<w:pict[\s>\/]/g;
const RE_OMML = /<m:oMath[\s>\/]/g;
const RE_OLE_OBJECT = /<w:object[\s>\/]/g;
const RE_OLE_FALLBACK = /OLEObject/g;
const RE_TRACKED = /<w:(?:ins|del)[\s>\/]/;
const RE_HEADING_STYLE = /w:val="(?:Heading|heading)\s?[1-9]"/;

function count(xml: string, re: RegExp): number {
  return (xml.match(re) ?? []).length;
}

/** Reads the OOXML facts that the HTML conversion loses. */
export async function readDocxFacts(buffer: Buffer): Promise<DocxFacts> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    return {
      wordTables: 0,
      imagesInBody: 0,
      ommlEquations: 0,
      mathTypeObjects: 0,
      trackedChanges: false,
      usesHeadingStyles: false,
    };
  }
  const xml = await documentFile.async("string");
  const oleObjects = count(xml, RE_OLE_OBJECT) || count(xml, RE_OLE_FALLBACK);
  return {
    wordTables: count(xml, RE_TABLE),
    imagesInBody: count(xml, RE_DRAWING) + count(xml, RE_PICT),
    ommlEquations: count(xml, RE_OMML),
    mathTypeObjects: oleObjects,
    trackedChanges: RE_TRACKED.test(xml),
    usesHeadingStyles: RE_HEADING_STYLE.test(xml),
  };
}

/** Full DOCX extraction: text + heading map + OOXML facts. */
export async function extractDocx(buffer: Buffer): Promise<DocxExtraction> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const { lines, explicitHeadings } = htmlToLines(html);
  const facts = await readDocxFacts(buffer);
  // Drop leading blank lines and shift the heading indices to match, so line
  // N of `text` is still the heading the map says it is.
  const firstContent = lines.findIndex((l) => l.trim().length > 0);
  const shift = firstContent > 0 ? firstContent : 0;
  const text = lines.slice(shift).join("\n");
  const shifted = new Map<number, 1 | 2 | 3>();
  for (const [idx, level] of explicitHeadings) shifted.set(idx - shift, level);

  return { text, explicitHeadings: shifted, facts };
}
