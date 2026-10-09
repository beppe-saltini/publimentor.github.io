/**
 * Heading and section detection.
 *
 * PDF extraction gives us no font information, so headings are recovered from
 * three signals, in order of reliability:
 *
 *  1. Known section names (the Cell Press / STAR Methods vocabulary plus the
 *     usual Nature-style names). This is what every downstream check relies on.
 *  2. Structural markers: numbered headings ("2.1 Cell culture") and ALL CAPS
 *     lines (the STAR Methods group headings).
 *  3. A conservative heuristic for sentence-case headings such as the methods
 *     subheadings "Mice and tumor models" or results subheadings. Wrapped body
 *     text is excluded by requiring the previous line to end a sentence and the
 *     candidate to carry none of the markers of running prose.
 *
 * DOCX input supplies explicit heading levels (from Word heading styles), in
 * which case the heuristics are skipped for those lines.
 */

import type { Heading, Section, TextSpan } from "./model-types";
import {
  endsWithFunctionWord,
  isAllCaps,
  isTitleCase,
  normalizeHeading,
  type IndexedLine,
} from "./text-utils";

interface KnownSection {
  re: RegExp;
  level: 1 | 2 | 3;
}

/** Canonical STAR Methods group headings (ALL CAPS in Cell Press papers). */
export const STAR_GROUP_HEADINGS = [
  "resource availability",
  "experimental model and subject details",
  "experimental model and study participant details",
  "method details",
  "methods details",
  "quantification and statistical analysis",
  "additional resources",
  "key resources table",
];

const KNOWN_SECTIONS: KnownSection[] = [
  { re: /^(summary|abstract)$/, level: 1 },
  { re: /^graphical abstract$/, level: 1 },
  { re: /^highlights$/, level: 1 },
  { re: /^(introduction|background)$/, level: 1 },
  { re: /^results( and discussion)?$/, level: 1 },
  { re: /^discussion$/, level: 1 },
  { re: /^conclusions?$/, level: 1 },
  { re: /^(limitations( of (the|this) study)?|limitations of study|study limitations)$/, level: 1 },
  {
    re: /^(star ?★? ?methods|star methods|materials and methods|methods and materials|method[s]?|online methods|experimental procedures|methods and protocols)$/,
    level: 1,
  },
  { re: /^resource availability$/, level: 2 },
  { re: /^lead contacts?$/, level: 3 },
  { re: /^materials? availability$/, level: 3 },
  { re: /^data and code availability$/, level: 3 },
  { re: /^data availability( statement)?$/, level: 3 },
  { re: /^code availability( statement)?$/, level: 3 },
  { re: /^key resources? table$/, level: 2 },
  { re: /^experimental model and (subject|study participant) details$/, level: 2 },
  { re: /^methods? details$/, level: 2 },
  { re: /^quantification and statistical analysis(es)?$/, level: 2 },
  { re: /^additional resources$/, level: 2 },
  { re: /^(references|bibliography|literature cited)$/, level: 1 },
  { re: /^supplement(al|ary) references$/, level: 1 },
  { re: /^acknowledge?ments?$/, level: 1 },
  { re: /^(author contributions?|credit authorship contribution statement|contributions)$/, level: 1 },
  {
    re: /^(declaration of (competing )?interests?|competing (financial )?interests?|conflicts? of interests?|declaration of conflicting interests|disclosures?)$/,
    level: 1,
  },
  { re: /^declaration of (use of )?generative ai.*$/, level: 1 },
  { re: /^inclusion and diversity$/, level: 1 },
  { re: /^(supplement(al|ary) (information|informations|material|materials|data|figures|figures and tables|items))$/, level: 1 },
  { re: /^(main )?figure (legends?|titles and legends)$/, level: 1 },
  { re: /^(main )?table (legends?|titles and legends)$/, level: 1 },
  { re: /^(ethics|ethical) (statement|approval|considerations)$/, level: 2 },
  { re: /^(funding|funding sources|financial support)$/, level: 1 },
  { re: /^additional information$/, level: 1 },
  { re: /^(abbreviations|glossary)$/, level: 1 },
  { re: /^appendix( [a-z0-9]+)?$/, level: 1 },
];

