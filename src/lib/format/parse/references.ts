/**
 * Reference list parsing.
 *
 * Two jobs: locate the list and split it into entries (numbered or
 * author-year), then report which bibliographic fields each entry carries.
 * Field detection is structural rather than semantic — we only claim a field
 * is "present", which is all the compliance checks need (e.g. "references are
 * missing DOIs").
 */

import type { Heading, ReferenceEntry, ReferencesBlock, TextSpan } from "./model-types";
import { findLastHeading } from "./headings";
import { collapse, firstSentence, matchAll, countWords, type IndexedLine } from "./text-utils";

const REFERENCES_HEADING = /^(references|bibliography|literature cited)$/;
const SUPPLEMENTAL_REFERENCES_HEADING = /^supplement(al|ary) references$/;

const DOI = /\b(?:doi:?\s*)?10\.\d{4,9}\/[^\s,;]+|\bdoi\s*:?\s*\S+|doi\.org/i;
const YEAR = /\b(19|20)\d{2}[a-z]?\b/;
const PAGES =
  /\b\d{1,6}\s*[–—-]\s*\d{1,6}\b|\b[Ee]\d{4,7}\b|\b(?:pp?\.|pages?)\s*\d+|\barticle\s*(?:no\.?|number)?\s*\d+/i;
const VOLUME =
  /(?:^|[\s,.])\d{1,4}\s*(?:\(\d{1,3}\))?\s*[,:]\s*(?:[Ee]?\d)|\bvol(?:ume)?\.?\s*\d+/i;
const UNPUBLISHED =
  /\b(in press|forthcoming|unpublished(?:\s+(?:data|results|observations))?|submitted(?:\s+for\s+publication)?|in\s+preparation|personal communication)\b/i;

/** Surname + initials, e.g. "He, J." / "Yu, L." / "van Dijk, A.-B." */
const AUTHOR_TOKEN =
  /(?:[A-Z][\p{L}'’-]*(?:\s+(?:van|von|de|der|den|du|di|el|al)\b)?(?:\s+[A-Z][\p{L}'’-]*)?),?\s*(?:[A-Z]\.(?:\s*-?\s*[A-Z]\.)*)/gu;
