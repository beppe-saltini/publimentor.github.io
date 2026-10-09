/**
 * Cleanup of raw per-page text coming out of unpdf.
 *
 * Manuscript PDFs produced for peer review carry three artefacts that wreck
 * naive text analysis:
 *
 *  1. Line numbering. The number of each typeset line is glued to the end of
 *     the extracted line ("…chemotherapy efficacy1", "Competing interests813")
 *     or sits on a line of its own. Because the numbers run in sequence we can
 *     strip them with a running counter instead of a blunt regex, which would
 *     also eat legitimate trailing digits such as superscript citations.
 *  2. Page numbers and running headers/footers repeated on every page.
 *  3. Hard line wrapping, including hyphenated word breaks.
 *
 * Everything here is deliberately conservative: when a signal is not
 * consistent across pages we leave the text alone.
 */

export interface PdfCleanResult {
  text: string;
  pageCount: number;
  /** Number of line-number artefacts removed (0 when the PDF has none). */
  strippedLineNumbers: number;
  /** Repeated header/footer lines that were dropped (distinct, normalised). */
  removedRunningHeads: string[];
}

interface PageLines {
  lines: string[];
}

/** "7", "- 7 -", "Page 7 of 40", "7 | Page" — a page number on its own line. */
const DECORATED_PAGE_NUMBER =
  /^\s*(?:[-–—|]\s*)?(?:page\s+)?(\d{1,4})(?:\s*(?:of|\/)\s*\d{1,4})?\s*(?:\|\s*page)?\s*(?:[-–—|])?\s*$/i;

/** Index of the first/last non-empty line, or -1. */
function firstNonEmpty(lines: string[]): number {
  return lines.findIndex((l) => l.trim().length > 0);
}
function lastNonEmpty(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim().length > 0) return i;
  }
  return -1;
}

/**
 * Removes page numbers that sit alone at the top or bottom of every page.
 * We require a constant offset between the printed number and the page index
 * on a majority of pages, so a stray numeric line is never mistaken for one.
 */
function removePageNumbers(pages: PageLines[]): void {
  for (const edge of ["head", "tail"] as const) {
    const offsets = new Map<number, number[]>(); // offset -> page indices
    pages.forEach((page, idx) => {
      const pos = edge === "head" ? firstNonEmpty(page.lines) : lastNonEmpty(page.lines);
      if (pos < 0) return;
      const m = page.lines[pos].match(DECORATED_PAGE_NUMBER);
      if (!m) return;
      const offset = Number(m[1]) - (idx + 1);
      const bucket = offsets.get(offset) ?? [];
      bucket.push(idx);
      offsets.set(offset, bucket);
    });
    const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
    for (const [, pageIdxs] of offsets) {
      if (pageIdxs.length < threshold) continue;
      for (const idx of pageIdxs) {
        const pos = edge === "head" ? firstNonEmpty(pages[idx].lines) : lastNonEmpty(pages[idx].lines);
        if (pos >= 0) pages[idx].lines[pos] = "";
      }
    }
  }
}

/** Normalised form of a candidate running header (digits dropped). */
function headerKey(line: string): string {
  return line
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z ]/g, "")
    .trim()
    .toLowerCase();
}

/** Removes the same header/footer line repeated across most pages. */
function removeRunningHeads(pages: PageLines[]): string[] {
  const removed = new Set<string>();
  if (pages.length < 4) return [];
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  for (const edge of ["head", "tail"] as const) {
    const counts = new Map<string, number[]>();
    pages.forEach((page, idx) => {
      const pos = edge === "head" ? firstNonEmpty(page.lines) : lastNonEmpty(page.lines);
      if (pos < 0) return;
      const key = headerKey(page.lines[pos]);
      // Only short lines can be running heads; long ones are body text.
      if (key.length < 4 || key.length > 90) return;
      const bucket = counts.get(key) ?? [];
      bucket.push(idx);
      counts.set(key, bucket);
    });
    for (const [key, pageIdxs] of counts) {
      if (pageIdxs.length < threshold) continue;
      removed.add(key);
      for (const idx of pageIdxs) {
        const pos = edge === "head" ? firstNonEmpty(pages[idx].lines) : lastNonEmpty(pages[idx].lines);
        if (pos >= 0) pages[idx].lines[pos] = "";
      }
    }
  }
  return [...removed];
}

/** A line's trailing integer, ignoring runs longer than 4 digits. */
function trailingNumber(line: string): { prefix: string; value: number } | null {
  const m = line.match(/^(.*?)(?<!\d)(\d{1,4})\s*$/);
  if (!m) return null;
  return { prefix: m[1], value: Number(m[2]) };
}