/** Institution words: these mark an affiliation line, never a heading. */
const AFFILIATION_HINT =
  /\b(?:universit|institut|department|hospital|school|college|facult|laborator|cent(?:er|re)|division|clinic|academy|ministry|polytechnic)/i;

/** Labels owned by the figure/table/supplemental parser, never headings. */
const LABEL_START =
  /^\s*(?:supplementary|supplemental|extended data)?\s*(?:fig(?:ure)?s?\.?|table|video|movie|data|scheme|appendix figure)\s*s?\d/i;

/** Sentence openers that mark running prose rather than a heading. */
const PROSE_OPENERS =
  /^(we|here|in|thus|therefore|however|although|because|together|consistent|by|to|these|this|the|next|finally|notably|moreover|furthermore|conversely|importantly|first|second|third|when|while|after|during|as|at|for|all|both|using|given|whereas|similarly|accordingly|overall|collectively|interestingly|data|values?|statistical)\b/i;

/** Markers of running prose anywhere in the line. */
const PROSE_MARKERS =
  /[()=±;•]|\bFigs?\.|\bFigure\s*\d|\bTables?\s*\d|\bn\s*=\s*\d|\bP\s*[<>=≤]|\bet al\b|\d+\s*%|\bvs\.?\b|\d+\s*(?:mg|ml|µl|µm|mm|cm|nm|kg|h|min|s)\b/i;

export function matchKnownSection(normalized: string): KnownSection | null {
  for (const known of KNOWN_SECTIONS) {
    if (known.re.test(normalized)) return known;
  }
  return null;
}

function isAuthorishLine(line: string): boolean {
  const commas = (line.match(/,/g) ?? []).length;
  const initials = (line.match(/\b[A-Z]\.(?:\s*[A-Z]\.)?/g) ?? []).length;
  return commas >= 2 && initials >= 2;
}

/**
 * Conservative heuristic for unknown, sentence-case or Title Case headings.
 */
