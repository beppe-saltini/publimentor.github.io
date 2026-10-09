/**
 * Shared text helpers for the manuscript parser.
 *
 * Everything downstream works on a single normalised text string plus a
 * `LineIndex`, so that every span we report is a real character offset into
 * `ManuscriptModel.text`.
 */

import type { TextSpan } from "./model-types";

export interface IndexedLine {
  /** Line text with trailing whitespace removed. */
  text: string;
  /** Offset of the first character of the line in the full text. */
  start: number;
  /** Offset just past the last character of the line (excluding the newline). */
  end: number;
  /** 0-based line number. */
  i: number;
}

/** Builds a line index over an already normalised text. */
export function indexLines(text: string): IndexedLine[] {
  const lines: IndexedLine[] = [];
  let offset = 0;
  let i = 0;
  for (const raw of text.split("\n")) {
    const trimmedEnd = raw.replace(/\s+$/, "");
    lines.push({ text: trimmedEnd, start: offset, end: offset + trimmedEnd.length, i });
    offset += raw.length + 1; // + newline
    i += 1;
  }
  return lines;
}

/**
 * Normalises unicode oddities that PDF and DOCX extraction introduce, while
 * keeping character counts stable per line (so spans stay meaningful).
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ") // non-breaking space
    .replace(/[​‌‍﻿]/g, "") // zero-width junk
    .replace(//g, "±") // symbol-font plus/minus
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Collapses all whitespace runs to single spaces. */
export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function countWords(s: string): number {
  const matches = s.match(/[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’\-–/]*/g);
  return matches ? matches.length : 0;
}

/** Lower-cased, punctuation-free form used to match heading names. */
export function normalizeHeading(s: string): string {
  return collapse(
    s
      .replace(/^[\s\d.)(•§★*]+/, "") // leading numbering/bullets/stars
      .replace(/[:.—–|]+\s*$/, "")
      .replace(/[^A-Za-z0-9\s&/-]/g, " ")
  )
    .toLowerCase()
    .trim();
}

/** Short quote around a span, for evidence. */
export function excerptAt(text: string, span: TextSpan, pad = 120): string {
  const start = Math.max(0, span.start - pad);
  const end = Math.min(text.length, span.end + pad);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + collapse(text.slice(start, end)) + suffix;
}

/** Context window used for feature/phrase evidence. */
export function contextAround(text: string, start: number, end: number, pad = 60): string {
  return excerptAt(text, { start, end }, pad);
}

/**
 * Collects all matches of a global regex with their spans.
 * The regex must carry the `g` flag; it is cloned so callers can reuse it.
 */
export function matchAll(
  text: string,
  pattern: RegExp
): Array<{ match: RegExpExecArray; span: TextSpan }> {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  const out: Array<{ match: RegExpExecArray; span: TextSpan }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ match: m, span: { start: m.index, end: m.index + m[0].length } });
    if (m[0].length === 0) re.lastIndex += 1; // guard against zero-width loops
  }
  return out;
}

/** True when a line is in Title Case (most significant words capitalised). */
export function isTitleCase(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const minor = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
    "of", "on", "or", "per", "the", "to", "via", "with", "vs", "versus",
  ]);
  let significant = 0;
  let capitalised = 0;
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z0-9'’\-]/g, "");
    if (!bare) continue;
    if (minor.has(bare.toLowerCase())) continue;
    significant += 1;
    if (/^[A-Z0-9]/.test(bare)) capitalised += 1;
  }
  return significant > 0 && capitalised / significant >= 0.75;
}

export function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase() && /[A-Z]{3}/.test(letters);
}

/** Terminal punctuation that disqualifies a line from being a heading. */
export function endsSentence(line: string): boolean {
  return /[.?!;:,]\s*$/.test(line);
}

const TRAILING_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "had", "has", "have", "in", "into", "is", "it", "its", "of", "on", "or", "our",
  "that", "the", "their", "these", "this", "those", "to", "was", "we", "were",
  "when", "where", "which", "while", "with", "without", "than", "then", "both",
  "after", "before", "between", "during", "not", "no", "nor", "all",
]);

/** A line ending in a function word is almost certainly wrapped body text. */
export function endsWithFunctionWord(line: string): boolean {
  const last = line.trim().split(/\s+/).pop() ?? "";
  return TRAILING_FUNCTION_WORDS.has(last.replace(/[^A-Za-z]/g, "").toLowerCase());
}

/** Splits a block into paragraphs on blank lines. */
export function paragraphs(block: string): string[] {
  return block
    .split(/\n\s*\n/)
    .map((p) => collapse(p))
    .filter((p) => p.length > 0);
}

/**
 * Splits text into sentences on terminal punctuation followed by a capital,
 * keeping common abbreviations (e.g. "Fig.", "et al.") intact.
 */
export function sentences(block: string): string[] {
  const flat = collapse(block);
  if (!flat) return [];
  const protectedText = flat
    .replace(/\b(Fig|Figs|Tab|No|vs|cf|e\.g|i\.e|et al|Dr|Prof|approx|ca)\./gi, (m) =>
      m.replace(".", "\u0001")
    )
    .replace(/\b([A-Z])\./g, "$1\u0001"); // initials
  return protectedText
    .split(/(?<=[.?!])\s+(?=[A-Z("'•])/)
    .map((s) => s.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
}

/** First sentence of a block, or the whole block when it has no terminator. */
export function firstSentence(block: string): string {
  const list = sentences(block);
  return list.length > 0 ? list[0] : collapse(block);
}