/**
 * Strips sequential line numbers from the end of lines.
 *
 * The numbers are recovered as a chain rather than line by line: a candidate
 * is only accepted as the start of a chain when the *next* candidate continues
 * it (n, then n+1…n+3). That confirmation is what keeps superscript citations
 * ("…immunity1-4") and trailing data values out of the chain, and it also
 * handles numbering that restarts on every page — a restart simply breaks the
 * chain and a new one is anchored.
 *
 * `apply: false` only counts, so the caller can first decide whether the
 * document is line-numbered at all.
 */
function walkLineNumbers(pages: PageLines[], apply: boolean): number {
  interface Candidate {
    page: number;
    line: number;
    prefix: string;
    value: number;
  }
  const candidates: Candidate[] = [];
  pages.forEach((page, p) => {
    page.lines.forEach((line, l) => {
      if (line.trim().length === 0) return;
      const hit = trailingNumber(line);
      if (hit) candidates.push({ page: p, line: l, prefix: hit.prefix, value: hit.value });
    });
  });

  let expected: number | null = null;
  let misses = 0;
  let stripped = 0;

  for (let j = 0; j < candidates.length; j += 1) {
    const candidate = candidates[j];
    let accept = false;

    if (expected === null) {
      // Anchor a new chain only when one of the next few candidates continues
      // it. Looking three candidates ahead tolerates interleaved superscripts
      // (an affiliation marker, say) between two numbered lines.
      accept = candidates
        .slice(j + 1, j + 4)
        .some((c) => c.value > candidate.value && c.value <= candidate.value + 3);
    } else if (candidate.value >= expected && candidate.value <= expected + 2) {
      accept = true;
    }

    if (accept) {
      expected = candidate.value + 1;
      misses = 0;
      stripped += 1;
      if (apply) {
        pages[candidate.page].lines[candidate.line] = candidate.prefix.replace(/\s+$/, "");
      }
      continue;
    }

    if (expected !== null) {
      misses += 1;
      // Several misses in a row mean the chain is lost (a page restart, or a
      // stretch of lines whose numbers did not survive extraction).
      if (misses >= 4) {
        expected = null;
        misses = 0;
      }
    }
  }
  return stripped;
}

/**
 * Joins hyphen/dash-broken words across line breaks. The hyphen is dropped
 * only when the de-hyphenated word occurs elsewhere in the document, so
 * genuine compounds ("damage-associated") keep their hyphen while syllable
 * breaks ("require-\nment") are healed.
 */
function reflowHyphens(lines: string[]): string[] {
  const vocabulary = new Set<string>();
  for (const line of lines) {
    for (const w of line.match(/[A-Za-z]{3,}/g) ?? []) vocabulary.add(w.toLowerCase());
  }
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      const hyphen = prev.match(/([A-Za-z]{2,})-$/);
      const dash = prev.match(/[A-Za-z0-9)]([–—])$/);
      const next = line.match(/^([A-Za-z][A-Za-z0-9'’\-]*)/);
      if (hyphen && next && /^[a-z]/.test(next[1])) {
        const joined = (hyphen[1] + next[1]).toLowerCase();
        const keepHyphen = !vocabulary.has(joined);
        out[out.length - 1] = (keepHyphen ? prev : prev.slice(0, -1)) + line;
        continue;
      }
      if (dash && next) {
        out[out.length - 1] = prev + line;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Cleans an array of raw page texts into one analysable document.
 */
export function cleanPdfPages(rawPages: string[]): PdfCleanResult {
  const pages: PageLines[] = rawPages.map((p) => ({
    lines: p.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")),
  }));

  removePageNumbers(pages);
  const removedRunningHeads = removeRunningHeads(pages);

  // Decide whether the document is line-numbered before touching anything.
  const nonEmpty = pages.reduce(
    (n, p) => n + p.lines.filter((l) => l.trim().length > 0).length,
    0
  );
  const candidates = walkLineNumbers(pages.map((p) => ({ lines: [...p.lines] })), false);
  let strippedLineNumbers = 0;
  if (candidates >= 5 && candidates >= nonEmpty * 0.3) {
    strippedLineNumbers = walkLineNumbers(pages, true);
  }

  // Lines that only held a line number are now empty: they mark paragraph
  // breaks, so collapse runs of them to a single blank line per page join.
  const joined: string[] = [];
  pages.forEach((page, idx) => {
    if (idx > 0) joined.push(""); // page break behaves like a paragraph break
    joined.push(...page.lines);
  });

  const reflowed = reflowHyphens(joined);
  const text = reflowed
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    pageCount: rawPages.length,
    strippedLineNumbers,
    removedRunningHeads,
  };
}

/** Extracts per-page text with unpdf, keeping page boundaries. */
export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  const { parsePDFPages } = await import("@/lib/pdf-parser");
  const { pages } = await parsePDFPages(buffer);
  return pages;
}
