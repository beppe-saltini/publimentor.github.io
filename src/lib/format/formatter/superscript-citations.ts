/**
 * Superscript citation recovery for the rebuilt document.
 *
 * PDF text extraction flattens superscript citation numbers onto the preceding
 * word: "signals8,9.", "immunity1-4", "as described previously12". When the
 * manuscript cites by superscript numbers (or the target journal wants it to),
 * the renderer puts such trailing numbers back into superscript runs.
 *
 * The matcher is deliberately conservative: a wrong superscript inside a gene
 * or cell-line name (TSPAN4, CD8, p53, H1299, 4T1, Tspan4) would corrupt the
 * science, while a missed citation only looks like the PDF did. A number run
 * is only superscripted when
 *  - it directly follows a lower-case letter, a closing parenthesis or
 *    sentence punctuation, and is followed by whitespace, punctuation or the
 *    end of the text;
 *  - after a letter, the word it hangs on starts lower-case (mouse genes are
 *    "Tspan4"), is at least three letters long ("p53", "mT4", "mm10") and is
 *    not a known prefix that legitimately carries digits ("log2", "chr17");
 *  - after punctuation, the punctuation itself follows a word ("et al.1",
 *    "(Fig. 1a)12"), not a digit ("0.5", "1,000") or a label such as "Fig.";
 *  - every number lies between 1 and the reference count and ranges ascend.
 */

export interface CitationSegment {
  text: string;
  superscript: boolean;
}

/** Lower-case words that routinely end in digits without being citations. */
const NON_CITATION_PREFIXES = new Set([
  "log", "ln", "chr", "mir", "mirna", "let", "lin", "rad", "cdc", "atg", "sod", "cox", "nox", "hsa", "mmu",
  "alpha", "beta", "gamma", "delta", "covid", "caspase", "cyclin", "histone", "igg", "igm", "pcr", "rna", "dna",
  "exon", "intron", "passage", "day", "week", "hour", "min", "sec", "well", "plate", "clone", "line", "lane",
  "panel", "page", "step", "cycle", "run", "set", "group", "type", "grade", "stage", "phase", "class", "level",
  "version", "ver", "rev", "chapter", "part", "figure", "fig", "table", "tab", "ref", "refs", "lot", "cat",
]);

/** Abbreviations whose trailing period must not read as sentence punctuation. */
const LABEL_ABBREVIATIONS = /(?:^|[^A-Za-z])(?:figs?|figures?|tabs?|tables?|refs?|nos?|eqs?|vols?|pp?|chs?|chrs?|secs?|sects?|vs|cf|approx|ca|e\.g|i\.e|st|nd|rd|th|suppl|supp|app)$/i;

/** One citation run: numbers separated by commas (optionally spaced) or dashes. */
const RUN_RE = /\d{1,3}(?:(?:,\s?|[–—-])\d{1,3})*/g;

const SENTENCE_PUNCT = /[.,;:)]/;
const TERMINATOR = /^(?:\s|[.,;:)\]'"’”]|$)/;
/** Runs with spaced separators ("4, 13-19") must end at punctuation, not before a word. */
const STRICT_TERMINATOR = /^\s*(?:[.,;:)\]'"’”]|$)/;

function numbersValid(run: string, maxRef: number): boolean {
  const groups = run.split(/,\s?/);
  for (const group of groups) {
    const parts = group.split(/[–—-]/);
    if (parts.length > 2) return false;
    const nums = parts.map((p) => (/^[1-9]\d{0,2}$/.test(p) ? Number(p) : NaN));
    if (nums.some((n) => !Number.isFinite(n) || n < 1 || n > maxRef)) return false;
    if (nums.length === 2 && nums[0] >= nums[1]) return false;
  }
  return true;
}

/** Letters immediately before `end` (exclusive), e.g. "cells" in "cells12". */
function wordBefore(text: string, end: number): string {
  let start = end;
  while (start > 0 && /[A-Za-z]/.test(text[start - 1])) start -= 1;
  return text.slice(start, end);
}

function precededOk(text: string, index: number): boolean {
  if (index === 0) return false;
  const prev = text[index - 1];
  if (/[a-z]/.test(prev)) {
    const word = wordBefore(text, index);
    if (word.length < 3) return false;
    if (!/^[a-z]/.test(word)) return false; // "Tspan4", "Itga5", "GRCm38"
    if (NON_CITATION_PREFIXES.has(word.toLowerCase())) return false;
    return true;
  }
  if (!SENTENCE_PUNCT.test(prev)) return false;
  const before = text[index - 2];
  if (before === undefined) return false;
  if (/\d/.test(before)) return false; // decimals, thousands, ratios
  if (prev === ")") {
    if (!/[A-Za-z)\]'"’”%]/.test(before)) return false;
  } else if (!/[a-z)\]'"’”]/.test(before)) return false;
  if (prev === "." && LABEL_ABBREVIATIONS.test(text.slice(Math.max(0, index - 12), index - 1))) return false;
  return true;
}

/**
 * Split `text` into plain and superscript segments. `maxRef` is the number of
 * entries in the reference list; 0 disables the recovery and returns the text
 * as a single plain segment.
 */
export function splitSuperscriptCitations(text: string, maxRef: number): CitationSegment[] {
  if (maxRef <= 0 || !/\d/.test(text)) return [{ text, superscript: false }];
  const out: CitationSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(RUN_RE)) {
    const index = m.index ?? 0;
    const run = m[0];
    if (index < last) continue;
    if (!precededOk(text, index)) continue;
    const rest = text.slice(index + run.length);
    const terminator = /,\s\d/.test(run) ? STRICT_TERMINATOR : TERMINATOR;
    if (!terminator.test(rest)) continue;
    if (!numbersValid(run, maxRef)) continue;
    if (index > last) out.push({ text: text.slice(last, index), superscript: false });
    out.push({ text: run, superscript: true });
    last = index + run.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), superscript: false });
  return out.length > 0 ? out : [{ text, superscript: false }];
}

/**
 * Reference count to superscript against, or 0 when the recovery must not
 * run: the manuscript neither cites by superscript numbers nor is being
 * formatted for a journal that requires it.
 */
export function superscriptCitationMax(
  references: { inTextStyle: string; count: number },
  target: { references: { citationStyle: string } },
  fallbackCount = 0
): number {
  const wanted = references.inTextStyle === "superscript-numeric" || target.references.citationStyle === "superscript-numeric";
  if (!wanted) return 0;
  // An author-year manuscript has no glued numbers to recover; its years and
  // sample sizes must stay put even when the journal wants superscripts.
  if (references.inTextStyle === "author-year") return 0;
  return references.count > 0 ? references.count : fallbackCount;
}