/** Vancouver style: "He J", "Liu SY" */
const AUTHOR_TOKEN_VANCOUVER = /[A-Z][\p{L}'’-]{1,}\s+[A-Z]{1,3}(?=[,;.]|\s+[A-Z][\p{L}]|$)/gu;

export interface ReferenceRegion {
  heading?: Heading;
  span: TextSpan;
  body: string;
}

/** Locates the reference list: by heading, else by a trailing numbered block. */
export function findReferenceRegion(
  text: string,
  lines: IndexedLine[],
  outline: Heading[]
): ReferenceRegion | null {
  const heading = findLastHeading(outline, REFERENCES_HEADING);
  if (heading) {
    const idx = outline.indexOf(heading);
    let end = text.length;
    for (let j = idx + 1; j < outline.length; j += 1) {
      if (outline[j].level <= heading.level) {
        end = outline[j].span.start;
        break;
      }
    }
    return {
      heading,
      span: { start: heading.span.end, end },
      body: text.slice(heading.span.end, end),
    };
  }

  // No heading: look for a run of at least five sequential numbered entries.
  let runStart: number | null = null;
  let expected = 1;
  let runCount = 0;
  for (const line of lines) {
    const m = line.text.match(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+\S/);
    if (!m) continue;
    const value = Number(m[1] ?? m[2]);
    if (value === expected) {
      if (runStart === null) runStart = line.start;
      expected += 1;
      runCount += 1;
    } else if (value === 1) {
      runStart = line.start;
      expected = 2;
      runCount = 1;
    }
  }
  if (runStart !== null && runCount >= 5) {
    return { span: { start: runStart, end: text.length }, body: text.slice(runStart) };
  }
  return null;
}

interface RawEntry {
  index: number;
  raw: string;
}

/** Splits a numbered list; returns null when the list is not numbered. */
function splitNumbered(body: string): RawEntry[] | null {
  const markers = [
    ...matchAll(body, /(?:^|\n)\s*(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+(?=\S)/g),
  ];
  const sequential: Array<{ value: number; start: number; end: number }> = [];
  let expected = 1;
  for (const { match, span } of markers) {
    const value = Number(match[1] ?? match[2]);
    if (value !== expected) continue;
    sequential.push({ value, start: span.start, end: span.end });
    expected += 1;
  }
  if (sequential.length < 3) return null;
  return sequential.map((m, i) => ({
    index: m.value,
    raw: collapse(body.slice(m.end, i + 1 < sequential.length ? sequential[i + 1].start : body.length)),
  }));
}

/** Splits an author-year list on lines that begin with a surname + initial. */
function splitAuthorYear(body: string): RawEntry[] {
  const lines = body.split("\n");
  const entries: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) continue;
    const startsEntry =
      /^[A-Z][\p{L}'’-]+,\s*[A-Z]\./u.test(t) ||
      /^[A-Z][\p{L}'’-]+\s+[A-Z]{1,3},/u.test(t) ||
      /^[A-Z][\p{L}'’-]+,\s*[A-Z][\p{L}'’-]+,?\s*(?:and|&)/u.test(t);
    if (startsEntry || entries.length === 0) entries.push(t);
    else entries[entries.length - 1] += ` ${t}`;
  }
  return entries
    .filter((raw) => raw.length > 20)
    .map((raw, i) => ({ index: i + 1, raw: collapse(raw) }));
}

/** Splits the author block from the title and the trailing source details. */
function splitFields(raw: string): { authors: string; title: string; rest: string } {
  // Author-year style: the year follows the authors directly. Nature-style
  // entries also carry a "(2024)" but at the very end, so the branch only
  // applies when a substantial title still follows the year.
  const authorYear = raw.match(/^(.{0,160}?)\(\s*((?:19|20)\d{2}[a-z]?)\s*\)\.?\s*/);
  if (authorYear && /[A-Z]/.test(authorYear[1])) {
    const remainder = raw.slice(authorYear[0].length);
    if (countWords(remainder) >= 5) {
      const title = firstSentence(remainder);
      return { authors: authorYear[1], title, rest: remainder.slice(title.length) };
    }
  }

  // Nature/Vancouver style: consume author tokens from the start.
  const consumed = raw.match(
    /^((?:[A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*)?,?\s*(?:[A-Z]\.(?:\s*-?\s*[A-Z]\.)*)\s*[,&;]?\s*|et\s+al\.?,?\s*|and\s+|&\s*)+)/u
  );
  const authors = consumed ? consumed[1] : "";
  const remainder = raw.slice(authors.length);
  const title = firstSentence(remainder);
  return { authors, title, rest: remainder.slice(title.length) };
}

function countAuthors(authors: string): number {
  const a = [...authors.matchAll(AUTHOR_TOKEN)].length;
  if (a > 0) return a;
  return [...authors.matchAll(AUTHOR_TOKEN_VANCOUVER)].length;
}

/** Journal-ish text sits between the title and the volume/year. */
function hasJournal(rest: string): boolean {
  const beforeVolume = rest.split(/\d/)[0] ?? "";
  const words = countWords(beforeVolume);
  if (words === 0 || words > 14) return false;
  return /[A-Za-z]{2,}/.test(beforeVolume);
}

export function analyzeEntry(index: number, raw: string): ReferenceEntry {
  const { authors, title, rest } = splitFields(raw);
  return {
    index,
    raw,
    hasYear: YEAR.test(raw),
    hasTitle: countWords(title) >= 3,
    hasJournal: hasJournal(rest),
    hasVolume: VOLUME.test(rest) || VOLUME.test(raw),
    hasPages: PAGES.test(rest) || PAGES.test(raw),
    hasDoi: DOI.test(raw),
    authorCount: countAuthors(authors),
    usesEtAl: /\bet\s+al\b/i.test(raw),
    isInPressOrUnpublished: UNPUBLISHED.test(raw),
  };
}

export type InTextStyle = ReferencesBlock["inTextStyle"];

/**
 * In-text citation style, measured on the body text (before the list).
 * Superscript numerals survive PDF extraction as digits glued to the end of a
 * word, so we require at least three lower-case letters in front of the digits
 * to avoid counting gene names such as MMP9 or cell lines such as HCT116.
 */
export function detectInTextStyle(body: string): InTextStyle {
  const superscript = matchAll(
    body,
    /(?<=[a-z]{3})\d{1,3}(?:\s*[,–-]\s*\d{1,3})*(?=[\s.,;:)’]|$)/g
  ).length;
  const bracketed = matchAll(body, /\[\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\]/g).length;
  // Count each citation, not each parenthesis: "(Roe and Doe, 2020; Doe, 2019)"
  // is two citations.
  const authorYear = matchAll(
    body,
    /[A-Z][\p{L}'’-]+(?:\s+(?:et\s+al\.?|and|&)(?:\s+[A-Z][\p{L}'’-]*)?)?,?\s*(?:19|20)\d{2}[a-z]?(?=\s*[);,])/gu
  ).length;

  const ranked: Array<[InTextStyle, number]> = [
    ["superscript-numeric", superscript],
    ["bracketed-numeric", bracketed],
    ["author-year", authorYear],
  ].sort((a, b) => (b[1] as number) - (a[1] as number)) as Array<[InTextStyle, number]>;
  const [style, count] = ranked[0];
  return count >= 3 ? style : "unknown";
}

export function parseReferences(
  text: string,
  lines: IndexedLine[],
  outline: Heading[]
): ReferencesBlock {
  const region = findReferenceRegion(text, lines, outline);
  const separateSupplementalList =
    outline.some((h) => SUPPLEMENTAL_REFERENCES_HEADING.test(h.normalized)) ||
    outline.filter((h) => REFERENCES_HEADING.test(h.normalized)).length > 1;

  if (!region) {
    return {
      headingText: undefined,
      style: "unknown",
      count: 0,
      entries: [],
      inTextStyle: detectInTextStyle(text),
      separateSupplementalList,
    };
  }

  const numbered = splitNumbered(region.body);
  const rawEntries = numbered ?? splitAuthorYear(region.body);
  const style: ReferencesBlock["style"] =
    numbered !== null ? "numbered" : rawEntries.length >= 3 ? "author-year" : "unknown";
  const entries = rawEntries.map((e) => analyzeEntry(e.index, e.raw));

  return {
    headingText: region.heading?.text,
    style,
    count: entries.length,
    entries,
    // Measure the in-text style on everything before the list.
    inTextStyle: detectInTextStyle(text.slice(0, region.span.start)),
    separateSupplementalList,
  };
}