function looksLikeHeading(
  prev: string | undefined,
  current: string,
  next: string | undefined,
  prevWasHeading = false,
  nextIsContinuation = false
): boolean {
  const line = current.trim();
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return false;
  if (line.length > 90) return false;
  if (/[.?!;:,]\s*$/.test(line)) return false;
  if (!/^[A-Z(★]/.test(line)) return false;
  if (LABEL_START.test(line)) return false;
  if (PROSE_MARKERS.test(line)) return false;
  if ((line.match(/,/g) ?? []).length > 1) return false;
  if (endsWithFunctionWord(line)) return false;
  if (isAuthorishLine(line)) return false;
  if (PROSE_OPENERS.test(line)) return false;
  if (/@|https?:\/\//.test(line)) return false;
  // The previous line must finish a sentence (or be blank/absent); wrapped
  // body text almost never breaks exactly on a sentence boundary.
  const prevOk =
    prevWasHeading ||
    prev === undefined ||
    prev.trim().length === 0 ||
    /[.?!]["')\]]?\s*$/.test(prev.trim());
  if (!prevOk) return false;
  // Either it reads like a title, or the following line starts something new —
  // or the heading itself wraps onto a short continuation line.
  const nextOk =
    nextIsContinuation ||
    next === undefined ||
    next.trim().length === 0 ||
    /^[A-Z(•★\d]/.test(next.trim());
  return isTitleCase(line) || nextOk;
}

/** The heading that opens the reference list. */
const REFERENCES_HEADING_RE = /^(references|bibliography|literature cited)$/;

/**
 * Shapes of a reference-list entry: a numbered line that starts with an author
 * ("Bartley L.", "Liu SY,", "Smith, J.") or carries bibliographic fields (a
 * year, volume:pages, a page range, a DOI, "et al.") is a citation, never a
 * numbered heading.
 */
const CITATION_AUTHOR_VANCOUVER = /^[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?\s+[A-Z]{1,3}[,.;]/u;
const CITATION_AUTHOR_INITIALS = /^[A-Z][\p{L}'’-]+,\s*[A-Z]\./u;
const CITATION_FIELDS =
  /\((?:19|20)\d{2}[a-z]?\)|\b(?:19|20)\d{2}[a-z]?\s*[.;]?\s*$|\b\d{1,4}\s*(?:\(\d{1,4}\))?\s*[:,]\s*[Ee]?\d+|\d+\s*[–—-]\s*\d+|\bdoi\b|\b10\.\d{4,9}\/|\bet al\b/i;
/** A reference title that wrapped onto its own line reads as a sentence. */
const CITATION_PROSE = /\b(?:has|have|had)\s+been\b|\b(?:was|were|is|are)\s+(?:detected|observed|reported|shown|found|identified|associated|linked|required)\b/i;

/** True when a numbered line is a bibliography entry rather than a heading. */
export function looksLikeCitation(rest: string): boolean {
  return (
    CITATION_AUTHOR_VANCOUVER.test(rest) ||
    CITATION_AUTHOR_INITIALS.test(rest) ||
    CITATION_FIELDS.test(rest) ||
    CITATION_PROSE.test(rest)
  );
}

/**
 * Highest top-level number a plain numbered heading may carry. A manuscript
 * never has more than a handful of numbered sections; a reference list does.
 * Documents with hierarchical numbering ("2.1", "3.2.1") are exempt.
 */
const MAX_FLAT_HEADING_NUMBER = 20;
const HIERARCHICAL_NUMBER = /^\s*\d{1,2}\.\d{1,2}(?:\.\d{1,2})?[.)]?\s+[A-Z(]/;

/** Numbered heading such as "2.1 Cell culture" or "3) Statistics". */
function numberedHeading(line: string, hierarchicalNumbering = false): { level: 1 | 2 | 3; text: string } | null {
  const m = line.match(/^\s*(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(\S.*)$/);
  if (!m) return null;
  const rest = m[2].trim();
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return null;
  if (/[.?!;,]\s*$/.test(rest)) return null;
  if (!/^[A-Z(]/.test(rest)) return null;
  if (PROSE_MARKERS.test(rest) || isAuthorishLine(rest)) return null;
  if (looksLikeCitation(rest)) return null;
  // "1 Department of Widget Biology, Example University, Springfield…" is an
  // affiliation, not a numbered heading: a comma plus many words gives it away.
  if (/,/.test(rest) && (words.length >= 6 || AFFILIATION_HINT.test(rest))) return null;
  const parts = m[1].split(".");
  if (parts.length === 1 && !hierarchicalNumbering && Number(parts[0]) > MAX_FLAT_HEADING_NUMBER) return null;
  const depth = parts.length;
  const level = (depth >= 3 ? 3 : depth === 2 ? 2 : 1) as 1 | 2 | 3;
  return { level, text: line.trim() };
}

/**
 * Line index where a trailing numbered reference list starts when the list
 * has no heading: a run of at least five sequential entries ("1.", "2.", …)
 * that read like citations. Mirrors the fallback of the reference parser.
 */
export function numberedReferenceRunStart(lines: IndexedLine[]): number | null {
  let runStart: number | null = null;
  let expected = 1;
  let runCount = 0;
  let best: number | null = null;
  for (const line of lines) {
    const m = line.text.match(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+(\S.*)$/);
    if (!m) continue;
    const rest = m[3].trim();
    if (matchKnownSection(normalizeHeading(rest))) continue;
    const entryLike = rest.split(/\s+/).length >= 6 || looksLikeCitation(rest);
    if (!entryLike) continue;
    const value = Number(m[1] ?? m[2]);
    if (value === expected) {
      if (runStart === null) runStart = line.i;
      expected += 1;
      runCount += 1;
    } else if (value === 1) {
      runStart = line.i;
      expected = 2;
      runCount = 1;
    } else {
      continue;
    }
    if (runCount >= 5) best = runStart;
  }
  return best;
}

export interface StructureOptions {
  /** Explicit heading levels per line index (DOCX heading styles). */
  explicitHeadings?: Map<number, 1 | 2 | 3>;
  /** Line indices that start a figure legend / supplemental item title. */
  labelLines?: Set<number>;
}

export interface StructureResult {
  outline: Heading[];
  sections: Section[];
}

/**
 * A heading may wrap onto a second short line ("…improves chemotherapy" /
 * "response"). We merge such a continuation into the heading text.
 */
function continuationOf(heading: string, next: string | undefined): string | null {
  if (next === undefined) return null;
  const t = next.trim();
  if (t.length === 0 || t.length > 40) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 5) return null;
  if (/[.?!;:]\s*$/.test(t)) return null;
  if (LABEL_START.test(t)) return null;
  if (PROSE_MARKERS.test(t)) return null;
  // Only a lower-case fragment continues a heading. Anything capitalised —
  // "KEY RESOURCES TABLE", "2.1 Reactor assembly" — is its own heading.
  if (!/^[a-z(]/.test(t)) return null;
  if (/[.?!]$/.test(heading)) return null;
  return t;
}

export function detectStructure(
  text: string,
  lines: IndexedLine[],
  options: StructureOptions = {}
): StructureResult {
  const { explicitHeadings, labelLines } = options;
  /** Headings plus how they were found, so front-matter noise can be dropped. */
  const found: Array<{ heading: Heading; known: boolean }> = [];
  /** Line index of the last heading emitted: a subheading may follow one. */
  let lastHeadingLine = -2;
  /** "2.1"-style numbering anywhere lifts the cap on plain heading numbers. */
  const hierarchicalNumbering = lines.some((l) => HIERARCHICAL_NUMBER.test(l.text));
  /** A headingless, trailing numbered list is the reference list. */
  const referenceRunStart = explicitHeadings ? null : numberedReferenceRunStart(lines);
  /**
   * Inside the reference list ("References" passed, or the numbered run
   * reached) numbered and sentence-case lines are entries, never headings;
   * only known section names count. A later known level-1 heading
   * (Nature-style Methods after the references, figure legends,
   * supplemental information) ends the list.
   */
  let inReferenceList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const raw = line.text.trim();
    if (raw.length === 0) continue;
    if (labelLines?.has(i)) continue;
    if (i === referenceRunStart) inReferenceList = true;

    const normalized = normalizeHeading(raw);
    let level: 1 | 2 | 3 | null = null;
    let headingText = raw;
    let known = false;

    const explicit = explicitHeadings?.get(i);
    if (explicit) {
      level = explicit;
      known = true;
    } else if (explicitHeadings) {
      // DOCX: trust the styles, no heuristics.
      continue;
    } else {
      let isKnownName = false;
      const knownSection = matchKnownSection(normalized);
      const continuesPreviousSentence =
        /[.?!]\s*$/.test(raw) &&
        lines[i - 1] !== undefined &&
        lines[i - 1].text.trim().length > 0 &&
        !/[.?!:]["')\]]?\s*$/.test(lines[i - 1].text.trim());
      if (knownSection && !continuesPreviousSentence) {
        level = knownSection.level;
        isKnownName = true;
      } else if (knownSection) {
        continue; // wrapped prose that happens to read like a heading
      } else {
        const numbered = inReferenceList ? null : numberedHeading(raw, hierarchicalNumbering);
        if (numbered) {
          level = numbered.level;
          headingText = numbered.text;
        } else if (isAllCaps(raw) && raw.split(/\s+/).length <= 12 && !/[.?!]$/.test(raw)) {
          level = STAR_GROUP_HEADINGS.includes(normalized) ? 1 : 2;
        } else if (
          !inReferenceList &&
          looksLikeHeading(
            lines[i - 1]?.text,
            raw,
            lines[i + 1]?.text,
            lastHeadingLine === i - 1,
            continuationOf(raw, lines[i + 1]?.text) !== null
          )
        ) {
          level = 2;
        }
      }
      known = isKnownName;
    }

    if (level === null) continue;

    let end = line.end;
    if (!explicit) {
      const extra = continuationOf(headingText, lines[i + 1]?.text);
      if (extra) {
        headingText = `${headingText} ${extra}`;
        end = lines[i + 1].end;
        i += 1; // consume the continuation line
      }
    }

    const heading: Heading = {
      text: headingText,
      normalized: normalizeHeading(headingText),
      level,
      span: { start: line.start, end },
    };
    found.push({ heading, known });
    lastHeadingLine = i;
    if (known && REFERENCES_HEADING_RE.test(heading.normalized)) inReferenceList = true;
    else if (known && level === 1) inReferenceList = false;
  }

  // The title page produces heading-shaped lines: the title itself, numbered
  // affiliations, and footnote markers such as "3 Lead contact". Everything
  // before the first front-matter heading (Summary/Abstract/Highlights/
  // Introduction) is therefore dropped — a manuscript has no sections there.
  const firstFrontMatter = found.findIndex(
    (f) => f.known && /^(summary|abstract|highlights|introduction|graphical abstract)$/.test(f.heading.normalized)
  );
  const outline = found
    .filter((_, idx) => firstFrontMatter < 0 || idx >= firstFrontMatter)
    .map((f) => f.heading);

  const sections = buildSections(text, outline);
  return { outline, sections };
}

/** Builds the nested section tree from a flat outline. */
export function buildSections(text: string, outline: Heading[]): Section[] {
  const nodes: Array<{ section: Section; level: 1 | 2 | 3 }> = [];
  for (let i = 0; i < outline.length; i += 1) {
    const heading = outline[i];
    const bodyStart = heading.span.end;
    const bodyEnd = i + 1 < outline.length ? outline[i + 1].span.start : text.length;
    // The section span runs to the next heading of the same or higher rank.
    let spanEnd = text.length;
    for (let j = i + 1; j < outline.length; j += 1) {
      if (outline[j].level <= heading.level) {
        spanEnd = outline[j].span.start;
        break;
      }
    }
    const section: Section = {
      heading,
      body: text.slice(bodyStart, Math.max(bodyStart, bodyEnd)).trim(),
      span: { start: heading.span.start, end: spanEnd },
      children: [],
    };
    nodes.push({ section, level: heading.level });
  }

  const roots: Section[] = [];
  const stack: Array<{ section: Section; level: 1 | 2 | 3 }> = [];
  for (const node of nodes) {
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length === 0) roots.push(node.section);
    else stack[stack.length - 1].section.children.push(node.section);
    stack.push(node);
  }
  return roots;
}

/** Finds the first heading whose normalised text matches `re`. */
export function findHeading(outline: Heading[], re: RegExp): Heading | undefined {
  return outline.find((h) => re.test(h.normalized));
}

/** Finds the last heading whose normalised text matches `re`. */
export function findLastHeading(outline: Heading[], re: RegExp): Heading | undefined {
  for (let i = outline.length - 1; i >= 0; i -= 1) {
    if (re.test(outline[i].normalized)) return outline[i];
  }
  return undefined;
}

/**
 * Text belonging to a heading: everything up to the next heading of the same
 * or higher rank.
 */
export function sectionTextFor(text: string, outline: Heading[], heading: Heading): {
  body: string;
  span: TextSpan;
} {
  const idx = outline.indexOf(heading);
  let end = text.length;
  for (let j = idx + 1; j < outline.length; j += 1) {
    if (outline[j].level <= heading.level) {
      end = outline[j].span.start;
      break;
    }
  }
  return {
    body: text.slice(heading.span.end, end).trim(),
    span: { start: heading.span.start, end },
  };
}

/**
 * Headings that open methods-like text: the methods section under any of its
 * names, the STAR Methods groups and the availability statements. Data types
 * mentioned here were produced by the paper; the same words in the
 * Introduction or Discussion are background.
 */
export const METHODS_LIKE_HEADING =
  /^(star ?★? ?methods|star methods|materials and methods|material and methods|methods and materials|methods?|online methods|experimental procedures|experimental section|methodology|methods and protocols|supplement(?:al|ary) methods|methods? details|key resources? table|resource availability|experimental model and (?:subject|study participant) details|quantification and statistical analysis(?:es)?|data and code availability|data availability(?: statement)?)$/;

/**
 * Spans of every methods-like section (heading plus body, up to the next
 * heading of the same or higher rank). Subsections are covered by their
 * parent's span. Empty when the manuscript has no methods-like section.
 */
export function methodsLikeSpans(text: string, outline: Heading[]): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const heading of outline) {
    if (!METHODS_LIKE_HEADING.test(heading.normalized)) continue;
    const { span } = sectionTextFor(text, outline, heading);
    if (spans.some((s) => s.start <= span.start && s.end >= span.end)) continue;
    spans.push(span);
  }
  return spans;
}
